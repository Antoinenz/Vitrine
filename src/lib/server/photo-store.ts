import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { db } from './db';
import { photos, collections, type Photo } from './db/schema';

/**
 * Reading the `photos` table, with trashed photographs left out.
 *
 * ## Why this is shaped differently from `collections.ts`
 *
 * Collections have one reader, enforced absolutely: ten queries, five shapes,
 * all of them "find me a collection". Photographs are not like that. Thirty
 * queries drive an upload, a processing state machine, reordering, cover
 * selection and retries, and forcing each through a wrapper would produce a
 * module of thin functions with one caller apiece — which hides the state
 * machine without making anything safer.
 *
 * So this module owns the read shapes that are actually shared, and the rule
 * for the rest is the one already used for joins: **any file that queries this
 * table must mention `photoNotTrashed`**. `photos.spec.ts` enforces it. That is
 * weaker than making the mistake impossible, and it is honest about being
 * weaker — but it does mean nobody writes a query here without the question
 * having been put in front of them.
 *
 * ## What a trashed photograph must not do
 *
 * Appear in a collection, be counted in it, be included in its ZIP, be served
 * as a rendition or an original, be offered as a portrait, or be picked up by
 * the processing worker. The last one matters more than it looks: encoding
 * renditions for something on its way to deletion wastes the scarcest resource
 * on a small machine.
 */

/** Not in the trash. Exported for the queries that live outside this module. */
export const photoNotTrashed = isNull(photos.deletedAt);

type Db = typeof db;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Runner = Db | Tx;

// ---------------------------------------------------------------- reads

/** Every live photograph in a collection, in the artist's order. */
export function listForCollection(collectionId: string, runner: Runner = db): Photo[] {
	return runner
		.select()
		.from(photos)
		.where(and(eq(photos.collectionId, collectionId), photoNotTrashed))
		.orderBy(asc(photos.sortKey))
		.all();
}

/** The same across several collections, for the artist page's stacks. */
export function listForCollections(collectionIds: string[], runner: Runner = db): Photo[] {
	if (collectionIds.length === 0) return [];
	return runner
		.select()
		.from(photos)
		.where(and(inArray(photos.collectionId, collectionIds), photoNotTrashed))
		.orderBy(asc(photos.sortKey))
		.all();
}

/** Only what has finished processing — what a ZIP can actually contain. */
export function listReadyForCollection(collectionId: string, runner: Runner = db): Photo[] {
	return runner
		.select()
		.from(photos)
		.where(and(eq(photos.collectionId, collectionId), eq(photos.status, 'ready'), photoNotTrashed))
		.orderBy(asc(photos.sortKey))
		.all();
}

/**
 * One photograph, checked against the collection it is claimed to be in.
 *
 * Every owner action addresses a photograph by id and a collection by id, and
 * this pairing is what stops a crafted request reaching into someone else's
 * collection — so it belongs in one place rather than repeated at each action.
 */
export function findInCollection(
	photoId: string,
	collectionId: string,
	runner: Runner = db
): Photo | undefined {
	return runner
		.select()
		.from(photos)
		.where(and(eq(photos.id, photoId), eq(photos.collectionId, collectionId), photoNotTrashed))
		.get();
}

/** How many live photographs a collection holds. */
export function countForCollection(collectionId: string, runner: Runner = db): number {
	const row = runner
		.select({ count: sql<number>`count(*)` })
		.from(photos)
		.where(and(eq(photos.collectionId, collectionId), photoNotTrashed))
		.get();
	return row?.count ?? 0;
}

/** Counts for several collections at once. */
export function countsForCollections(
	collectionIds: string[],
	runner: Runner = db
): Map<string, number> {
	const counts = new Map<string, number>();
	if (collectionIds.length === 0) return counts;

	const rows = runner
		.select({ collectionId: photos.collectionId, n: sql<number>`count(*)` })
		.from(photos)
		.where(and(inArray(photos.collectionId, collectionIds), photoNotTrashed))
		.groupBy(photos.collectionId)
		.all();

	for (const row of rows) counts.set(row.collectionId, row.n);
	return counts;
}

// ---------------------------------------------------------------- trash

/** A photograph in the trash, with the collection it came from. */
export interface TrashedPhoto {
	photo: Photo;
	collectionTitle: string;
	collectionSlug: string;
	/** True when the collection is in the trash too, so restoring it alone hides it. */
	collectionTrashed: boolean;
}

