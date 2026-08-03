import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { photos, collections } from '$lib/server/db/schema';
import { originalPath } from '$lib/server/storage';
import { collectionAccess } from '$lib/server/access';
import { stripMetadata } from '$lib/server/images/process';

/**
 * Downloads a single photograph's original file.
 *
 * Gated server-side on both collection access and the artist's download
 * setting. A hidden button is not access control: this endpoint is reachable
 * directly, so it re-checks rather than trusting that the viewer only shows the
 * link when downloads are on.
 */
export const GET: RequestHandler = async ({ params, locals, cookies }) => {
	const row = db
		.select({ photo: photos, collection: collections })
		.from(photos)
		.innerJoin(collections, eq(photos.collectionId, collections.id))
		.where(eq(photos.id, params.photoId))
		.get();

	if (!row) error(404);

	const { photo, collection } = row;
	const isOwner = locals.user?.id === collection.ownerId;

	if (collectionAccess(collection, locals, cookies) !== 'granted') error(404);
	// The owner can always retrieve their own originals; everyone else needs the
	// setting enabled. 404 rather than 403 keeps the response uniform with a
	// collection that isn't visible at all.
	if (!collection.downloadsEnabled && !isOwner) error(404);

	const path = originalPath(photo.storageKey);

	/**
	 * The stored filename is a content hash, which would be a baffling thing to
	 * find in a downloads folder, so the original upload name is restored.
	 * Quotes and control characters are stripped because the value goes into a
	 * header where they would let a crafted name inject extra directives.
	 */
	const safeName = photo.originalName.replace(/["\\\r\n]/g, '').slice(0, 200) || 'photo.jpg';
	const disposition = `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;

	/**
	 * When the artist has asked for it, metadata is stripped on the way out.
	 * That means re-encoding, so the file is no longer bit-identical to what was
	 * uploaded — the honest cost of not handing out GPS coordinates. It also
	 * means buffering, so it is only done when actually requested.
	 */
	if (collection.stripExifOnDownload) {
		const cleaned = await stripMetadata(await readFile(path));
		return new Response(new Uint8Array(cleaned), {
			headers: {
				'content-type': 'image/jpeg',
				'content-length': String(cleaned.length),
				'content-disposition': disposition,
				'cache-control': 'private, no-store'
			}
		});
	}

	let info;
	try {
		info = await stat(path);
	} catch {
		error(404);
	}

	// Streamed, so a 60MB original never sits in memory.
	return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
		headers: {
			'content-type': photo.contentType,
			'content-length': String(info.size),
			'content-disposition': disposition,
			'cache-control': 'private, max-age=0'
		}
	});
};
