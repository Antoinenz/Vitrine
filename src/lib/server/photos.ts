import { inArray, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { derivatives, photos, type Photo, type Collection } from './db/schema';
import { projectExif } from './images/exif';
import type { PhotoExif } from './db/schema';

/**
 * Turns database rows into the shape the public pages render.
 *
 * Two things happen here that must not be skipped by a caller building its own
 * query: EXIF is projected through the collection's allow-list, and the raw
 * `storageKey` never leaves the server. Routing every public photo through this
 * function is what keeps those guarantees from depending on each page
 * remembering them.
 */

export interface PhotoSource {
	/** MIME type for a <source> element, e.g. `image/avif`. */
	type: string;
	/** `"/i/<id>/320.avif 320w, /i/<id>/640.avif 640w"` */
	srcset: string;
}

export interface PhotoView {
	id: string;
	width: number;
	height: number;
	/** Base64 ThumbHash, or null while the photo is still processing. */
	thumbhash: string | null;
	dominantColor: string;
	caption: string;
	alt: string;
	/** Ordered most-preferred first, for <picture>. */
	sources: PhotoSource[];
	/** Fallback for browsers that match no <source>. */
	src: string;
	/** Widest rendition available, used by the viewer when zoomed. */
	maxWidth: number;
	exif: PhotoExif;
}

const MIME: Record<string, string> = {
	avif: 'image/avif',
	webp: 'image/webp',
	jpeg: 'image/jpeg'
};

/** Preference order when several formats exist. Smallest-first wins in <picture>. */
const FORMAT_ORDER = ['avif', 'webp', 'jpeg'];

type DerivativeRow = { photoId: string; width: number; format: string };

function buildSources(photoId: string, rows: DerivativeRow[]): PhotoSource[] {
	const byFormat = new Map<string, number[]>();
	for (const row of rows) {
		const widths = byFormat.get(row.format) ?? [];
		widths.push(row.width);
		byFormat.set(row.format, widths);
	}

	return FORMAT_ORDER.filter((f) => byFormat.has(f)).map((format) => ({
		type: MIME[format],
		srcset: byFormat
			.get(format)!
			.sort((a, b) => a - b)
			.map((w) => `/i/${photoId}/${w}.${format} ${w}w`)
			.join(', ')
	}));
}

/**
 * Builds view models for a set of photos in one pass.
 *
 * Derivatives are fetched with a single `IN` query rather than per photo — a
 * 300-image collection would otherwise issue 300 round trips to render one
 * page.
 */
export function toPhotoViews(rows: Photo[], collection: Collection): PhotoView[] {
	const ready = rows.filter((p) => p.status === 'ready');
	if (ready.length === 0) return [];

	const derivativeRows = db
		.select({
			photoId: derivatives.photoId,
			width: derivatives.width,
			format: derivatives.format
		})
		.from(derivatives)
		.where(
			inArray(
				derivatives.photoId,
				ready.map((p) => p.id)
			)
		)
		.all();

	const grouped = new Map<string, DerivativeRow[]>();
	for (const row of derivativeRows) {
		const list = grouped.get(row.photoId) ?? [];
		list.push(row);
		grouped.set(row.photoId, list);
	}

	return ready.map((photo) => {
		const mine = grouped.get(photo.id) ?? [];
		const widths = mine.map((d) => d.width);
		const maxWidth = widths.length ? Math.max(...widths) : photo.width;

		// The widest rendition in the most compatible format, so the fallback
		// works even in a browser that understands none of the <source> types.
		const fallbackFormat = mine.some((d) => d.format === 'jpeg')
			? 'jpeg'
			: mine.some((d) => d.format === 'webp')
				? 'webp'
				: (mine[0]?.format ?? 'webp');

		return {
			id: photo.id,
			width: photo.width,
			height: photo.height,
			thumbhash: photo.thumbhash,
			dominantColor: photo.dominantColor ?? '#e8e5e1',
			caption: photo.caption,
			// Falls back to the caption so a photo without explicit alt text isn't
			// announced as nothing at all.
			alt: photo.altText || photo.caption || '',
			sources: buildSources(photo.id, mine),
			src: `/i/${photo.id}/${maxWidth}.${fallbackFormat}`,
			maxWidth,
			exif: projectExif(photo.exif, collection.metadataFields)
		};
	});
}

/** Loads a collection's ready photos, in display order. */
export function loadCollectionPhotos(collection: Collection): PhotoView[] {
	const rows = db
		.select()
		.from(photos)
		.where(eq(photos.collectionId, collection.id))
		.orderBy(asc(photos.sortKey))
		.all();

	return toPhotoViews(rows, collection);
}
