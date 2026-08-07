import { error } from '@sveltejs/kit';
import sharp from 'sharp';
import { asc, eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { profiles, users, derivatives } from '$lib/server/db/schema';
import { derivativePath } from '$lib/server/storage';

/**
 * The site icon, cut from the artist's portrait.
 *
 * A gallery's icon should be the photographer, not a framework logo, and the
 * portrait is already chosen — reusing it means there is nothing extra to
 * upload or keep in sync.
 *
 * It is **not** served from `/i/<id>/320.webp`, for two reasons:
 *
 * 1. That rendition is the whole frame. The artist page shows the portrait
 *    through `object-fit: cover` inside a circle, so what the artist thinks of
 *    as their picture is the centre square — and a browser handed a 3:2 image
 *    for a favicon will letterbox or squash it into something they never
 *    chose. This crops the same way the page does.
 * 2. That route enforces collection access, and a portrait may well be picked
 *    from a collection that isn't public. The favicon is requested on every
 *    page by every visitor, so it cannot be access-gated. Choosing a photo as
 *    a portrait is what publishes it — the artist page already shows it to
 *    everyone — and only this 180px square is exposed here, never the
 *    collection it came from.
 *
 * PNG rather than WebP: favicon support for WebP is still uneven across
 * browsers and this is one small, heavily-cached file.
 */

/** Comfortably covers the largest icon slot browsers ask for. */
const SIZE = 180;

export const GET: RequestHandler = async ({ request }) => {
	const owner = db
		.select({ id: users.id })
		.from(users)
		.orderBy(asc(users.createdAt))
		.limit(1)
		.get();
	if (!owner) error(404);

	const profile = db
		.select({ avatarPhotoId: profiles.avatarPhotoId })
		.from(profiles)
		.where(eq(profiles.userId, owner.id))
		.get();

	// No portrait chosen: the layout falls back to the bundled mark, so a plain
	// 404 is the right answer rather than a placeholder.
	if (!profile?.avatarPhotoId) error(404);

	/**
	 * Cut from the 320px rendition rather than the original. It is already on
	 * disk, already the right order of magnitude, and decoding a 40-megapixel
	 * original to produce a 180px square would be absurd. Format is whatever the
	 * install generates — sharp reads all of them.
	 */
	const source = db
		.select({ storageKey: derivatives.storageKey, id: derivatives.id })
		.from(derivatives)
		.where(and(eq(derivatives.photoId, profile.avatarPhotoId), eq(derivatives.width, 320)))
		.get();

	if (!source) error(404);

	/**
	 * Renditions are immutable and a new portrait means a new derivative id, so
	 * the id alone is a sound validator: change the portrait and the tag changes.
	 */
	const etag = `"${source.id}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers: { etag } });
	}

	let png: Buffer;
	try {
		png = await sharp(derivativePath(source.storageKey))
			// `cover` centres and crops to a square — the same part of the frame the
			// circular avatar on the artist page shows.
			.resize(SIZE, SIZE, { fit: 'cover', position: 'centre' })
			.png()
			.toBuffer();
	} catch {
		// Row exists but the file is gone. 404 beats a 500 for something the
		// browser requests unprompted on every page.
		error(404);
	}

	return new Response(new Uint8Array(png), {
		headers: {
			'content-type': 'image/png',
			'content-length': String(png.byteLength),
			etag,
			/**
			 * Short, and revalidated. Unlike a rendition URL this path is stable
			 * across portrait changes, so it must not be cached immutably or a new
			 * portrait would never reach anyone who had already loaded the old one.
			 */
			'cache-control': 'public, max-age=300, must-revalidate'
		}
	});
};
