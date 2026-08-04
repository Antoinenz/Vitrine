import { fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import {
	collections,
	photos,
	METADATA_FIELDS,
	type MetadataField,
	type Visibility
} from '$lib/server/db/schema';
import { requireOwner, requireOwnedCollection } from '$lib/server/guards';
import { slugify, isReservedSlug } from '$lib/server/slug';
import { hashPassword } from '$lib/server/auth';
import { retryPhoto } from '$lib/server/images/worker';
import { keyBetween } from '$lib/server/sort-key';
import { deleteDerivatives, deleteOriginal } from '$lib/server/storage';

const VISIBILITIES = new Set<Visibility>(['public', 'unlisted', 'private']);

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const user = requireOwner(locals, url.pathname);
	const collection = requireOwnedCollection(user.id, params.id);

	const rows = db
		.select({
			id: photos.id,
			originalName: photos.originalName,
			caption: photos.caption,
			altText: photos.altText,
			width: photos.width,
			height: photos.height,
			bytes: photos.bytes,
			thumbhash: photos.thumbhash,
			dominantColor: photos.dominantColor,
			status: photos.status,
			error: photos.error,
			sortKey: photos.sortKey
		})
		.from(photos)
		.where(eq(photos.collectionId, collection.id))
		.orderBy(asc(photos.sortKey))
		.all();

	return {
		collection: {
			...collection,
			// The hash itself must never reach the client; only whether one is set.
			passwordHash: undefined,
			hasPassword: !!collection.passwordHash
		},
		photos: rows,
		metadataFields: METADATA_FIELDS
	};
};

