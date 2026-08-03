import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import {
	storeOriginal,
	originalPath,
	derivativePath,
	derivativeKey,
	writeDerivative,
	exists
} from './storage';

function streamOf(text: string) {
	return Readable.from([Buffer.from(text)]);
}

describe('storeOriginal', () => {
	it('stores a file and reports its size and checksums', async () => {
		const content = `hello ${crypto.randomUUID()}`;
		const stored = await storeOriginal(streamOf(content), 'photo.JPG');

		expect(stored.bytes).toBe(Buffer.byteLength(content));
		expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
		// The CRC is what the ZIP writer later relies on, so it must be the real
		// checksum of the stored bytes.
		expect(stored.crc32).toBe(crc32(Buffer.from(content)) >>> 0);
		expect(stored.deduplicated).toBe(false);

		const onDisk = await readFile(originalPath(stored.storageKey));
		expect(onDisk.toString()).toBe(content);
	});

	it('shards the path by hash prefix and normalises the extension', async () => {
		const stored = await storeOriginal(streamOf(crypto.randomUUID()), 'Photo.JPG');
		const [a, b, file] = stored.storageKey.split(/[/\\]/);

		expect(a).toBe(stored.sha256.slice(0, 2));
		expect(b).toBe(stored.sha256.slice(2, 4));
		expect(file).toBe(`${stored.sha256}.jpg`);
	});

	it('deduplicates identical content instead of storing it twice', async () => {
		const content = `dup ${crypto.randomUUID()}`;
		const first = await storeOriginal(streamOf(content), 'a.jpg');
		const second = await storeOriginal(streamOf(content), 'b.jpg');

		expect(second.storageKey).toBe(first.storageKey);
		expect(second.deduplicated).toBe(true);
		expect(second.crc32).toBe(first.crc32);
	});

	it('rejects an empty upload', async () => {
		await expect(storeOriginal(Readable.from([]), 'empty.jpg')).rejects.toThrow(/empty/i);
	});

	/**
	 * Content-Length is client-supplied, so a client can understate it and keep
	 * sending. The limit has to hold as bytes actually arrive, or one request
	 * could fill the disk.
	 */
	it('aborts mid-stream when the size limit is exceeded', async () => {
		const chunks = Array.from({ length: 20 }, () => Buffer.alloc(1024, 1));

		await expect(storeOriginal(Readable.from(chunks), 'big.jpg', 4096)).rejects.toThrow(/exceeds/i);
	});

	it('leaves no temp file behind when an upload is rejected', async () => {
		const { readdir } = await import('node:fs/promises');
		const tmpDir = originalPath('.').replace(/originals\/?\.?$/, 'tmp');

		const before = await readdir(tmpDir).catch(() => []);
		await storeOriginal(Readable.from([Buffer.alloc(8192, 1)]), 'big.jpg', 1024).catch(() => {});
		const after = await readdir(tmpDir).catch(() => []);

		expect(after.length).toBe(before.length);
	});

	it('accepts a file exactly at the limit', async () => {
		const data = Buffer.alloc(1024, 7);
		const stored = await storeOriginal(Readable.from([data]), 'exact.jpg', 1024);
		expect(stored.bytes).toBe(1024);
	});

	it('drops a filename extension that is not plausible', async () => {
		const stored = await storeOriginal(streamOf(crypto.randomUUID()), 'weird.this-is-not-an-ext');
		expect(stored.storageKey.endsWith(stored.sha256)).toBe(true);
	});
});

/**
 * Storage keys come from our own database, but this is the code that turns a
 * string into a filesystem path. A traversal bug here would be an arbitrary
 * file read, so the guard is asserted directly.
 */
describe('path safety', () => {
	it('refuses keys that climb out of the storage root', () => {
		expect(() => originalPath('../../etc/passwd')).toThrow(/escapes/);
		expect(() => originalPath('/etc/passwd')).toThrow(/escapes/);
		expect(() => originalPath('ab/../../../etc/passwd')).toThrow(/escapes/);
	});

	it('refuses keys containing a null byte', () => {
		expect(() => originalPath('ab/cd\0.jpg')).toThrow(/Invalid storage key/);
	});

	it('accepts ordinary keys', () => {
		expect(() => originalPath('ab/cd/abcd.jpg')).not.toThrow();
	});
});

describe('derivatives', () => {
	it('groups a photo’s renditions under its id', () => {
		const key = derivativeKey('abcdef12-3456', 1280, 'webp');
		expect(key).toContain('abcdef12-3456');
		expect(key.endsWith('1280.webp')).toBe(true);
	});

	it('writes a rendition to disk', async () => {
		const key = derivativeKey(crypto.randomUUID(), 320, 'webp');
		const data = Buffer.from('fake-image-bytes');

		const written = await writeDerivative(key, data);

		expect(written).toBe(data.length);
		expect(await exists(derivativePath(key))).toBe(true);
		expect((await readFile(derivativePath(key))).toString()).toBe('fake-image-bytes');
	});

	it('leaves no temp files behind after a write', async () => {
		const key = derivativeKey(crypto.randomUUID(), 640, 'avif');
		await writeDerivative(key, Buffer.from('x'));
		// The write goes via a temp file and is renamed into place, so a reader can
		// never observe a half-written image.
		expect(await exists(`${derivativePath(key)}.${process.pid}.tmp`)).toBe(false);
	});
});
