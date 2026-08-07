import { redirect } from '@sveltejs/kit';
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
export const load: LayoutServerLoad = async ({ locals, url }) => {
	/**
	 * The bootstrap-password pin, for ordinary browsing.
	 *
	 * `requireOwner` covers every owner-only load and action, but signing in and
	 * then simply looking at the gallery runs neither. Without this, an account
	 * still on its compose-file password could browse indefinitely and never be
	 * asked to change it.
	 *
	 * `/logout` must stay reachable, or the only way out of the pin is deleting a
	 * cookie by hand.
	 */
	if (
		locals.user?.mustChangePassword &&
		url.pathname !== '/password' &&
		url.pathname !== '/logout'
	) {
		redirect(303, '/password');
	}

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
			footerLinks: [],
			hasPortrait: false,
			isOwner: false
		};
	}

	const profile = db
		.select({
			accentColor: profiles.accentColor,
			displayName: profiles.displayName,
			licence: profiles.licence,
			footerNote: profiles.footerNote,
			footerLinks: profiles.footerLinks,
			avatarPhotoId: profiles.avatarPhotoId
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
		footerLinks: profile?.footerLinks ?? [],
		/**
		 * A boolean, not the id: the icon lives at a fixed path, so the page has no
		 * use for the photo id and nothing is gained by publishing it here.
		 */
		hasPortrait: !!profile?.avatarPhotoId,
		/**
		 * A boolean, never the id or email: the footer only needs to know whether
		 * to offer *Sign in* or *Sign out*.
		 *
		 * Note this makes the root layout's response vary by session. Nothing
		 * caches HTML here, but a reverse proxy put in front of the app later
		 * would need to know that.
		 */
		isOwner: locals.user?.id === owner.id
	};
};