export const actions: Actions = {
	settings: async ({ locals, params, request }) => {
		const user = requireOwner(locals);
		const collection = requireOwnedCollection(user.id, params.id);
		const data = await request.formData();

		const title = String(data.get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'The collection needs a title.' });

		/**
		 * The slug is edited explicitly rather than re-derived from the title.
		 * Re-slugging on every rename would silently break links that have already
		 * been shared — the whole point of an unlisted collection is that its URL
		 * is what you hand out.
		 */
		const requested = String(data.get('slug') ?? '').trim();
		const slug = slugify(requested || title) || collection.slug;

		if (isReservedSlug(slug)) {
			return fail(400, { message: `"${slug}" is reserved. Choose another address.` });
		}

		const clash = db
			.select({ id: collections.id })
			.from(collections)
			.where(
				and(
					eq(collections.ownerId, user.id),
					eq(collections.slug, slug),
					ne(collections.id, collection.id)
				)
			)
			.get();
		if (clash) return fail(400, { message: `Another collection already uses /c/${slug}.` });

		const visibility = String(data.get('visibility') ?? 'private') as Visibility;
		if (!VISIBILITIES.has(visibility)) return fail(400, { message: 'Unknown visibility.' });

		// Only known fields are stored, so a crafted form can't inject a key that
		// later slips through the metadata allow-list.
		const metadataFields = METADATA_FIELDS.filter((f) =>
			data.getAll('metadataFields').includes(f)
		) as MetadataField[];

		const wasPublished = collection.publishedAt !== null;

		db.update(collections)
			.set({
				title,
				slug,
				description: String(data.get('description') ?? '').trim(),
				visibility,
				downloadsEnabled: data.get('downloadsEnabled') === 'on',
				zipEnabled: data.get('zipEnabled') === 'on',
				stripExifOnDownload: data.get('stripExifOnDownload') === 'on',
				metadataFields,
				publishedAt:
					visibility === 'private' ? null : wasPublished ? collection.publishedAt : new Date(),
				updatedAt: new Date()
			})
			.where(eq(collections.id, collection.id))
			.run();

		return { saved: true };
	},

	password: async ({ locals, params, request }) => {
		const user = requireOwner(locals);
		const collection = requireOwnedCollection(user.id, params.id);
		const data = await request.formData();

		if (data.get('clear') === 'on') {
			db.update(collections)
				.set({ passwordHash: null, updatedAt: new Date() })
				.where(eq(collections.id, collection.id))
				.run();
			return { saved: true };
		}

		const password = String(data.get('password') ?? '');
		if (password.length < 6) {
			return fail(400, { message: 'Use at least 6 characters for a share password.' });
		}

		db.update(collections)
			.set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
			.where(eq(collections.id, collection.id))
			.run();

		return { saved: true };
	},

	setCover: async ({ locals, params, request }) => {
		const user = requireOwner(locals);
		const collection = requireOwnedCollection(user.id, params.id);
		const photoId = String((await request.formData()).get('photoId') ?? '');

		// Scoped to this collection, so a photo id from elsewhere can't be set as
		// the cover of a collection it doesn't belong to.
		const photo = db
			.select({ id: photos.id })
			.from(photos)
			.where(and(eq(photos.id, photoId), eq(photos.collectionId, collection.id)))
			.get();
		if (!photo) return fail(404, { message: 'That photo is not in this collection.' });

		db.update(collections)
			.set({ coverPhotoId: photoId, updatedAt: new Date() })
			.where(eq(collections.id, collection.id))
			.run();

		return { saved: true };
	},

	/**
	 * Moves a photograph between two neighbours.
	 *
	 * The client sends who it was dropped *between*, not a target index, so the
	 * server mints a single fractional key with `keyBetween` and writes one row.
	 * Sending an index would mean renumbering every sibling on each drag.
	 */
	reorder: async ({ locals, params, request }) => {
		const user = requireOwner(locals);
		const collection = requireOwnedCollection(user.id, params.id);
		const data = await request.formData();

		const photoId = String(data.get('photoId') ?? '');
		const beforeId = String(data.get('beforeId') ?? '');
		const afterId = String(data.get('afterId') ?? '');

		const inCollection = (id: string) =>
			id
				? (db
						.select({ sortKey: photos.sortKey })
						.from(photos)
						.where(and(eq(photos.id, id), eq(photos.collectionId, collection.id)))
						.get()?.sortKey ?? null)
				: null;

		// Every id is checked against this collection, so a crafted request can't
		// reposition a photograph using a neighbour from somewhere else.
		if (!inCollection(photoId)) {
			return fail(404, { message: 'That photo is not in this collection.' });
		}

		const before = inCollection(beforeId);
		const after = inCollection(afterId);

		try {
			db.update(photos)
				.set({ sortKey: keyBetween(before, after) })
				.where(eq(photos.id, photoId))
				.run();
		} catch {
			// Neighbours arrived out of order — a stale page, or two drags racing.
			// The next load resolves it, so this isn't worth surfacing.
			return fail(409, { message: 'That order is out of date. Reload and try again.' });
		}

		db.update(collections)
			.set({ updatedAt: new Date() })
			.where(eq(collections.id, collection.id))
			.run();

		return { saved: true };
	},

	caption: async ({ locals, params, request }) => {
		const user = requireOwner(locals);
		const collection = requireOwnedCollection(user.id, params.id);
		const data = await request.formData();
		const photoId = String(data.get('photoId') ?? '');

		db.update(photos)
			.set({
				caption: String(data.get('caption') ?? '').slice(0, 500),
				altText: String(data.get('altText') ?? '').slice(0, 500)
			})
			.where(and(eq(photos.id, photoId), eq(photos.collectionId, collection.id)))
			.run();

		return { saved: true };
	},

	retry: async ({ locals, params, request }) => {
		const user = requireOwner(locals);
		const collection = requireOwnedCollection(user.id, params.id);
		const photoId = String((await request.formData()).get('photoId') ?? '');

		const photo = db
			.select({ id: photos.id })
			.from(photos)
			.where(and(eq(photos.id, photoId), eq(photos.collectionId, collection.id)))
			.get();
		if (!photo) return fail(404, { message: 'That photo is not in this collection.' });

		retryPhoto(photoId);
		return { saved: true };
	},

	deletePhoto: async ({ locals, params, request }) => {
		const user = requireOwner(locals);
		const collection = requireOwnedCollection(user.id, params.id);
		const photoId = String((await request.formData()).get('photoId') ?? '');

		const photo = db
			.select()
			.from(photos)
			.where(and(eq(photos.id, photoId), eq(photos.collectionId, collection.id)))
			.get();
		if (!photo) return fail(404, { message: 'That photo is not in this collection.' });

		db.transaction((tx) => {
			tx.delete(photos).where(eq(photos.id, photoId)).run();

			// Promote another photo rather than leaving the collection with a cover
			// pointing at a row that no longer exists.
			if (collection.coverPhotoId === photoId) {
				const next = tx
					.select({ id: photos.id })
					.from(photos)
					.where(eq(photos.collectionId, collection.id))
					.orderBy(asc(photos.sortKey))
					.limit(1)
					.get();
				tx.update(collections)
					.set({ coverPhotoId: next?.id ?? null, updatedAt: new Date() })
					.where(eq(collections.id, collection.id))
					.run();
			}
		});

		await deleteDerivatives(photoId);

		/**
		 * Originals are content-addressed, so the same file uploaded to two
		 * collections is stored once and referenced twice. Deleting it while
		 * another row still points at it would blank that other photo.
		 */
		const stillReferenced = db
			.select({ id: photos.id })
			.from(photos)
			.where(eq(photos.storageKey, photo.storageKey))
			.get();
		if (!stillReferenced) await deleteOriginal(photo.storageKey);

		return { saved: true };
	},

	delete: async ({ locals, params }) => {
		const user = requireOwner(locals);
		const collection = requireOwnedCollection(user.id, params.id);

		const owned = db
			.select({ id: photos.id, storageKey: photos.storageKey })
			.from(photos)
			.where(eq(photos.collectionId, collection.id))
			.all();

		// Cascades to photos and derivatives via the schema's foreign keys.
		db.delete(collections).where(eq(collections.id, collection.id)).run();

		for (const photo of owned) {
			await deleteDerivatives(photo.id);
			const stillReferenced = db
				.select({ id: photos.id })
				.from(photos)
				.where(eq(photos.storageKey, photo.storageKey))
				.get();
			if (!stillReferenced) await deleteOriginal(photo.storageKey);
		}

		redirect(303, '/admin/collections');
	}
};
