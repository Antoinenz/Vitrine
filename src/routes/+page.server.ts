import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { collections, photos, profiles, users } from '$lib/server/db/schema';
import { toPhotoViews } from '$lib/server/photos';
import { isListed } from '$lib/server/access';

/** How many photos make up the visual stack for each collection. */
const STACK_DEPTH = 4;

export const load: PageServerLoad = async ({ locals }) => {
	// Single-artist install: the first account is the owner whose page this is.
	// `owner_id` already exists throughout, so serving several artists later is a
	// routing change rather than a migration.
	const owner = db.select().from(users).orderBy(asc(users.createdAt)).limit(1).get();
	if (!owner) return { profile: null, collections: [] };

	const profile = db.select().from(profiles).where(eq(profiles.userId, owner.id)).get();

	/**
	 * Newest work first by default.
	 *
	 * `datedAt` is the date the artist ascribes to the collection, which is not
	 * the date they got round to uploading it — ordering by `createdAt` would put
	 * an old series scanned last week above this year's. `coalesce` covers rows
	 * from before the column existed, and matches the index on
	 * `(owner_id, dated_at)`.
	 */
	const dated = sql`coalesce(${collections.datedAt}, ${collections.createdAt})`;

	const all = db
		.select()
		.from(collections)
		.where(eq(collections.ownerId, owner.id))
		.orderBy(
			(profile?.collectionOrder ?? 'date') === 'date' ? desc(dated) : asc(collections.sortKey)
		)
		.all();

	/**
	 * Only public collections are listed. Unlisted ones stay reachable by URL but
	 * must never appear here — that distinction is the whole point of the state.
	 * The owner sees their private and unlisted work too, so the page doubles as
	 * a preview of their own site.
	 */
	const isOwner = locals.user?.id === owner.id;
	const visible = all.filter((c) => isListed(c) || isOwner);
	if (visible.length === 0) {
		return { profile: profile ?? null, collections: [], isOwner };
	}

	// One query for every stack, rather than one per collection.
	const rows = db
		.select()
		.from(photos)
		.where(
			inArray(
				photos.collectionId,
				visible.map((c) => c.id)
			)
		)
		.orderBy(asc(photos.sortKey))
		.all();

	const byCollection = new Map<string, typeof rows>();
	for (const row of rows) {
		const list = byCollection.get(row.collectionId) ?? [];
		list.push(row);
		byCollection.set(row.collectionId, list);
	}

	const stacks = visible
		.map((collection) => {
			const owned = byCollection.get(collection.id) ?? [];

			/**
			 * The stack shows the grid's opening photographs, in the grid's own
			 * order — no cover-first reshuffle.
			 *
			 * Leading with the cover meant the stack and the grid disagreed about
			 * order whenever the cover wasn't already first, so opening a collection
			 * visibly rearranged the photographs even though each one flew to the
			 * right place. Artists control the face of a collection by ordering it;
			 * `coverPhotoId` remains for social preview images.
			 */
			const ordered = owned;

			return {
				id: collection.id,
				slug: collection.slug,
				title: collection.title,
				description: collection.description,
				visibility: collection.visibility,
				hasPassword: !!collection.passwordHash,
				photoCount: owned.filter((p) => p.status === 'ready').length,
				/**
				 * Owner-only progress. Counted from rows already in memory, so this
				 * costs nothing, and without it a collection whose photographs are
				 * still being processed looks simply broken to the person who just
				 * uploaded them.
				 */
				pendingCount: isOwner
					? owned.filter((p) => p.status === 'pending' || p.status === 'processing').length
					: 0,
				failedCount: isOwner ? owned.filter((p) => p.status === 'failed').length : 0,
				stack: toPhotoViews(ordered.slice(0, STACK_DEPTH), collection)
			};
		})
		/**
		 * A collection with nothing processed yet has no stack to show a visitor.
		 * The owner still sees it, otherwise a collection they just created would
		 * vanish the moment it was made and there would be no way back to it.
		 */
		.filter((c) => isOwner || c.stack.length > 0);

	return {
		profile: profile ?? null,
		collections: stacks,
		isOwner
	};
};
