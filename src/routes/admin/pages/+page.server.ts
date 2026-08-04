import { fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { legalPages, profiles, users, LEGAL_SLUGS, type LegalSlug } from '$lib/server/db/schema';
import { requireOwner } from '$lib/server/guards';
import { TEMPLATES } from '$lib/legal';

const TITLES: Record<LegalSlug, string> = {
	terms: 'Terms of use',
	privacy: 'Privacy'
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireOwner(locals, url.pathname);
	const owner = db.select().from(users).orderBy(asc(users.createdAt)).limit(1).get();
	const profile = owner
		? db.select().from(profiles).where(eq(profiles.userId, owner.id)).get()
		: undefined;

	const stored = db.select().from(legalPages).all();
	const siteName = profile?.displayName || 'this site';

	return {
		pages: LEGAL_SLUGS.map((slug) => {
			const row = stored.find((p) => p.slug === slug);
			return {
				slug,
				title: row?.title ?? TITLES[slug],
				content: row?.content ?? '',
				published: !!row?.content.trim(),
				// Offered in the editor rather than saved, so nothing is published
				// until the operator has read it.
				template: TEMPLATES[slug].replaceAll('{{SITE}}', siteName)
			};
		}),
		userId: user.id
	};
};

export const actions: Actions = {
	save: async ({ locals, request }) => {
		requireOwner(locals);
		const data = await request.formData();

		const slug = String(data.get('slug') ?? '') as LegalSlug;
		if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) {
			return fail(400, { message: 'Unknown page.' });
		}

		const title = String(data.get('title') ?? '').trim() || TITLES[slug];
		const content = String(data.get('content') ?? '').slice(0, 40_000);

		const values = { title, content, updatedAt: new Date() };
		db.insert(legalPages)
			.values({ slug, ...values })
			.onConflictDoUpdate({ target: legalPages.slug, set: values })
			.run();

		return { saved: slug };
	}
};
