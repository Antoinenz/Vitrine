import { error, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { collections, profiles, users } from '$lib/server/db/schema';
import { collectionAccess } from '$lib/server/access';
import { loadCollectionPhotos } from '$lib/server/photos';

/**
 * The photo viewer as a real, server-rendered route.
 *
 * This exists as a genuine page rather than only a client-side overlay because
 * `page.state` is empty during SSR and on direct navigation — a shallow-routing
 * lightbox alone would 404 on exactly the link someone shares. The grid still
 * opens it as an overlay via `preloadData` + `pushState`; both presentations
 * resolve to this same URL.
 */
export const load: PageServerLoad = async ({ params, locals, cookies, url }) => {
	const owner = db.select().from(users).orderBy(asc(users.createdAt)).limit(1).get();
	if (!owner) error(404);

	const collection = db
		.select()
		.from(collections)
		.where(and(eq(collections.ownerId, owner.id), eq(collections.slug, params.slug)))
		.get();

	if (!collection) error(404);

	const access = collectionAccess(collection, locals, cookies);
	if (access === 'denied') error(404);
	if (access === 'locked') {
		redirect(303, `/c/${collection.slug}/unlock?next=${encodeURIComponent(url.pathname)}`);
	}

	const photos = loadCollectionPhotos(collection);
	const index = photos.findIndex((p) => p.id === params.photoId);
	// A photo id that isn't in this collection is a 404, not a redirect to the
	// first one — a stale link should say so rather than quietly showing
	// something else.
	if (index === -1) error(404);

	const profile = db.select().from(profiles).where(eq(profiles.userId, owner.id)).get();

	return {
		collection: {
			id: collection.id,
			slug: collection.slug,
			title: collection.title,
			downloadsEnabled: collection.downloadsEnabled,
			visibility: collection.visibility
		},
		photos,
		index,
		artist: { name: profile?.displayName ?? '' }
	};
};