/**
 * Trashed photographs an owner holds, most recently discarded first.
 *
 * The join to `collections` deliberately does **not** exclude trashed
 * collections: a photograph discarded before its collection was should still be
 * listed and restorable, and hiding it would make it look already gone. The
 * flag says which is which instead. `collections.spec.ts` exempts this file for
 * that reason.
 */
export function listTrashedForOwner(ownerId: string, runner: Runner = db): TrashedPhoto[] {
	return runner
		.select({
			photo: photos,
			collectionTitle: collections.title,
			collectionSlug: collections.slug,
			collectionDeletedAt: collections.deletedAt
		})
		.from(photos)
		.innerJoin(collections, eq(photos.collectionId, collections.id))
		.where(and(eq(collections.ownerId, ownerId), isNotNull(photos.deletedAt)))
		.orderBy(desc(photos.deletedAt))
		.all()
		.map((row) => ({
			photo: row.photo,
			collectionTitle: row.collectionTitle,
			collectionSlug: row.collectionSlug,
			collectionTrashed: row.collectionDeletedAt !== null
		}));
}

/** A trashed photograph the owner holds, for restoring or purging it. */
export function findTrashedForOwner(
	ownerId: string,
	photoId: string,
	runner: Runner = db
): Photo | undefined {
	const row = runner
		.select({ photo: photos })
		.from(photos)
		.innerJoin(collections, eq(photos.collectionId, collections.id))
		.where(
			and(eq(photos.id, photoId), eq(collections.ownerId, ownerId), isNotNull(photos.deletedAt))
		)
		.get();
	return row?.photo;
}

/** Trashed photographs discarded before the given moment, for purging. */
export function listTrashedBefore(cutoff: Date, runner: Runner = db): Photo[] {
	return runner
		.select()
		.from(photos)
		.where(and(isNotNull(photos.deletedAt), lte(photos.deletedAt, cutoff)))
		.all();
}

/**
 * Moves photographs to the trash.
 *
 * Takes a list, because the reason this exists is selecting several at once —
 * and doing it in one statement means a bulk delete cannot half-succeed.
 *
 * A photograph that is a collection's cover is quietly un-set as cover: the
 * collection would otherwise point at something nobody can see, and the stack
 * would fall back to a blank frame with no explanation.
 */
export function moveToTrash(collectionId: string, photoIds: string[], runner: Runner = db): number {
	if (photoIds.length === 0) return 0;

	const affected = runner
		.select({ id: photos.id })
		.from(photos)
		.where(
			and(inArray(photos.id, photoIds), eq(photos.collectionId, collectionId), photoNotTrashed)
		)
		.all();

	if (affected.length === 0) return 0;

	runner
		.update(photos)
		.set({ deletedAt: new Date() })
		.where(
			and(
				inArray(
					photos.id,
					affected.map((p) => p.id)
				),
				eq(photos.collectionId, collectionId)
			)
		)
		.run();

	const collection = runner
		.select({ coverPhotoId: collections.coverPhotoId })
		.from(collections)
		.where(eq(collections.id, collectionId))
		.get();

	if (collection?.coverPhotoId && affected.some((p) => p.id === collection.coverPhotoId)) {
		runner
			.update(collections)
			.set({ coverPhotoId: null, updatedAt: new Date() })
			.where(eq(collections.id, collectionId))
			.run();
	}

	return affected.length;
}

/** Restores a trashed photograph to the collection it came from. */
export function restoreFromTrash(ownerId: string, photoId: string, runner: Runner = db): boolean {
	const photo = findTrashedForOwner(ownerId, photoId, runner);
	if (!photo) return false;

	runner.update(photos).set({ deletedAt: null }).where(eq(photos.id, photoId)).run();
	return true;
}

/** Removes a photograph's row. The caller is responsible for its files. */
export function deletePhotoRow(photoId: string, runner: Runner = db): void {
	runner.delete(photos).where(eq(photos.id, photoId)).run();
}

/**
 * Whether any other row still points at the same stored file.
 *
 * Originals are content-addressed, so the same photograph uploaded twice is
 * stored once and referenced twice. Unlinking it while another row still needs
 * it would blank that other photograph.
 *
 * Trashed rows count as references: their file has to survive until they are
 * purged too, or restoring one would bring back a record with nothing behind it.
 */
export function storageKeyStillUsed(
	storageKey: string,
	exceptPhotoId: string,
	runner: Runner = db
): boolean {
	const row = runner
		.select({ id: photos.id })
		.from(photos)
		.where(and(eq(photos.storageKey, storageKey), sql`${photos.id} <> ${exceptPhotoId}`))
		.get();
	return !!row;
}
