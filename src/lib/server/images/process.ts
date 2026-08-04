import sharp, { type Sharp } from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { DERIVATIVE_WIDTHS, IMAGE_FORMATS, type ImageFormat } from '../config';

/**
 * Rendition generation.
 *
 * Every output here is re-encoded from the original by sharp, which strips all
 * metadata by default. That is the property that keeps the public-facing files
 * clean: whatever the artist chooses to *display*, the served images themselves
 * carry no EXIF and no GPS coordinates.
 */

export interface Rendition {
	width: number;
	height: number;
	format: ImageFormat;
	data: Buffer;
}

export interface ProcessedImage {
	width: number;
	height: number;
	/** ThumbHash bytes, base64 — ~25 bytes, small enough to inline in HTML. */
	thumbhash: string;
	/** Average colour, used as the backdrop while an image decodes. */
	dominantColor: string;
	renditions: Rendition[];
}

/**
 * Encoder settings.
 *
 * Quality is a touch higher than a typical web default because this is a
 * photography portfolio — visible ringing around high-contrast edges is worse
 * here than a slightly larger file.
 *
 * `effort` is the CPU/size trade-off. AVIF's default effort (4) is slow enough
 * to be a problem when a self-hoster drops 200 photos onto a small VPS, so it's
 * lowered; the size penalty is a few percent.
 */
const ENCODERS: Record<ImageFormat, (p: Sharp) => Sharp> = {
	avif: (p) => p.avif({ quality: 58, effort: 3, chromaSubsampling: '4:2:0' }),
	webp: (p) => p.webp({ quality: 80, effort: 4 }),
	jpeg: (p) => p.jpeg({ quality: 82, progressive: true, mozjpeg: true })
};

/**
 * ThumbHash requires an image of at most 100×100. The aspect ratio is preserved
 * so the placeholder matches the photo's shape rather than being squared off.
 */
async function computeThumbhash(image: Sharp): Promise<string> {
	const { data, info } = await image
		.clone()
		.resize(100, 100, { fit: 'inside', withoutEnlargement: true })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const hash = rgbaToThumbHash(info.width, info.height, data);
	return Buffer.from(hash).toString('base64');
}

async function computeDominantColor(image: Sharp): Promise<string> {
	const { dominant } = await image.clone().stats();
	const hex = (n: number) => n.toString(16).padStart(2, '0');
	return `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
}

/**
 * Caps libvips' internal thread pool.
 *
 * sharp parallelises each operation across cores by default. Combined with the
 * worker running several photos at once, that oversubscribes CPU and multiplies
 * peak memory — the usual cause of a bulk upload OOM-ing a small VPS. Per-image
 * concurrency is limited here; overall throughput comes from WORKER_CONCURRENCY.
 */
sharp.concurrency(1);

/** Width of the JPEG generated for link previews. */
export const SOCIAL_WIDTH = 1280;

/**
 * Generates every rendition for one image, plus its placeholder data.
 *
 * Widths larger than the source are skipped rather than upscaled — enlarging a
 * photo produces a bigger file that looks worse than the original.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
	// `rotate()` with no argument applies the EXIF orientation tag and then drops
	// it. Without this, a phone photo taken in portrait renders sideways once the
	// metadata is stripped.
	const base = sharp(input, { failOn: 'none' }).rotate();

	const metadata = await base.metadata();

	/**
	 * `metadata.width`/`height` are the dimensions as *stored*, before EXIF
	 * orientation is applied — a portrait phone photo commonly reports 4000×3000
	 * with an orientation tag saying "rotate 90°". Since `rotate()` bakes that
	 * rotation into the pixels, the stored numbers would be transposed relative
	 * to what we actually serve.
	 *
	 * That matters well beyond metadata: these values drive the aspect-ratio box
	 * the grid reserves and the target rectangle the Flip transition animates
	 * into, so getting them backwards would visibly break the layout for every
	 * rotated photo. `autoOrient` reports the post-rotation dimensions.
	 */
	const width = metadata.autoOrient?.width || metadata.width || 0;
	const height = metadata.autoOrient?.height || metadata.height || 0;

	if (!width || !height) {
		throw new Error('Could not read image dimensions — file may not be an image');
	}

	const [thumbhash, dominantColor] = await Promise.all([
		computeThumbhash(base),
		computeDominantColor(base)
	]);

	const targetWidths = DERIVATIVE_WIDTHS.filter((w) => w <= width);
	// A photo smaller than the narrowest rendition still needs one file to serve.
	if (targetWidths.length === 0) targetWidths.push(width as never);

	const renditions: Rendition[] = [];

	// Sequential on purpose: `sharp.concurrency(1)` plus the worker's own
	// parallelism already saturates the CPU. Fanning out here as well would
	// multiply peak memory by the number of widths for no throughput gain.
	for (const targetWidth of targetWidths) {
		const resized = base
			.clone()
			.resize(targetWidth, undefined, { withoutEnlargement: true, fit: 'inside' });

		for (const format of IMAGE_FORMATS) {
			const { data, info } = await ENCODERS[format](resized.clone()).toBuffer({
				resolveWithObject: true
			});
			renditions.push({ width: info.width, height: info.height, format, data });
		}
	}

	/**
	 * Always emit one JPEG for social previews, whatever `IMAGE_FORMATS` says.
	 *
	 * OpenGraph scrapers are far behind browsers on format support — several
	 * still can't decode AVIF or WebP — and an install configured for
	 * `avif,webp` alone would otherwise advertise an `og:image` URL that doesn't
	 * exist. One extra encode per photograph is a small price for link previews
	 * that work.
	 */
	if (!IMAGE_FORMATS.includes('jpeg')) {
		const socialWidth = Math.min(SOCIAL_WIDTH, width);
		const { data, info } = await ENCODERS.jpeg(
			base.clone().resize(socialWidth, undefined, { withoutEnlargement: true, fit: 'inside' })
		).toBuffer({ resolveWithObject: true });

		renditions.push({ width: info.width, height: info.height, format: 'jpeg', data });
	}

	return { width, height, thumbhash, dominantColor, renditions };
}

/**
 * Re-encodes an original with its metadata removed, for artists who enable
 * downloads but would rather not hand out GPS coordinates.
 *
 * Quality is high because this stands in for "the original file". It is still
 * a re-encode, so it is not bit-identical to what was uploaded — the honest
 * trade for stripping embedded location data.
 */
export async function stripMetadata(input: Buffer): Promise<Buffer> {
	return sharp(input, { failOn: 'none' })
		.rotate()
		.jpeg({ quality: 95, progressive: true, mozjpeg: true })
		.toBuffer();
}
