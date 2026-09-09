import { eq } from 'drizzle-orm';
import { db } from '../db';
import { photos } from '../db/schema';
import { deleteDerivatives, deleteOriginal } from '../storage';
import {
	deleteCollectionRow,
	findTrashedById,
	listTrashedBefore,
	moveToTrash,
	restoreFromTrash,
	TRASH_RETENTION_DAYS
} from '../collections';
import type { Collection } from '../db/schema';

/**
 * Discarding collections, and eventually meaning it.
 *
 * ## Why permanent deletion moved behind the trash
 *
 * There was a `delete` action that removed the row, cascaded to every
 * photograph and derivative, and unlinked the originals from disk — with a
 * confirmation dialog as the only thing between an artist and losing work they
 * could not get back. For a gallery whose whole premise is that the originals
 * are yours, that is the wrong shape.
 *
 * So nothing is destroyed directly any more. `trash` marks a collection and
 * releases its slug; the files are untouched and every photograph is still
 * there. `purge` is the only thing that deletes, and it refuses to act on a
 * collection that is not already in the trash — so there is no path from a
 * mis-click to an unrecoverable loss that does not pass through a second,
 * separate decision.
 */

export { TRASH_RETENTION_DAYS };

/** Moves a collection to the trash. Returns undefined if it was not found. */
export function trash(ownerId: string, id: string): Collection | undefined {
	return moveToTrash(ownerId, id);
}

/**
 * Restores a trashed collection.
 *
 * Reports the address it came back at, which may not be the one it left with
 * if something claimed the slug meanwhile.
 */
export function restore(
	ownerId: string,
	id: string
): { collection: Collection; slug: string; renamed: boolean } | undefined {
	return restoreFromTrash(ownerId, id);
}

/**
 * Deletes a trashed collection and its files for good.
 *
 * Refuses anything not already in the trash. That is the safety property worth
 * stating plainly: this function cannot be called on live work, whatever the
 * caller believes it is passing.
 */
export async function purge(ownerId: string, id: string): Promise<boolean> {
	const collection = findTrashedById(ownerId, id);
	if (!collection) return false;

	await purgeRow(collection);
	return true;
}

/**
 * Removes everything belonging to one collection: rows first, then files.
 *
 * Rows first because the cascade is transactional and the filesystem is not.
 * Losing power between the two leaves orphaned files, which cost disk; the
 * other order leaves rows pointing at images that no longer exist, which is a
 * gallery full of broken pictures. Wasted bytes are the better failure.
 */
async function purgeRow(collection: Collection): Promise<void> {
	const owned = db
		.select({ id: photos.id, storageKey: photos.storageKey })
		.from(photos)
		.where(eq(photos.collectionId, collection.id))
		.all();

	// Cascades to photos and derivatives through the schema's foreign keys.
	deleteCollectionRow(collection.id);

	for (const photo of owned) {
		await deleteDerivatives(photo.id);

		/**
		 * Originals are content-addressed, so the same file uploaded to two
		 * collections is stored once and referenced twice. Removing it while
		 * another row still points at it would blank that other photograph.
		 */
		const stillReferenced = db
			.select({ id: photos.id })
			.from(photos)
			.where(eq(photos.storageKey, photo.storageKey))
			.get();

		if (!stillReferenced) await deleteOriginal(photo.storageKey);
	}
}

/**
 * Purges everything discarded longer ago than the retention period.
 *
 * Runs at startup rather than on a timer. A gallery that is never visited never
 * needs to reclaim the space, and a process that is restarted for an upgrade
 * gets the sweep for free — which is the same reasoning that has interrupted
 * image processing resume at boot rather than through a scheduler.
 *
 * Returns how many were removed, so the caller can say so in a log rather than
 * deleting an artist's work in silence.
 */
export async function purgeExpired(now: Date = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
	const expired = listTrashedBefore(cutoff);

	for (const collection of expired) await purgeRow(collection);
	return expired.length;
}
