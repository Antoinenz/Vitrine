import { join, isAbsolute, resolve } from 'node:path';

/**
 * Central runtime configuration, read from the environment.
 *
 * Uses `process.env` rather than `$env/dynamic/private` so the same module works
 * inside SvelteKit request handlers *and* in standalone scripts (migrations,
 * seeding, the derivative worker) that run outside the Vite/Kit runtime.
 */

function str(name: string, fallback: string): string {
	const v = process.env[name];
	return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
	const v = process.env[name];
	if (v === undefined || v === '') return fallback;
	const n = Number(v);
	if (!Number.isFinite(n)) {
		throw new Error(`Environment variable ${name} must be a number, got "${v}"`);
	}
	return n;
}

/** Root of all mutable state. A backup is "copy this directory". */
export const DATA_DIR = resolve(str('DATA_DIR', './data'));

/**
 * `DATABASE_URL` may be absolute or relative; when relative it is resolved
 * inside DATA_DIR so a single volume mount captures database and images alike.
 */
const rawDbUrl = str('DATABASE_URL', 'vitrine.db');
export const DATABASE_PATH = isAbsolute(rawDbUrl) ? rawDbUrl : join(DATA_DIR, rawDbUrl);

export const ORIGINALS_DIR = join(DATA_DIR, 'originals');
export const DERIVATIVES_DIR = join(DATA_DIR, 'derivatives');

/**
 * Rendition widths. A photo is never upscaled, so sources narrower than a given
 * width simply don't get that rendition.
 *
 * 320 doubles as the filmstrip thumbnail; 3840 covers 4K displays at full-bleed.
 */
export const DERIVATIVE_WIDTHS = [320, 640, 1280, 2048, 3840] as const;

export type ImageFormat = 'avif' | 'webp' | 'jpeg';

/**
 * AVIF encoding is genuinely expensive — on a small VPS a 4K encode can take
 * seconds of CPU per rendition. Self-hosters on modest hardware can drop to
 * `webp` alone; the browser picks whatever is offered via <picture>.
 */
export const IMAGE_FORMATS: ImageFormat[] = str('IMAGE_FORMATS', 'avif,webp')
	.split(',')
	.map((f) => f.trim().toLowerCase())
	.filter((f): f is ImageFormat => f === 'avif' || f === 'webp' || f === 'jpeg');

if (IMAGE_FORMATS.length === 0) {
	throw new Error('IMAGE_FORMATS must list at least one of: avif, webp, jpeg');
}

/** Largest accepted upload, per file. */
export const MAX_UPLOAD_BYTES = int('MAX_UPLOAD_MB', 100) * 1024 * 1024;

/**
 * How many photos are processed concurrently. Each sharp pipeline can hold a
 * decoded 4K bitmap plus its encode buffers, so this is the main lever on peak
 * memory during a bulk upload.
 */
export const WORKER_CONCURRENCY = int('WORKER_CONCURRENCY', 2);

/** Session lifetime, and the point at which an active session is renewed. */
export const SESSION_TTL_MS = int('SESSION_TTL_DAYS', 30) * 24 * 60 * 60 * 1000;

/** Bootstrap credentials, applied only when no user exists yet. */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
