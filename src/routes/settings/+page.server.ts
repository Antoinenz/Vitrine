import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { legalPages, LEGAL_SLUGS, type LegalSlug } from '$lib/server/db/schema';
import { requireOwner } from '$lib/server/guards';
import { TEMPLATES } from '$lib/legal';
import { loadProfile, saveFooter, ProfileInputError, LICENCES } from '$lib/server/actions/profile';

/**
 * Site settings: everything that belongs to the site rather than to a
 * photograph, a collection or the artist's introduction.
 *
 * In practice that means the footer and the legal pages — which is why it is
 * reached from the footer. The two things it edits are the two things visible
 * down there, so the link sits next to them rather than behind a menu.
 *
 * A page rather than a modal, unlike the profile and collection editors. Those
 * edit something you can see behind them, and being able to watch the change
 * land is the point. Nothing here has that property: the legal pages are
 * separate documents, and the footer is one strip repeated on every page.
 */

const TITLES: Record<LegalSlug, string> = {
	terms: 'Terms of use',
	privacy: 'Privacy'
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireOwner(locals, url.pathname);

	const profile = loadProfile(user.id);
	const stored = db.select().from(legalPages).all();
	const siteName = profile.displayName || 'this site';

	return {
		profile,
		licences: LICENCES,
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
		})
	};
};

export const actions: Actions = {
	footer: async ({ locals, request, url }) => {
		const user = requireOwner(locals, url.pathname);
		const data = await request.formData();

		try {
			saveFooter(user, data);
		} catch (err) {
			if (err instanceof ProfileInputError) {
				return fail(400, { scope: 'footer', message: err.message });
			}
			throw err;
		}

		return { scope: 'footer', saved: true };
	},

	savePage: async ({ locals, request, url }) => {
		requireOwner(locals, url.pathname);
		const data = await request.formData();

		const slug = String(data.get('slug') ?? '') as LegalSlug;
		if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) {
			return fail(400, { scope: 'page', message: 'Unknown page.' });
		}

		const title = String(data.get('title') ?? '').trim() || TITLES[slug];
		const content = String(data.get('content') ?? '').slice(0, 40_000);

		const values = { title, content, updatedAt: new Date() };
		db.insert(legalPages)
			.values({ slug, ...values })
			.onConflictDoUpdate({ target: legalPages.slug, set: values })
			.run();

		return { scope: 'page', saved: slug };
	}
};
