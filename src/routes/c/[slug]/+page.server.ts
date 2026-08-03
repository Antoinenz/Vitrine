import { error, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { collections, profiles, users } from '$lib/server/db/schema';
import { collectionAccess } from '$lib/server/access';
import { loadCollectionPhotos } from '$lib/server/photos';

export const load: PageServerLoad = async ({ params, locals, cookies, url }) => {
	const owner = db.select().from(users).orderBy(asc(users.createdAt)).limit(1).get();
	if (!owner) error(404);

	const collection = db
		.select()
		.from(collections)
		.where(and(eq(collections.ownerId, owner.id), eq(collections.slug, params.slug)))
		.get();

	// 404 rather than 403 for a missing *or* forbidden collection, so probing
	// slugs can't distinguish "private" from "doesn't exist".
	if (!collection) error(404);

	const access = collectionAccess(collection, locals, cookies);
	if (access === 'denied') error(404);
	if (access === 'locked') {
		redirect(303, `/c/${collection.slug}/unlock?next=${encodeURIComponent(url.pathname)}`);
	}

	const profile = db.select().from(profiles).where(eq(profiles.userId, owner.id)).get();

	return {
		collection: {
			id: collection.id,
			slug: collection.slug,
			title: collection.title,
			description: collection.description,
			visibility: collection.visibility,
			downloadsEnabled: collection.downloadsEnabled,
			zipEnabled: collection.zipEnabled,
			publishedAt: collection.publishedAt
		},
		photos: loadCollectionPhotos(collection),
		artist: {
			name: profile?.displayName ?? '',
			accentColor: profile?.accentColor ?? '#1c1917'
		}
	};
};
