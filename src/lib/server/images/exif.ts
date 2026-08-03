import exifr from 'exifr';
import type { PhotoExif, MetadataField } from '../db/schema';

/**
 * EXIF extraction and, more importantly, the projection that decides what ever
 * reaches a browser.
 *
 * We read metadata once at upload and store the normalised result. Nothing here
 * is sent to a client directly — `projectExif` filters it through the artist's
 * per-collection allow-list first.
 */

/**
 * Tags we ask exifr for. Naming them explicitly keeps parsing cheap (exifr
 * seeks rather than reading whole files) and means a camera embedding something
 * unexpected — owner name, serial number, GPS timestamps — is never stored at
 * all rather than stored and merely not displayed.
 */
const PICK = [
	'Make',
	'Model',
	'LensModel',
	'FocalLength',
	'FocalLengthIn35mmFormat',
	'FNumber',
	'ExposureTime',
	'ISO',
	'DateTimeOriginal',
	'CreateDate',
	'latitude',
	'longitude',
	'Orientation'
];

/** Formats a shutter speed the way a photographer expects: 1/250, or 2.5" when long. */
function formatShutter(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '';
	if (seconds >= 1) return `${Number(seconds.toFixed(1))}"`;
	return `1/${Math.round(1 / seconds)}`;
}

function formatAperture(fNumber: number): string {
	if (!Number.isFinite(fNumber) || fNumber <= 0) return '';
	// f/2.8 but f/8 — no trailing ".0".
	return `f/${Number(fNumber.toFixed(1))}`;
}

function formatFocalLength(mm: number): string {
	if (!Number.isFinite(mm) || mm <= 0) return '';
	return `${Math.round(mm)}mm`;
}

/**
 * Camera make and model overlap constantly ("NIKON CORPORATION" + "NIKON Z 6").
 * Joining them blindly produces "NIKON CORPORATION NIKON Z 6", so drop the make
 * when the model already implies it.
 */
function formatCamera(make?: string, model?: string): string {
	const m = (make ?? '').trim();
	const mod = (model ?? '').trim();
	if (!mod) return m;
	if (!m) return mod;

	const firstWord = m.split(/\s+/)[0].toLowerCase();
	if (mod.toLowerCase().startsWith(firstWord)) return mod;
	return `${m} ${mod}`;
}

export interface ExtractedExif {
	exif: PhotoExif;
	/**
	 * EXIF orientation (1–8). sharp applies this when generating renditions, so
	 * it's returned separately rather than stored for display.
	 */
	orientation?: number;
}

/**
 * Reads EXIF from an image buffer. Never throws: a file with corrupt or absent
 * metadata is perfectly valid and must not fail an upload.
 */
export async function extractExif(buffer: Buffer): Promise<ExtractedExif> {
	let raw: Record<string, unknown> | undefined;

	try {
		raw =
			(await exifr.parse(buffer, {
				pick: PICK,
				// Ask for GPS so the artist *can* opt into showing location; it is
				// withheld by default in `projectExif` and stripped from every
				// generated rendition regardless.
				gps: true,
				translateValues: true,
				reviveValues: true
			})) ?? undefined;
	} catch {
		return { exif: {} };
	}

	if (!raw) return { exif: {} };

	return normalizeExifTags(raw);
}

/**
 * Turns exifr's raw tag bag into our stored shape.
 *
 * Separated from `extractExif` so it can be tested directly against the values
 * exifr actually produces (`FNumber` as a number, `ExposureTime` in seconds,
 * `DateTimeOriginal` as a Date). Testing this through a generated fixture
 * instead would mostly exercise whichever encoder wrote the file.
 */
export function normalizeExifTags(raw: Record<string, unknown>): ExtractedExif {
	const exif: PhotoExif = {};

	const camera = formatCamera(raw.Make as string, raw.Model as string);
	if (camera) exif.camera = camera;

	const lens = (raw.LensModel as string)?.trim();
	if (lens) exif.lens = lens;

	const focal = formatFocalLength(raw.FocalLength as number);
	if (focal) exif.focalLength = focal;

	const aperture = formatAperture(raw.FNumber as number);
	if (aperture) exif.aperture = aperture;

	const shutter = formatShutter(raw.ExposureTime as number);
	if (shutter) exif.shutterSpeed = shutter;

	const iso = raw.ISO;
	if (typeof iso === 'number' && Number.isFinite(iso)) exif.iso = Math.round(iso);

	const taken = (raw.DateTimeOriginal ?? raw.CreateDate) as Date | undefined;
	if (taken instanceof Date && !Number.isNaN(taken.getTime())) {
		exif.takenAt = taken.toISOString();
	}

	const lat = raw.latitude;
	const lon = raw.longitude;
	if (
		typeof lat === 'number' &&
		typeof lon === 'number' &&
		Number.isFinite(lat) &&
		Number.isFinite(lon)
	) {
		exif.location = { lat, lon };
	}

	const orientation = typeof raw.Orientation === 'number' ? raw.Orientation : undefined;

	return { exif, orientation };
}

/**
 * Filters stored EXIF down to the fields the artist chose to publish.
 *
 * This is the boundary between "what we know about a photo" and "what the
 * internet knows". It is deliberately an allow-list: a field is published only
 * by being named. Adding a new EXIF tag to extraction therefore can't leak it
 * by default, and location — the field with real-world safety implications,
 * since it can pin down a photographer's home — stays hidden unless explicitly
 * and knowingly enabled.
 *
 * Callers must use this before serialising a photo into any response.
 */
export function projectExif(
	exif: PhotoExif | null | undefined,
	allowed: MetadataField[] | null | undefined
): PhotoExif {
	if (!exif || !allowed?.length) return {};

	const out: PhotoExif = {};
	for (const field of allowed) {
		switch (field) {
			case 'camera':
				if (exif.camera) out.camera = exif.camera;
				break;
			case 'lens':
				if (exif.lens) out.lens = exif.lens;
				break;
			case 'focalLength':
				if (exif.focalLength) out.focalLength = exif.focalLength;
				break;
			case 'aperture':
				if (exif.aperture) out.aperture = exif.aperture;
				break;
			case 'shutterSpeed':
				if (exif.shutterSpeed) out.shutterSpeed = exif.shutterSpeed;
				break;
			case 'iso':
				if (exif.iso !== undefined) out.iso = exif.iso;
				break;
			case 'takenAt':
				if (exif.takenAt) out.takenAt = exif.takenAt;
				break;
			case 'location':
				if (exif.location) out.location = exif.location;
				break;
		}
	}
	return out;
}
