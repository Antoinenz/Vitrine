import { error, json } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { desc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { photos, collections } from '$lib/server/db/schema';
import { requireOwnerApi, requireOwnedCollectionBySlug } from '$lib/server/guards';
import { storeOriginal, UploadTooLargeError } from '$lib/server/storage';
import { keyBetween } from '$lib/server/sort-key';
import { schedule } from '$lib/server/images/worker';
import { MAX_UPLOAD_BYTES } from '$lib/server/config';

/**
 * Receives one photo per request, as a raw body.
 *
 * Deliberately not a multipart form. A raw body streams straight from the
 * socket to disk without a parser holding any of it in memory, and one request
 * per file gives the browser real per-file progress plus the ability to retry a
 * single failure out of a batch of sixty. The filename rides in the query
 * string since there's no form field to carry it.
 *
 * Addressed by slug, like its `download` sibling, because the caller is now the
 * public collection page — where the slug is in the URL and the id appears
 * nowhere.
 */

const ACCEPTED = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/avif',
	'image/tiff',
	'image/heic',
	'image/heif'
]);

export const POST: RequestHandler = async (event) => {
	const user = requireOwnerApi(event.locals);
	const collection = requireOwnedCollectionBySlug(user.id, event.params.slug);

	const filename = event.url.searchParams.get('name')?.trim();
	if (!filename) error(400, 'Missing file name');

	const contentType = event.request.headers.get('content-type') ?? '';
	if (!ACCEPTED.has(contentType.split(';')[0].trim().toLowerCase())) {
		error(415, `Unsupported image type: ${contentType || 'unknown'}`);
	}

	/**
	 * Reject an oversized upload from its declared length before reading the
	 * body, so we don't spend disk and time on something we'll discard. The
	 * header is client-controlled, so `storeOriginal` enforces the real limit
	 * again as bytes actually arrive.
	 */
	const declared = Number(event.request.headers.get('content-length') ?? 0);
	if (declared > MAX_UPLOAD_BYTES) {
		error(413, `File is larger than the ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit`);
	}

	if (!event.request.body) error(400, 'Empty request body');

	let stored;
	try {
		stored = await storeOriginal(
			Readable.fromWeb(event.request.body as never),
			filename,
			MAX_UPLOAD_BYTES
		);
	} catch (err) {
		if (err instanceof UploadTooLargeError) error(413, err.message);
		if (err instanceof Error && /empty/i.test(err.message)) error(400, 'File is empty');
		throw err;
	}

	const id = crypto.randomUUID();

	db.transaction((tx) => {
		// Appended to the end of the collection, in the order files were sent.
		const last = tx
			.select({ sortKey: photos.sortKey })
			.from(photos)
			.where(eq(photos.collectionId, collection.id))
			.orderBy(desc(photos.sortKey))
			.limit(1)
			.get();

		tx.insert(photos)
			.values({
				id,
				collectionId: collection.id,
				storageKey: stored.storageKey,
				originalName: filename,
				contentType,
				bytes: stored.bytes,
				crc32: stored.crc32,
				sortKey: keyBetween(last?.sortKey ?? null, null),
				status: 'pending'
			})
			.run();

		// The first photo uploaded becomes the cover until the artist picks one.
		if (!collection.coverPhotoId) {
			tx.update(collections)
				.set({ coverPhotoId: id, updatedAt: new Date() })
				.where(eq(collections.id, collection.id))
				.run();
		} else {
			tx.update(collections)
				.set({ updatedAt: new Date() })
				.where(eq(collections.id, collection.id))
				.run();
		}
	});

	// Renditions are generated in the background; the response returns as soon as
	// the bytes are safely on disk so a batch upload isn't gated on encoding.
	schedule();

	return json({ id, bytes: stored.bytes, deduplicated: stored.deduplicated }, { status: 201 });
};
