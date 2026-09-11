import { error, fail, redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { profiles, users } from '$lib/server/db/schema';
import { collectionAccess } from '$lib/server/access';
import { loadCollectionPhotos } from '$lib/server/photos';
import { findBySlug, updateCollection } from '$lib/server/collections';
import { moveToTrash as movePhotosToTrash, findInCollection } from '$lib/server/photo-store';
import { requireOwner, requireOwnedCollectionBySlug } from '$lib/server/guards';

export const load: PageServerLoad = async ({ params, locals, cookies, url }) => {
	const owner = db.select().from(users).orderBy(asc(users.createdAt)).limit(1).get();
	if (!owner) error(404);

	const collection = findBySlug(owner.id, params.slug);

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
		},
		/**
		 * A boolean only, for now: enough to show the artist the way through to the
		 * photo workbench, which is the last part of the old panel still standing.
		 *
		 * The full owner payload — dated date, metadata fields, whether a share
		 * password is set, pending and failed counts — arrives with the collection
		 * editor. It is deliberately not added speculatively, since every field
		 * here is one a visitor must never receive.
		 */
		isOwner: locals.user?.id === owner.id
	};
};

/**
 * Owner actions on the collection's own page.
 *
 * These are the first pieces of the workbench to move here. The page is public,
 * so every one of them re-establishes ownership rather than trusting that the
 * controls were only rendered for the artist — a hidden button is not access
 * control.
 */
export const actions: Actions = {
	trashPhotos: async ({ locals, params, request, url }) => {
		const user = requireOwner(locals, url.pathname);
		const collection = requireOwnedCollectionBySlug(user.id, params.slug);

		/**
		 * Ids arrive as one field rather than repeated ones, so a selection of any
		 * size is a single form submission and the whole discard either happens or
		 * does not.
		 */
		const ids = String((await request.formData()).get('ids') ?? '')
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean);

		if (ids.length === 0) return fail(400, { scope: 'photos', message: 'Nothing was selected.' });

		// Scoped to this collection inside the query, so a crafted request cannot
		// reach a photograph that is not on this page.
		const trashed = movePhotosToTrash(collection.id, ids);
		if (trashed === 0) {
			return fail(404, { scope: 'photos', message: 'Those photographs are no longer here.' });
		}

		return { scope: 'photos', trashed };
	},

	setCover: async ({ locals, params, request, url }) => {
		const user = requireOwner(locals, url.pathname);
		const collection = requireOwnedCollectionBySlug(user.id, params.slug);
		const photoId = String((await request.formData()).get('photoId') ?? '');

		if (!findInCollection(photoId, collection.id)) {
			return fail(404, { scope: 'photos', message: 'That photograph is not in this collection.' });
		}

		updateCollection(collection.id, { coverPhotoId: photoId });
		return { scope: 'photos', cover: true };
	}
};
