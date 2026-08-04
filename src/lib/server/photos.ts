import { inArray, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { derivatives, photos, type Photo, type Collection } from './db/schema';
import { projectExif } from './images/exif';
import type { PhotoExif } from './db/schema';
import { SOCIAL_WIDTH } from '../social';

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
	/** Widest width available *in the fallback format*. */
	maxWidth: number;
	/** Largest rendition, for the viewer once someone zooms in. */
	zoomSrc: string;
	/**
	 * URL for link-preview scrapers. Derived from what was actually generated
	 * rather than assumed, so it resolves for photographs narrower than the
	 * social width and for libraries processed before JPEG was guaranteed.
	 */
	socialSrc: string;
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

	return buildPhotoViews(ready, derivativeRows, collection);
}

/**
 * The pure half of `toPhotoViews`: given photos and their renditions, build the
 * view models.
 *
 * Separated from the query so the URL construction can be tested directly
 * against arbitrary combinations of widths and formats. That construction is
 * where a photograph's URLs are decided, and it has already shipped one bug
 * that only appears for particular rendition sets.
 */
export function buildPhotoViews(
	ready: Photo[],
	derivativeRows: DerivativeRow[],
	collection: Collection
): PhotoView[] {
	const grouped = new Map<string, DerivativeRow[]>();
	for (const row of derivativeRows) {
		const list = grouped.get(row.photoId) ?? [];
		list.push(row);
		grouped.set(row.photoId, list);
	}

	return ready.map((photo) => {
		const mine = grouped.get(photo.id) ?? [];

		/**
		 * Widths available per format.
		 *
		 * Every URL below is built by choosing a format first and then a width
		 * *from that format's list*. Picking them independently is what produced
		 * `/i/<id>/2048.jpeg` on installs where WebP ran to 2048 but the JPEG —
		 * generated only for link previews — existed solely at 1280. That
		 * combination was never written to disk, so the viewer 404'd.
		 */
		const widthsFor = new Map<string, number[]>();
		for (const d of mine) {
			const list = widthsFor.get(d.format) ?? [];
			list.push(d.width);
			widthsFor.set(d.format, list);
		}
		for (const list of widthsFor.values()) list.sort((a, b) => a - b);

		const widest = (format: string) => {
			const list = widthsFor.get(format);
			return list?.length ? list[list.length - 1] : null;
		};

		// Most compatible format for the plain <img>, so it still resolves in a
		// browser that matches none of the <source> types.
		const fallbackFormat =
			(['jpeg', 'webp', 'avif'] as const).find((f) => widthsFor.has(f)) ?? 'webp';
		const maxWidth = widest(fallbackFormat) ?? photo.width;

		// Most efficient format for the zoomed view — it's the largest file the
		// visitor will download, so compression matters more than compatibility.
		const zoomFormat = FORMAT_ORDER.find((f) => widthsFor.has(f)) ?? fallbackFormat;
		const zoomWidth = widest(zoomFormat) ?? maxWidth;

		// Preview scrapers lag browsers on format support, so JPEG is preferred
		// here even though it's the largest — but only at a width that exists.
		const socialFormat = widthsFor.has('jpeg') ? 'jpeg' : fallbackFormat;
		const socialCandidates = widthsFor.get(socialFormat) ?? [];
		const socialWidth =
			[...socialCandidates].reverse().find((w) => w <= SOCIAL_WIDTH) ??
			socialCandidates[0] ??
			maxWidth;

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
			zoomSrc: `/i/${photo.id}/${zoomWidth}.${zoomFormat}`,
			socialSrc: `/i/${photo.id}/${socialWidth}.${socialFormat}`,
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
