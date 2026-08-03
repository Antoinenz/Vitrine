import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, stat, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { ORIGINALS_DIR, DERIVATIVES_DIR, DATA_DIR } from './config';

/**
 * Content-addressed file storage on the local filesystem.
 *
 * Originals are keyed by the SHA-256 of their contents, sharded two levels deep
 * (`ab/cd/abcd….jpg`) so no directory ends up with tens of thousands of entries
 * — some filesystems degrade badly there, and it makes manual inspection
 * bearable. Content addressing also means re-uploading the same file costs no
 * extra disk.
 *
 * Everything lives under DATA_DIR so a backup is a single directory copy.
 */

/** Where in-progress uploads land before they're hashed and moved into place. */
const TMP_DIR = join(DATA_DIR, 'tmp');

export interface StoredFile {
	/** Path relative to the originals root, e.g. `ab/cd/abcd….jpg`. */
	storageKey: string;
	bytes: number;
	sha256: string;
	/**
	 * CRC-32 of the contents. Computed here because we're already streaming the
	 * bytes; it later lets the ZIP endpoint emit STORE entries with a known
	 * checksum and therefore an exact Content-Length.
	 */
	crc32: number;
	/** True when an identical file was already stored and this upload was discarded. */
	deduplicated: boolean;
}

/**
 * Rejects keys that would escape their root.
 *
 * Storage keys come from our own database rather than user input, but this is
 * the function that turns a string into a filesystem path — a single bug or
 * malicious row elsewhere shouldn't become arbitrary file read. Cheap to check,
 * catastrophic to omit.
 */
function safeJoin(root: string, key: string): string {
	if (key.includes('\0')) throw new Error('Invalid storage key');
	const full = resolve(root, key);
	if (full !== root && !full.startsWith(root + sep)) {
		throw new Error(`Storage key escapes its root: ${key}`);
	}
	return full;
}

/** Normalises an extension to a safe, lowercase `.ext`, or '' if implausible. */
function safeExtension(filename: string): string {
	const ext = extname(filename).toLowerCase();
	return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

function shardedKey(sha256: string, ext: string): string {
	return join(sha256.slice(0, 2), sha256.slice(2, 4), sha256 + ext);
}

/**
 * A pass-through that accumulates size, SHA-256 and CRC-32 as bytes flow by, so
 * a large upload is hashed in one pass without ever being held in memory.
 */
function createDigestStream() {
	const sha = createHash('sha256');
	let bytes = 0;
	let crc = 0;

	const stream = new Transform({
		transform(chunk: Buffer, _enc, done) {
			sha.update(chunk);
			crc = crc32(chunk, crc);
			bytes += chunk.length;
			done(null, chunk);
		}
	});

	return {
		stream,
		digest: () => ({ sha256: sha.digest('hex'), bytes, crc32: crc >>> 0 })
	};
}

/**
 * Streams `source` to disk and files it under its content hash.
 *
 * The hash isn't known until the last byte has been read, so the data is
 * written to a temporary file first and moved into place afterwards. The move
 * is a rename within the same filesystem, which is atomic — a reader can never
 * observe a half-written original.
 */
export async function storeOriginal(
	source: AsyncIterable<Uint8Array> | NodeJS.ReadableStream,
	originalName: string
): Promise<StoredFile> {
	await mkdir(TMP_DIR, { recursive: true });

	const tmpPath = join(TMP_DIR, `upload-${crypto.randomUUID()}`);
	const { stream: digestStream, digest } = createDigestStream();

	try {
		await pipeline(source, digestStream, createWriteStream(tmpPath));
	} catch (err) {
		await unlink(tmpPath).catch(() => {});
		throw err;
	}

	const { sha256, bytes, crc32: crc } = digest();

	if (bytes === 0) {
		await unlink(tmpPath).catch(() => {});
		throw new Error('Uploaded file is empty');
	}

	const storageKey = shardedKey(sha256, safeExtension(originalName));
	const finalPath = safeJoin(ORIGINALS_DIR, storageKey);

	// Identical content already stored — keep the existing copy and drop ours.
	if (await exists(finalPath)) {
		await unlink(tmpPath).catch(() => {});
		return { storageKey, bytes, sha256, crc32: crc, deduplicated: true };
	}

	await mkdir(dirname(finalPath), { recursive: true });
	await rename(tmpPath, finalPath);

	return { storageKey, bytes, sha256, crc32: crc, deduplicated: false };
}

/** Absolute path of a stored original. */
export function originalPath(storageKey: string): string {
	return safeJoin(ORIGINALS_DIR, storageKey);
}

/** Absolute path of a stored rendition. */
export function derivativePath(storageKey: string): string {
	return safeJoin(DERIVATIVES_DIR, storageKey);
}

/**
 * Renditions are keyed by photo id, so all of a photo's variants sit together
 * and can be removed with one recursive delete. They're regenerable, so unlike
 * originals there's nothing to gain from content addressing.
 */
export function derivativeKey(photoId: string, width: number, format: string): string {
	return join(photoId.slice(0, 2), photoId, `${width}.${format}`);
}

export async function writeDerivative(storageKey: string, data: Buffer): Promise<number> {
	const path = safeJoin(DERIVATIVES_DIR, storageKey);
	await mkdir(dirname(path), { recursive: true });
	// Written via a temp file and renamed so a concurrent request can never read
	// a partially written image.
	const tmp = `${path}.${process.pid}.tmp`;
	await mkdir(TMP_DIR, { recursive: true });
	const { writeFile } = await import('node:fs/promises');
	await writeFile(tmp, data);
	await rename(tmp, path);
	return data.length;
}

export async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Removes every rendition belonging to a photo. */
export async function deleteDerivatives(photoId: string): Promise<void> {
	const dir = safeJoin(DERIVATIVES_DIR, join(photoId.slice(0, 2), photoId));
	await rm(dir, { recursive: true, force: true });
}

/**
 * Deletes an original.
 *
 * Because storage is content-addressed, two photo rows can legitimately point
 * at the same file (the same image uploaded to two collections). The caller
 * must confirm no other row references this key before calling — otherwise
 * deleting one photo would blank the other.
 */
export async function deleteOriginal(storageKey: string): Promise<void> {
	await rm(safeJoin(ORIGINALS_DIR, storageKey), { force: true });
}

/** Clears abandoned temp files, e.g. from an upload interrupted by a restart. */
export async function cleanTempFiles(): Promise<void> {
	await rm(TMP_DIR, { recursive: true, force: true });
	await mkdir(TMP_DIR, { recursive: true });
}
