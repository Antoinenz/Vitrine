import { asc, eq, inArray } from 'drizzle-orm';
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

	const all = db
		.select()
		.from(collections)
		.where(eq(collections.ownerId, owner.id))
		.orderBy(asc(collections.sortKey))
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

			// The cover leads the stack; the rest follow in display order. These are
			// the same photos, in the same order, that begin the collection grid —
			// which is what lets the transition match them up later.
			const ordered = collection.coverPhotoId
				? [
						...owned.filter((p) => p.id === collection.coverPhotoId),
						...owned.filter((p) => p.id !== collection.coverPhotoId)
					]
				: owned;

			return {
				id: collection.id,
				slug: collection.slug,
				title: collection.title,
				description: collection.description,
				visibility: collection.visibility,
				hasPassword: !!collection.passwordHash,
				photoCount: owned.filter((p) => p.status === 'ready').length,
				stack: toPhotoViews(ordered.slice(0, STACK_DEPTH), collection)
			};
		})
		// A collection with nothing processed yet has no stack to show.
		.filter((c) => c.stack.length > 0);

	return {
		profile: profile ?? null,
		collections: stacks,
		isOwner
	};
};
