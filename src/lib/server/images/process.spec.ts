import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import exifr from 'exifr';
import { thumbHashToRGBA } from 'thumbhash';
import { processImage } from './process';
import { DERIVATIVE_WIDTHS } from '../config';

/** A gradient rather than a flat fill, so encoders and thumbhash have real signal. */
async function testPhoto(width: number, height: number): Promise<Buffer> {
	const raw = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3;
			raw[i] = Math.round((x / width) * 255);
			raw[i + 1] = Math.round((y / height) * 255);
			raw[i + 2] = 128;
		}
	}
	return sharp(raw, { raw: { width, height, channels: 3 } })
		.jpeg()
		.toBuffer();
}

describe('processImage', () => {
	it('reports the source dimensions and produces placeholder data', async () => {
		const result = await processImage(await testPhoto(800, 600));

		expect(result.width).toBe(800);
		expect(result.height).toBe(600);
		expect(result.dominantColor).toMatch(/^#[0-9a-f]{6}$/);

		// The thumbhash must decode back to a real image, not just be a string.
		const decoded = thumbHashToRGBA(Buffer.from(result.thumbhash, 'base64'));
		expect(decoded.w).toBeGreaterThan(0);
		expect(decoded.h).toBeGreaterThan(0);
		expect(decoded.rgba.length).toBe(decoded.w * decoded.h * 4);
		// Small enough to inline in the HTML payload.
		expect(Buffer.from(result.thumbhash, 'base64').length).toBeLessThan(40);
	});

	it('generates every configured width at or below the source width', async () => {
		const result = await processImage(await testPhoto(1500, 1000));

		const expected = DERIVATIVE_WIDTHS.filter((w) => w <= 1500);
		const widths = [...new Set(result.renditions.map((r) => r.width))].sort((a, b) => a - b);

		expect(widths).toEqual([...expected].sort((a, b) => a - b));
	});

	it('never upscales beyond the source', async () => {
		const result = await processImage(await testPhoto(500, 400));
		for (const r of result.renditions) expect(r.width).toBeLessThanOrEqual(500);
	});

	it('still emits a rendition for an image smaller than the narrowest width', async () => {
		const result = await processImage(await testPhoto(120, 90));
		expect(result.renditions.length).toBeGreaterThan(0);
		expect(result.renditions.every((r) => r.width <= 120)).toBe(true);
	});

	it('preserves aspect ratio', async () => {
		const result = await processImage(await testPhoto(1200, 600));
		for (const r of result.renditions) {
			expect(r.width / r.height).toBeCloseTo(2, 1);
		}
	});

	/**
	 * The privacy guarantee: whatever the artist chooses to *display*, the files
	 * actually served carry no metadata at all. sharp drops it on re-encode, and
	 * this asserts that rather than assuming it.
	 *
	 * GPS coordinates live in the same EXIF block being removed here, so they go
	 * with it — verified via `latitude`, the field exifr surfaces when GPS is
	 * present. (sharp's `withExif` can't write a GPS IFD, so the positive case
	 * can't be constructed with a generated fixture.)
	 */
	it('strips embedded metadata from every rendition', async () => {
		const withExif = await sharp(await testPhoto(800, 600))
			.withExif({ IFD0: { Make: 'Leica', Model: 'M11' } })
			.jpeg()
			.toBuffer();

		// Precondition: the source really does carry the metadata.
		expect(await exifr.parse(withExif, true)).toMatchObject({ Make: 'Leica' });

		const result = await processImage(withExif);
		expect(result.renditions.length).toBeGreaterThan(0);

		for (const r of result.renditions) {
			const parsed = await exifr.parse(r.data, true).catch(() => null);
			expect(parsed?.Make).toBeUndefined();
			expect(parsed?.Model).toBeUndefined();
			expect(parsed?.latitude).toBeUndefined();
		}
	});

	/**
	 * A phone photo carries its rotation in an EXIF tag. Since renditions are
	 * stripped of metadata, the rotation has to be baked into the pixels or the
	 * image renders sideways.
	 */
	it('bakes in EXIF orientation before stripping it', async () => {
		// Orientation 6 = rotate 90° clockwise, so an 800x600 source displays as
		// 600x800. `withMetadata` sets the tag; `withExif` normalises it away.
		const rotated = await sharp(await testPhoto(800, 600))
			.withMetadata({ orientation: 6 })
			.jpeg()
			.toBuffer();

		const result = await processImage(rotated);
		expect(result.width).toBe(600);
		expect(result.height).toBe(800);
	});

	it('rejects data that is not an image', async () => {
		await expect(processImage(Buffer.from('definitely not an image'))).rejects.toThrow();
	});
});
