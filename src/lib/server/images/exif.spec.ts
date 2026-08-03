import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { extractExif, projectExif, normalizeExifTags } from './exif';
import type { PhotoExif } from '../db/schema';

const FULL: PhotoExif = {
	camera: 'Fujifilm X-T5',
	lens: 'XF23mmF1.4 R',
	focalLength: '23mm',
	aperture: 'f/1.4',
	shutterSpeed: '1/250',
	iso: 160,
	takenAt: '2026-01-02T10:00:00.000Z',
	location: { lat: 46.5, lon: 7.9 }
};

/**
 * `projectExif` is the boundary between what the server knows about a photo and
 * what the internet learns. These tests assert the *absence* of data, which is
 * the property that actually matters — a hidden field must not be present in
 * the payload at all, not merely left unrendered by a component.
 */
describe('projectExif', () => {
	it('returns nothing when no fields are allowed', () => {
		expect(projectExif(FULL, [])).toEqual({});
		expect(projectExif(FULL, null)).toEqual({});
		expect(projectExif(FULL, undefined)).toEqual({});
	});

	it('returns nothing when there is no exif', () => {
		expect(projectExif(null, ['camera'])).toEqual({});
		expect(projectExif({}, ['camera'])).toEqual({});
	});

	it('includes only the allow-listed fields', () => {
		expect(projectExif(FULL, ['camera', 'aperture'])).toEqual({
			camera: 'Fujifilm X-T5',
			aperture: 'f/1.4'
		});
	});

	/**
	 * Location can identify where a photographer lives. It must never ride along
	 * with an unrelated field, and must be absent — not null, not undefined-keyed
	 * — from the serialised payload.
	 */
	it('withholds location unless explicitly allowed', () => {
		const projected = projectExif(FULL, [
			'camera',
			'lens',
			'focalLength',
			'aperture',
			'shutterSpeed',
			'iso',
			'takenAt'
		]);

		expect(projected.location).toBeUndefined();
		expect(Object.keys(projected)).not.toContain('location');
		expect(JSON.stringify(projected)).not.toContain('46.5');
	});

	it('includes location when the artist opts in', () => {
		expect(projectExif(FULL, ['location'])).toEqual({ location: { lat: 46.5, lon: 7.9 } });
	});

	it('ignores allow-listed fields the photo does not have', () => {
		expect(projectExif({ camera: 'Leica M6' }, ['camera', 'lens', 'iso'])).toEqual({
			camera: 'Leica M6'
		});
	});

	it('preserves an ISO of 0 rather than dropping it as falsy', () => {
		expect(projectExif({ iso: 0 }, ['iso'])).toEqual({ iso: 0 });
	});
});

describe('extractExif', () => {
	it('returns empty metadata for an image with none, without throwing', async () => {
		const plain = await sharp({
			create: { width: 32, height: 32, channels: 3, background: '#334455' }
		})
			.jpeg()
			.toBuffer();

		await expect(extractExif(plain)).resolves.toEqual({ exif: {} });
	});

	it('does not throw on data that is not an image', async () => {
		await expect(extractExif(Buffer.from('this is not an image'))).resolves.toEqual({
			exif: {}
		});
	});

	it('reads real embedded tags from a generated file', async () => {
		const withExif = await sharp({
			create: { width: 64, height: 64, channels: 3, background: '#888' }
		})
			.withExif({ IFD0: { Make: 'NIKON CORPORATION', Model: 'NIKON Z 6' } })
			.jpeg()
			.toBuffer();

		const { exif } = await extractExif(withExif);
		// "NIKON CORPORATION" + "NIKON Z 6" must not become "NIKON CORPORATION NIKON Z 6".
		expect(exif.camera).toBe('NIKON Z 6');
	});
});

/**
 * These run against the shapes exifr actually returns, which is where the
 * formatting logic lives. Driving them through a generated JPEG instead would
 * mostly test sharp's EXIF writer — it silently drops rational tags such as
 * FNumber, so a fixture-based test would assert nothing useful.
 */
describe('normalizeExifTags', () => {
	it('formats a typical frame', () => {
		const { exif } = normalizeExifTags({
			Make: 'FUJIFILM',
			Model: 'X-T5',
			LensModel: 'XF23mmF1.4 R',
			FNumber: 1.4,
			ExposureTime: 0.004,
			ISO: 160,
			FocalLength: 23,
			DateTimeOriginal: new Date('2026-01-02T10:00:00Z')
		});

		expect(exif).toEqual({
			// Make and model don't overlap here, so both are kept.
			camera: 'FUJIFILM X-T5',
			lens: 'XF23mmF1.4 R',
			aperture: 'f/1.4',
			shutterSpeed: '1/250',
			iso: 160,
			focalLength: '23mm',
			takenAt: '2026-01-02T10:00:00.000Z'
		});
	});

	it('renders long exposures in seconds rather than a fraction', () => {
		expect(normalizeExifTags({ ExposureTime: 2.5 }).exif.shutterSpeed).toBe('2.5"');
		expect(normalizeExifTags({ ExposureTime: 1 }).exif.shutterSpeed).toBe('1"');
	});

	it('drops the trailing zero on whole-stop apertures', () => {
		expect(normalizeExifTags({ FNumber: 8 }).exif.aperture).toBe('f/8');
		expect(normalizeExifTags({ FNumber: 2.8 }).exif.aperture).toBe('f/2.8');
	});

	it('keeps the make when the model does not already imply it', () => {
		expect(normalizeExifTags({ Make: 'Hasselblad', Model: '907X' }).exif.camera).toBe(
			'Hasselblad 907X'
		);
	});

	it('captures GPS when present', () => {
		expect(normalizeExifTags({ latitude: 46.5, longitude: 7.9 }).exif.location).toEqual({
			lat: 46.5,
			lon: 7.9
		});
	});

	it('ignores nonsensical values instead of emitting garbage', () => {
		const { exif } = normalizeExifTags({
			FNumber: 0,
			ExposureTime: -1,
			FocalLength: 0,
			ISO: Number.NaN,
			DateTimeOriginal: new Date('nope'),
			latitude: 46.5 // longitude missing, so the pair is unusable
		});
		expect(exif).toEqual({});
	});

	it('returns nothing for an empty tag bag', () => {
		expect(normalizeExifTags({}).exif).toEqual({});
	});
});
