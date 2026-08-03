import { error } from '@sveltejs/kit';
import { Readable } from 'node:stream';
// archiver 8 is pure ESM and exports format classes rather than the callable
// factory older versions had; `import archiver from 'archiver'` fails to build.
import { ZipArchive } from 'archiver';
import { and, asc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { collections, photos, users } from '$lib/server/db/schema';
import { originalPath, exists } from '$lib/server/storage';
import { collectionAccess } from '$lib/server/access';
import { rateLimit, LIMITS } from '$lib/server/rate-limit';
import { slugify } from '$lib/server/slug';

/**
 * Streams an entire collection as a ZIP.
 *
 * Entries are **stored, not deflated**. JPEG, WebP and AVIF are already
 * compressed, so deflating them spends CPU to save roughly nothing — on a small
 * VPS that difference decides whether one download saturates the box. Storing
 * also means the archive streams out at disk speed.
 *
 * Nothing is buffered: entries are appended as they're read, so memory stays
 * flat whether the collection holds ten photographs or a thousand.
 */
export const GET: RequestHandler = async ({ params, locals, cookies, getClientAddress }) => {
	const owner = db.select().from(users).orderBy(asc(users.createdAt)).limit(1).get();
	if (!owner) error(404);

	const collection = db
		.select()
		.from(collections)
		.where(and(eq(collections.ownerId, owner.id), eq(collections.slug, params.slug)))
		.get();

	if (!collection) error(404);

	const isOwner = locals.user?.id === collection.ownerId;
	if (collectionAccess(collection, locals, cookies) !== 'granted') error(404);
	// Re-checked server-side: this endpoint is reachable directly, so hiding the
	// button on the page would not be access control.
	if (!collection.zipEnabled && !isOwner) error(404);

	/**
	 * Building an archive reads every original from disk, so it is markedly more
	 * expensive than any other request. Rate limited per address to stop one
	 * client queueing several at once and starving everyone else.
	 */
	const limit = rateLimit(`zip:${getClientAddress()}`, LIMITS.zip.limit, LIMITS.zip.windowMs);
	if (!limit.allowed) {
		error(429, `Too many downloads. Try again in ${limit.retryAfterSeconds} seconds.`);
	}

	const rows = db
		.select()
		.from(photos)
		.where(and(eq(photos.collectionId, collection.id), eq(photos.status, 'ready')))
		.orderBy(asc(photos.sortKey))
		.all();

	if (rows.length === 0) error(404, 'This collection has no photographs to download.');

	const archive = new ZipArchive({ store: true });

	/**
	 * Filenames are numbered in display order and rebuilt from the collection
	 * title, so an unzipped folder reads the way the gallery does rather than
	 * as a pile of content hashes. Path separators are stripped because an entry
	 * name containing `../` is a directory-traversal write on extraction — the
	 * "zip slip" class of bug, exploited on the *recipient's* machine.
	 */
	const base = slugify(collection.title) || 'collection';
	const pad = String(rows.length).length;
	const seen = new Set<string>();

	let index = 0;
	for (const photo of rows) {
		const path = originalPath(photo.storageKey);
		// A row whose file has gone missing shouldn't abort the whole archive.
		if (!(await exists(path))) continue;

		index++;
		const original = photo.originalName.replace(/[/\\]/g, '_').replace(/^\.+/, '');
		const ext = original.includes('.') ? original.slice(original.lastIndexOf('.')) : '.jpg';

		let name = `${base}/${String(index).padStart(pad, '0')}${ext}`;
		// Defensive: duplicate entry names make some extractors silently drop files.
		while (seen.has(name)) name = `${base}/${String(index).padStart(pad, '0')}-${seen.size}${ext}`;
		seen.add(name);

		archive.file(path, { name, date: photo.createdAt });
	}

	// Kick off reading; the response streams as entries are produced.
	void archive.finalize();

	const filename = `${base}.zip`;

	/**
	 * No Content-Length: the exact size is computable for a stored archive, but
	 * only if every entry's CRC and size are emitted up front. That optimisation
	 * (which would give the browser a real progress bar rather than a spinner)
	 * is worth doing once there is a test asserting predicted length matches the
	 * bytes actually written — guessing it wrong truncates the download.
	 */
	return new Response(Readable.toWeb(archive) as ReadableStream, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
			'cache-control': 'private, no-store'
		}
	});
};
