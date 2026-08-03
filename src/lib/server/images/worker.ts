import { readFile } from 'node:fs/promises';
import { eq, inArray, asc } from 'drizzle-orm';
import { db } from '../db';
import { photos, derivatives } from '../db/schema';
import { WORKER_CONCURRENCY } from '../config';
import { originalPath, derivativeKey, writeDerivative } from '../storage';
import { processImage } from './process';
import { extractExif } from './exif';

/**
 * Background generation of renditions.
 *
 * An in-process queue, with its state persisted in `photos.status` rather than
 * held only in memory. That choice is deliberate: requiring Redis and a
 * separate worker process to resize images would be the single heaviest
 * operational burden in an app whose premise is that one person can run it on a
 * cheap VPS.
 *
 * Durability comes from the database. `status` is the queue: a row is `pending`
 * until picked up, `processing` while in flight, then `ready` or `failed`. If
 * the process dies mid-encode, `requeueInterrupted()` at startup returns
 * anything stranded in `processing` to `pending`, so work resumes rather than
 * being silently lost.
 */

let running = 0;
let scheduled = false;

/**
 * Returns `processing` rows to `pending`.
 *
 * Only ever called at startup, when by definition nothing is in flight — so any
 * row still marked `processing` belongs to a previous, dead process.
 */
export function requeueInterrupted(): number {
	const stranded = db
		.select({ id: photos.id })
		.from(photos)
		.where(eq(photos.status, 'processing'))
		.all();

	if (stranded.length === 0) return 0;

	db.update(photos)
		.set({ status: 'pending', error: null })
		.where(
			inArray(
				photos.id,
				stranded.map((p) => p.id)
			)
		)
		.run();

	return stranded.length;
}

/**
 * Claims the next queued photo.
 *
 * The select and the update run in one transaction so two concurrent workers
 * can't claim the same row — SQLite serialises write transactions, so the
 * second sees the row already marked `processing`.
 */
function claimNext(): string | null {
	return db.transaction((tx) => {
		const next = tx
			.select({ id: photos.id })
			.from(photos)
			.where(eq(photos.status, 'pending'))
			.orderBy(asc(photos.createdAt))
			.limit(1)
			.get();

		if (!next) return null;

		tx.update(photos).set({ status: 'processing' }).where(eq(photos.id, next.id)).run();
		return next.id;
	});
}

async function processOne(photoId: string): Promise<void> {
	const photo = db.select().from(photos).where(eq(photos.id, photoId)).get();
	if (!photo) return;

	const buffer = await readFile(originalPath(photo.storageKey));

	const [processed, { exif }] = await Promise.all([processImage(buffer), extractExif(buffer)]);

	const rows = await Promise.all(
		processed.renditions.map(async (r) => {
			const key = derivativeKey(photoId, r.width, r.format);
			const bytes = await writeDerivative(key, r.data);
			return {
				id: crypto.randomUUID(),
				photoId,
				width: r.width,
				height: r.height,
				format: r.format,
				storageKey: key,
				bytes
			};
		})
	);

	// Files are on disk before the transaction, so the database only ever claims
	// a rendition exists once it actually does.
	db.transaction((tx) => {
		// Clearing first makes reprocessing idempotent — otherwise a re-run would
		// collide with the unique (photo, width, format) index.
		tx.delete(derivatives).where(eq(derivatives.photoId, photoId)).run();
		if (rows.length) tx.insert(derivatives).values(rows).run();

		tx.update(photos)
			.set({
				width: processed.width,
				height: processed.height,
				thumbhash: processed.thumbhash,
				dominantColor: processed.dominantColor,
				exif,
				status: 'ready',
				error: null
			})
			.where(eq(photos.id, photoId))
			.run();
	});
}

async function drain(): Promise<void> {
	scheduled = false;

	while (running < WORKER_CONCURRENCY) {
		const photoId = claimNext();
		if (!photoId) return;

		running++;
		void processOne(photoId)
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[gallery] Failed to process photo ${photoId}: ${message}`);
				// Recorded rather than retried: a file that isn't a valid image will
				// fail identically forever, and an endless retry loop would bury the
				// queue. The admin UI surfaces this so it can be re-tried deliberately.
				db.update(photos)
					.set({ status: 'failed', error: message.slice(0, 500) })
					.where(eq(photos.id, photoId))
					.run();
			})
			.finally(() => {
				running--;
				// A slot freed up; there may be more waiting.
				schedule();
			});
	}
}

/** Asks the worker to look for queued photos. Cheap and safe to call often. */
export function schedule(): void {
	if (scheduled) return;
	scheduled = true;
	// Defers to the next tick so a request handler that enqueues several photos
	// returns before encoding starts competing for CPU.
	setTimeout(() => void drain(), 0);
}

/** Called once at startup. */
export function startWorker(): void {
	const requeued = requeueInterrupted();
	if (requeued > 0) {
		console.log(`[gallery] Requeued ${requeued} photo(s) interrupted by a restart.`);
	}
	schedule();
}

/** Re-queues a failed photo, for a manual retry from the admin UI. */
export function retryPhoto(photoId: string): void {
	db.update(photos).set({ status: 'pending', error: null }).where(eq(photos.id, photoId)).run();
	schedule();
}
