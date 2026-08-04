import { describe, it, expect } from 'vitest';
import { buildPhotoViews } from './photos';
import type { Collection, Photo } from './db/schema';

/**
 * Every URL a `PhotoView` hands to the browser must correspond to a rendition
 * that was actually generated.
 *
 * This is the guarantee that broke in production: widths and formats were
 * chosen independently, so an install with WebP up to 2048 and a JPEG only at
 * 1280 (generated for link previews) advertised `/i/<id>/2048.jpeg` — a
 * combination that never existed on disk. The viewer 404'd on every zoom.
 */

const COLLECTION: Collection = {
	id: 'c1',
	ownerId: 'u1',
	slug: 's',
	title: 'T',
	description: '',
	visibility: 'public',
	passwordHash: null,
	coverPhotoId: null,
	sortKey: 'a0',
	downloadsEnabled: false,
	zipEnabled: false,
	stripExifOnDownload: false,
	metadataFields: [],
	datedAt: null,
	publishedAt: null,
	createdAt: new Date(),
	updatedAt: new Date()
} as Collection;

function photoRow(id: string): Photo {
	return {
		id,
		collectionId: 'c1',
		storageKey: 'k',
		originalName: 'p.jpg',
		contentType: 'image/jpeg',
		bytes: 1,
		width: 4000,
		height: 3000,
		thumbhash: null,
		dominantColor: '#888888',
		crc32: 0,
		exif: null,
		caption: '',
		altText: '',
		sortKey: 'a0',
		status: 'ready',
		error: null,
		createdAt: new Date()
	} as Photo;
}

/** Builds the single view for a photo with exactly these renditions. */
function view(id: string, renditions: [number, 'avif' | 'webp' | 'jpeg'][]) {
	return buildPhotoViews(
		[photoRow(id)],
		renditions.map(([width, format]) => ({ photoId: id, width, format })),
		COLLECTION
	)[0];
}

/** Every `/i/<id>/<width>.<format>` in a view must exist in `derivatives`. */
function assertUrlsExist(urls: string[], available: [number, string][]) {
	const set = new Set(available.map(([w, f]) => `${w}.${f}`));
	for (const url of urls) {
		const match = /\/i\/[^/]+\/(\d+)\.([a-z]+)$/.exec(url);
		expect(match, `malformed URL: ${url}`).toBeTruthy();
		expect(set.has(`${match![1]}.${match![2]}`), `no rendition for ${url}`).toBe(true);
	}
}

function urlsOf(view: ReturnType<typeof buildPhotoViews>[number]): string[] {
	return [
		view.src,
		view.zoomSrc,
		view.socialSrc,
		...view.sources.flatMap((s) => s.srcset.split(', ').map((entry) => entry.split(' ')[0]))
	];
}

describe('toPhotoViews URLs', () => {
	/** The exact shape that broke: JPEG only at the social width, WebP far wider. */
	it('never pairs a width with a format that lacks it', () => {
		const available: [number, 'avif' | 'webp' | 'jpeg'][] = [
			[320, 'webp'],
			[1280, 'webp'],
			[2048, 'webp'],
			[1280, 'jpeg']
		];
		const v = view('p1', available);
		assertUrlsExist(urlsOf(v), available);
		// Specifically: the regression URL must not reappear.
		expect(urlsOf(v)).not.toContain('/i/p1/2048.jpeg');
	});

	it('handles a WebP-only library', () => {
		const available: [number, 'avif' | 'webp' | 'jpeg'][] = [
			[320, 'webp'],
			[1280, 'webp']
		];
		assertUrlsExist(urlsOf(view('p2', available)), available);
	});

	it('handles a JPEG-only library', () => {
		const available: [number, 'avif' | 'webp' | 'jpeg'][] = [
			[640, 'jpeg'],
			[2048, 'jpeg']
		];
		assertUrlsExist(urlsOf(view('p3', available)), available);
	});

	it('handles all three formats at differing widths', () => {
		const available: [number, 'avif' | 'webp' | 'jpeg'][] = [
			[320, 'avif'],
			[3840, 'avif'],
			[320, 'webp'],
			[1280, 'webp'],
			[1280, 'jpeg']
		];
		const v = view('p4', available);
		assertUrlsExist(urlsOf(v), available);
		// Zoom should take the most efficient format at its widest.
		expect(v.zoomSrc).toBe('/i/p4/3840.avif');
		// Preview scrapers get JPEG, at a width that exists.
		expect(v.socialSrc).toBe('/i/p4/1280.jpeg');
	});

	it('handles a single small rendition', () => {
		const available: [number, 'avif' | 'webp' | 'jpeg'][] = [[320, 'webp']];
		const v = view('p5', available);
		assertUrlsExist(urlsOf(v), available);
		// Nothing at the social width, so it falls back rather than inventing one.
		expect(v.socialSrc).toBe('/i/p5/320.webp');
	});
});
