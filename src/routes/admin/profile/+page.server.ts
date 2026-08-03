import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { profiles, photos, collections } from '$lib/server/db/schema';
import { requireOwner } from '$lib/server/guards';

const MAX_LINKS = 8;

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireOwner(locals, url.pathname);

	const profile = db.select().from(profiles).where(eq(profiles.userId, user.id)).get() ??
		// A profile row is created alongside the account, but an install that
		// predates that (or had the row removed) shouldn't 500 on this page.
		{
			userId: user.id,
			displayName: '',
			bio: '',
			avatarPhotoId: null,
			socialLinks: [],
			accentColor: '#1c1917'
		};

	/**
	 * The avatar is chosen from photos already uploaded rather than uploaded
	 * separately — it reuses the whole rendition pipeline, so the portrait gets
	 * the same responsive sizes and placeholder as everything else.
	 */
	const candidates = db
		.select({ id: photos.id, originalName: photos.originalName, collection: collections.title })
		.from(photos)
		.innerJoin(collections, eq(photos.collectionId, collections.id))
		.where(and(eq(collections.ownerId, user.id), eq(photos.status, 'ready')))
		.orderBy(asc(photos.createdAt))
		.all();

	return { profile, candidates, email: user.email };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const user = requireOwner(locals);
		const data = await request.formData();

		const displayName = String(data.get('displayName') ?? '').trim();
		if (displayName.length > 120) return fail(400, { message: 'That name is too long.' });

		const accentColor = String(data.get('accentColor') ?? '#1c1917').trim();
		// Written straight into a CSS custom property, so anything but a plain hex
		// colour is refused rather than escaped.
		if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
			return fail(400, { message: 'Accent colour must be a hex value like #1c1917.' });
		}

		const labels = data.getAll('linkLabel').map(String);
		const urls = data.getAll('linkUrl').map(String);

		const socialLinks: { label: string; url: string }[] = [];
		for (let i = 0; i < Math.min(labels.length, urls.length, MAX_LINKS); i++) {
			const label = labels[i].trim().slice(0, 40);
			const url = urls[i].trim();
			if (!label || !url) continue;

			// Only http(s) links are stored: a `javascript:` URL rendered into an
			// href on the public page would be a scripting vector.
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				return fail(400, { message: `"${url}" isn't a valid link.` });
			}
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
				return fail(400, { message: 'Links must start with http:// or https://' });
			}

			socialLinks.push({ label, url: parsed.toString() });
		}

		const rawAvatar = String(data.get('avatarPhotoId') ?? '');
		// Verified to belong to this user, so a crafted form can't point the
		// avatar at someone else's photo.
		const avatarPhotoId = rawAvatar
			? (db
					.select({ id: photos.id })
					.from(photos)
					.innerJoin(collections, eq(photos.collectionId, collections.id))
					.where(and(eq(photos.id, rawAvatar), eq(collections.ownerId, user.id)))
					.get()?.id ?? null)
			: null;

		const values = {
			displayName,
			bio: String(data.get('bio') ?? '')
				.trim()
				.slice(0, 2000),
			avatarPhotoId,
			socialLinks,
			accentColor
		};

		db.insert(profiles)
			.values({ userId: user.id, ...values })
			.onConflictDoUpdate({ target: profiles.userId, set: values })
			.run();

		return { saved: true };
	}
};
