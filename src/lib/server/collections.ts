import { and, asc, desc, eq, isNotNull, isNull, lte, ne, type SQL } from 'drizzle-orm';
import { db } from './db';
import { collections, type Collection } from './db/schema';

/**
 * The only module allowed to read the `collections` table.
 *
 * ## Why the restriction
 *
 * A trashed collection must vanish from every public surface: the artist page,
 * the collection page, individual photo pages, the unlock form, the ZIP
 * endpoint, the sitemap, link previews, and the slug-uniqueness checks. That is
 * nine places, written at nine different times, and the cost of missing one is
 * not a stale listing — it is a collection the artist believes they deleted,
 * still served at a URL they may already have given to a client.
 *
 * "Remember to add `is null` everywhere" is not a guarantee; it is a hope with
 * a good track record until the day someone adds a tenth query. So every read
 * lives here and carries the check by construction, and `collections.spec.ts`
 * fails the build if `from(collections)` appears anywhere else.
 *
 * The corollary is that this module has to cover the shapes routes actually
 * need. Where a caller wants something not here, add it here rather than
 * reaching past it — that is the whole mechanism.
 *
 * ## Trashed rows are reachable, but only deliberately
 *
 * The functions that see trashed collections say so in their names. There is no
 * `includeTrashed` flag, because a boolean argument at a call site is exactly
 * the kind of thing that gets passed the wrong way round and never noticed.
 */

/** Not in the trash. Every read below is scoped by this except where named otherwise. */
const live = isNull(collections.deletedAt);

/**
 * The same predicate, for queries that reach the table through a join.
 *
 * Those cannot live in this module — they select derivatives or photographs and
 * bring the collection along to check access — but they still have to exclude
 * trashed rows, and three of them did not. Trashing a collection removed its
 * page while `/i/<photoId>/<size>` went on serving every rendition in it, and
 * `/api/photos/<photoId>/download` went on serving the originals, to anyone
 * holding a photograph id. The page publishes those ids in `data-photo`.
 *
 * `collections.spec.ts` requires any file that joins this table to mention this
 * export, which is what stops the next such query being written without it.
 */
export const notTrashed = live;

/**
 * Accepts a transaction as well as the database.
 *
 * `createCollection` checks slug uniqueness inside the transaction that
 * inserts, so that two simultaneous creates cannot settle on the same slug.
 * That check has to run on the transaction or it is not doing its job.
 */
type Db = typeof db;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Runner = Db | Tx;

// ---------------------------------------------------------------- reads

/** A live collection by owner and slug. Slugs are unique per owner. */
export function findBySlug(
	ownerId: string,
	slug: string,
	runner: Runner = db
): Collection | undefined {
	return runner
		.select()
		.from(collections)
		.where(and(eq(collections.ownerId, ownerId), eq(collections.slug, slug), live))
		.get();
}

/** A live collection the given owner holds, by id. */
export function findOwnedById(
	ownerId: string,
	id: string,
	runner: Runner = db
): Collection | undefined {
	return runner
		.select()
		.from(collections)
		.where(and(eq(collections.id, id), eq(collections.ownerId, ownerId), live))
		.get();
}

/** Every live collection an owner has, in the given order. */
export function listForOwner(ownerId: string, order: SQL, runner: Runner = db): Collection[] {
	return runner
		.select()
		.from(collections)
		.where(and(eq(collections.ownerId, ownerId), live))
		.orderBy(order)
		.all();
}

/** Public collections only, for the sitemap. Unlisted work must never appear. */
export function listPublicForSitemap(
	ownerId: string,
	runner: Runner = db
): { slug: string; updatedAt: Date }[] {
	return runner
		.select({ slug: collections.slug, updatedAt: collections.updatedAt })
		.from(collections)
		.where(and(eq(collections.ownerId, ownerId), eq(collections.visibility, 'public'), live))
		.orderBy(asc(collections.sortKey))
		.all();
}

/**
 * Whether a slug is already in use by a live collection.
 *
 * Trashed collections do not hold their slug, which is what lets an artist
 * delete "Auckland" and immediately make a new one — the same thing File
 * Explorer allows with a folder name. `moveToTrash` renames the trashed row to
 * make that true rather than relying on this check alone, so a restore cannot
 * later collide.
 */
export function slugTaken(
	ownerId: string,
	slug: string,
	options: { exceptId?: string; runner?: Runner } = {}
): boolean {
	const runner = options.runner ?? db;
	const clauses = [eq(collections.ownerId, ownerId), eq(collections.slug, slug), live];
	if (options.exceptId) clauses.push(ne(collections.id, options.exceptId));

	return !!runner
		.select({ id: collections.id })
		.from(collections)
		.where(and(...clauses))
		.get();
}

