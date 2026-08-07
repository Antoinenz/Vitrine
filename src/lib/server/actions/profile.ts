import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { profiles, photos, collections, COLLECTION_ORDERS } from '../db/schema';
import type { CollectionOrder, User } from '../db/schema';
import { LICENCES, DEFAULT_LICENCE } from '$lib/licences';

/**
 * Reading and writing the artist's profile, independent of any route.
 *
 * This used to live in `admin/profile/+page.server.ts`. Editing now happens
 * inline on the artist page, and the artist page's action needs exactly the
 * same validation — so the logic moved here rather than being duplicated or,
 * worse, reached by posting across routes (which lands a no-JS visitor on the
 * wrong page).
 */

/** Enough for a set of social links without letting a form post a thousand. */
const MAX_LINKS = 8;

export type ProfileLink = { label: string; url: string };

export type ProfileView = {
	displayName: string;
	bio: string;
	avatarPhotoId: string | null;
	socialLinks: ProfileLink[];
	accentColor: string;
	licence: string;
	footerNote: string;
	footerLinks: ProfileLink[];
	collectionOrder: CollectionOrder;
};

const BLANK: ProfileView = {
	displayName: '',
	bio: '',
	avatarPhotoId: null,
	socialLinks: [],
	accentColor: '#1c1917',
	licence: DEFAULT_LICENCE,
	footerNote: '',
	footerLinks: [],
	collectionOrder: 'date'
};

/**
 * The profile as the editor needs it.
 *
 * Falls back to blank values rather than throwing: a profile row is created
 * alongside the account, but an install that predates that — or had the row
 * removed — shouldn't 500 on the page it would be fixed from.
 */
export function loadProfile(userId: string): ProfileView {
	const row = db.select().from(profiles).where(eq(profiles.userId, userId)).get();
	if (!row) return { ...BLANK };

	return {
		displayName: row.displayName ?? '',
		bio: row.bio ?? '',
		avatarPhotoId: row.avatarPhotoId,
		socialLinks: row.socialLinks ?? [],
		accentColor: row.accentColor ?? BLANK.accentColor,
		licence: row.licence ?? DEFAULT_LICENCE,
		footerNote: row.footerNote ?? '',
		footerLinks: row.footerLinks ?? [],
		collectionOrder: row.collectionOrder ?? 'date'
	};
}

export type AvatarCandidate = { id: string; originalName: string; collection: string };

/**
 * Photographs that may be used as the portrait.
 *
 * Restricted to collections a visitor can actually reach. The portrait is shown
 * on the public artist page, and the image route enforces collection access —
 * so a portrait chosen from a private collection renders as a broken image for
 * everyone except the artist, who is always granted access and therefore never
 * sees the breakage. Filtering here is what makes that impossible to choose.
 */
export function avatarCandidates(userId: string): AvatarCandidate[] {
	return db
		.select({ id: photos.id, originalName: photos.originalName, collection: collections.title })
		.from(photos)
		.innerJoin(collections, eq(photos.collectionId, collections.id))
		.where(
			and(
				eq(collections.ownerId, userId),
				eq(photos.status, 'ready'),
				// `private` is the one that breaks; `unlisted` is reachable by link and
				// its images are served to anyone who has one.
				eq(collections.visibility, 'public')
			)
		)
		.orderBy(asc(photos.createdAt))
		.all();
}

/** Thrown for anything the artist can fix by editing the form. */
export class ProfileInputError extends Error {}

/**
 * Only http(s) links are stored: a `javascript:` URL rendered into an href on a
 * public page would be a scripting vector.
 */
function collectLinks(data: FormData, labelField: string, urlField: string): ProfileLink[] {
	const labels = data.getAll(labelField).map(String);
	const urls = data.getAll(urlField).map(String);
	const out: ProfileLink[] = [];

	for (let i = 0; i < Math.min(labels.length, urls.length, MAX_LINKS); i++) {
		const label = labels[i].trim().slice(0, 40);
		const raw = urls[i].trim();
		if (!label || !raw) continue;

		let parsed: URL;
		try {
			parsed = new URL(raw);
		} catch {
			throw new ProfileInputError(`"${raw}" isn't a valid link.`);
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			throw new ProfileInputError('Links must start with http:// or https://');
		}
		out.push({ label, url: parsed.toString() });
	}
	return out;
}

/**
 * Saves the fields the artist page's profile editor owns.
 *
 * Footer note, footer links and licence are deliberately **not** here — they
 * belong to the site settings page, and a partial form that omitted them would
 * blank them. `saveFooter` writes those.
 *
 * Throws `ProfileInputError` for bad input so the caller can turn it into
 * whichever `fail()` shape its route uses.
 */
export function saveProfile(user: User, data: FormData): void {
	const displayName = String(data.get('displayName') ?? '').trim();
	if (displayName.length > 120) throw new ProfileInputError('That name is too long.');

	const accentColor = String(data.get('accentColor') ?? '#1c1917').trim();
	// Written straight into a CSS custom property, so anything but a plain hex
	// colour is refused rather than escaped.
	if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
		throw new ProfileInputError('Accent colour must be a hex value like #1c1917.');
	}

	const socialLinks = collectLinks(data, 'linkLabel', 'linkUrl');

	const requestedOrder = String(data.get('collectionOrder') ?? '');
	const collectionOrder: CollectionOrder = (COLLECTION_ORDERS as readonly string[]).includes(
		requestedOrder
	)
		? (requestedOrder as CollectionOrder)
		: 'date';

	const rawAvatar = String(data.get('avatarPhotoId') ?? '');
	/**
	 * Verified to belong to this user *and* to be publicly reachable — the same
	 * rule `avatarCandidates` applies, enforced again here because the select is
	 * a form field and a crafted post could name any photo id.
	 */
	const avatarPhotoId = rawAvatar
		? (db
				.select({ id: photos.id })
				.from(photos)
				.innerJoin(collections, eq(photos.collectionId, collections.id))
				.where(
					and(
						eq(photos.id, rawAvatar),
						eq(collections.ownerId, user.id),
						eq(collections.visibility, 'public')
					)
				)
				.get()?.id ?? null)
		: null;

	const values = {
		displayName,
		bio: String(data.get('bio') ?? '')
			.trim()
			.slice(0, 2000),
		avatarPhotoId,
		socialLinks,
		accentColor,
		collectionOrder
	};

	db.insert(profiles)
		.values({ userId: user.id, ...values })
		.onConflictDoUpdate({ target: profiles.userId, set: values })
		.run();
}

/**
 * Saves what the footer shows: the note, its links, and the licence.
 *
 * Separate from `saveProfile` because these are edited from the settings page,
 * and each writer must touch only its own fields — sharing one action would
 * mean whichever form was submitted blanked the other's.
 */
export function saveFooter(user: User, data: FormData): void {
	const footerLinks = collectLinks(data, 'footerLinkLabel', 'footerLinkUrl');

	// Only a known licence id is stored, so a crafted form can't put arbitrary
	// text where a licence name is rendered.
	const requested = String(data.get('licence') ?? '');
	const licence = LICENCES.some((l) => l.id === requested) ? requested : DEFAULT_LICENCE;

	const values = {
		licence,
		footerNote: String(data.get('footerNote') ?? '')
			.trim()
			.slice(0, 300),
		footerLinks
	};

	db.insert(profiles)
		.values({ userId: user.id, ...values })
		.onConflictDoUpdate({ target: profiles.userId, set: values })
		.run();
}

export { LICENCES, MAX_LINKS };
