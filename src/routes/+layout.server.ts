import { asc, eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import { profiles, users, legalPages } from '$lib/server/db/schema';

/**
 * Supplies the artist's accent colour to every page.
 *
 * Loaded once in the root layout rather than per page, so the colour is present
 * in the first server-rendered HTML — set later from a page load, links would
 * visibly change colour after hydration.
 */
export const load: LayoutServerLoad = async () => {
	const owner = db
		.select({ id: users.id })
		.from(users)
		.orderBy(asc(users.createdAt))
		.limit(1)
		.get();
	if (!owner) {
		return {
			accentColor: null,
			artistName: '',
			legal: [],
			licence: null,
			footerNote: '',
			footerLinks: []
		};
	}

	const profile = db
		.select({
			accentColor: profiles.accentColor,
			displayName: profiles.displayName,
			licence: profiles.licence,
			footerNote: profiles.footerNote,
			footerLinks: profiles.footerLinks
		})
		.from(profiles)
		.where(eq(profiles.userId, owner.id))
		.get();

	/**
	 * Only pages with content are advertised, so the footer never links to a
	 * page the operator hasn't written.
	 */
	const legal = db
		.select({ slug: legalPages.slug, title: legalPages.title, content: legalPages.content })
		.from(legalPages)
		.all()
		.filter((p) => p.content.trim())
		.map(({ slug, title }) => ({ slug, title }));

	return {
		accentColor: profile?.accentColor ?? null,
		artistName: profile?.displayName ?? '',
		legal,
		licence: profile?.licence ?? null,
		footerNote: profile?.footerNote ?? '',
		footerLinks: profile?.footerLinks ?? []
	};
};