/** The lowest sort key an owner has, so a new collection can be placed above it. */
export function firstSortKey(ownerId: string, runner: Runner = db): string | null {
	const first = runner
		.select({ sortKey: collections.sortKey })
		.from(collections)
		.where(and(eq(collections.ownerId, ownerId), live))
		.orderBy(asc(collections.sortKey))
		.limit(1)
		.get();

	return first?.sortKey ?? null;
}

// ---------------------------------------------------------------- trash

/** Trashed collections, most recently discarded first. */
export function listTrashed(ownerId: string, runner: Runner = db): Collection[] {
	return runner
		.select()
		.from(collections)
		.where(and(eq(collections.ownerId, ownerId), isNotNull(collections.deletedAt)))
		.orderBy(desc(collections.deletedAt))
		.all();
}

/** A trashed collection by id, for restoring or purging it. */
export function findTrashedById(
	ownerId: string,
	id: string,
	runner: Runner = db
): Collection | undefined {
	return runner
		.select()
		.from(collections)
		.where(
			and(
				eq(collections.id, id),
				eq(collections.ownerId, ownerId),
				isNotNull(collections.deletedAt)
			)
		)
		.get();
}

/** Trashed collections discarded before the given moment, for purging. */
export function listTrashedBefore(cutoff: Date, runner: Runner = db): Collection[] {
	return runner
		.select()
		.from(collections)
		.where(and(isNotNull(collections.deletedAt), lte(collections.deletedAt, cutoff)))
		.all();
}

// ---------------------------------------------------------------- writes

/** Inserts a collection. Kept here so the table has exactly one writer too. */
export function insertCollection(
	values: typeof collections.$inferInsert,
	runner: Runner = db
): void {
	runner.insert(collections).values(values).run();
}

/** Applies a partial update to a live collection. */
export function updateCollection(
	id: string,
	values: Partial<typeof collections.$inferInsert>,
	runner: Runner = db
): void {
	runner
		.update(collections)
		.set({ ...values, updatedAt: new Date() })
		.where(and(eq(collections.id, id), live))
		.run();
}

/** Removes a collection permanently. Callers are responsible for its files. */
export function deleteCollectionRow(id: string, runner: Runner = db): void {
	runner.delete(collections).where(eq(collections.id, id)).run();
}

// ---------------------------------------------------------------- trash ops

/**
 * How long a trashed collection is kept before it can be purged.
 *
 * Long enough that "I deleted the wrong one" is recoverable after a weekend and
 * a night's sleep, short enough that the originals of discarded work are not
 * kept for ever on a machine chosen for being small.
 */
export const TRASH_RETENTION_DAYS = 30;

/**
 * The suffix that parks a trashed collection's slug out of the way.
 *
 * Long and specific rather than a bare `-trashed`, because a real collection
 * could plausibly be called that, and the restore path has to be able to tell
 * a parked slug from one an artist chose.
 */
const PARKED = '__trashed__';

/** Strips the parking suffix, if present. */
function unpark(slug: string): string {
	const at = slug.indexOf(PARKED);
	return at === -1 ? slug : slug.slice(0, at);
}

/**
 * Moves a collection to the trash and releases its slug.
 *
 * Releasing the slug is what lets an artist discard "Auckland" and immediately
 * make a new one, exactly as a file manager allows with a folder name. The
 * trashed row keeps the original in a parked form so that restoring can offer
 * it back.
 *
 * Photographs and files are untouched. Nothing is unrecoverable until a purge.
 */
export function moveToTrash(
	ownerId: string,
	id: string,
	runner: Runner = db
): Collection | undefined {
	const collection = findOwnedById(ownerId, id, runner);
	if (!collection) return undefined;

	runner
		.update(collections)
		.set({
			deletedAt: new Date(),
			// Suffixed with the id, so two collections that shared a title before
			// one was renamed cannot collide in the trash either.
			slug: `${collection.slug}${PARKED}${collection.id.slice(0, 8)}`,
			updatedAt: new Date()
		})
		.where(and(eq(collections.id, id), eq(collections.ownerId, ownerId)))
		.run();

	return collection;
}

/**
 * Restores a trashed collection, taking its old slug back where it can.
 *
 * If something else has claimed the name in the meantime the restored
 * collection gets a numbered variant rather than failing — the artist asked for
 * their work back, and refusing over an address they may not even remember
 * would be answering a different question. The new address is returned so the
 * interface can say what happened.
 */
export function restoreFromTrash(
	ownerId: string,
	id: string,
	runner: Runner = db
): { collection: Collection; slug: string; renamed: boolean } | undefined {
	const collection = findTrashedById(ownerId, id, runner);
	if (!collection) return undefined;

	const wanted = unpark(collection.slug);

	let slug = wanted;
	let n = 2;
	while (slugTaken(ownerId, slug, { runner })) slug = `${wanted}-${n++}`;

	runner
		.update(collections)
		.set({ deletedAt: null, slug, updatedAt: new Date() })
		.where(and(eq(collections.id, id), eq(collections.ownerId, ownerId)))
		.run();

	return { collection, slug, renamed: slug !== wanted };
}
