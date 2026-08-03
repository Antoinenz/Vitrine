import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { stat } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { derivatives, photos, collections } from '$lib/server/db/schema';
import { derivativePath } from '$lib/server/storage';
import { collectionAccess } from '$lib/server/access';

/**
 * Serves a generated rendition, e.g. `/i/<photoId>/1280.webp`.
 *
 * Access is re-checked here, not just on the page that links to the image.
 * Otherwise a private collection would be one guessed image URL away from
 * being public, and images are exactly what someone probing would want.
 */

const FORMAT_TYPES: Record<string, string> = {
	avif: 'image/avif',
	webp: 'image/webp',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg'
};

export const GET: RequestHandler = async ({ params, locals, cookies, request }) => {
	const match = /^(\d{1,5})\.([a-z]{3,4})$/.exec(params.size);
	if (!match) error(404);

	const width = Number(match[1]);
	const format = match[2];
	const contentType = FORMAT_TYPES[format];
	if (!contentType) error(404);

	const row = db
		.select({ derivative: derivatives, collection: collections })
		.from(derivatives)
		.innerJoin(photos, eq(derivatives.photoId, photos.id))
		.innerJoin(collections, eq(photos.collectionId, collections.id))
		.where(
			and(
				eq(derivatives.photoId, params.photoId),
				eq(derivatives.width, width),
				eq(derivatives.format, format === 'jpg' ? 'jpeg' : (format as 'avif' | 'webp' | 'jpeg'))
			)
		)
		.get();

	if (!row) error(404);

	// A locked collection is treated as not-found for images: returning 401 would
	// confirm the photo exists to anyone enumerating ids.
	if (collectionAccess(row.collection, locals, cookies) !== 'granted') error(404);

	const path = derivativePath(row.derivative.storageKey);

	let info;
	try {
		info = await stat(path);
	} catch {
		// Row exists but the file is gone — the derivative was cleared without the
		// database catching up. 404 rather than a 500 stack trace.
		error(404);
	}

	/**
	 * Renditions are immutable: regenerating one writes a new photo id, so a
	 * given URL's bytes never change. That makes a long, immutable cache safe and
	 * keeps a large grid from re-requesting on every navigation.
	 */
	const etag = `"${row.derivative.id}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers: { etag } });
	}

	const cacheControl =
		row.collection.visibility === 'public'
			? 'public, max-age=31536000, immutable'
			: // Unlisted or password-gated work shouldn't sit in a shared proxy where
				// it could be served to someone who never passed the check.
				'private, max-age=3600';

	return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
		headers: {
			'content-type': contentType,
			'content-length': String(info.size),
			etag,
			'cache-control': cacheControl
		}
	});
};
