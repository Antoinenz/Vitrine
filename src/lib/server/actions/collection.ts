import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { collections } from '../db/schema';
import type { User } from '../db/schema';
import { uniqueSlug } from '../slug';
import { keyBetween } from '../sort-key';

/**
 * Collection operations, independent of any route.
 *
 * Creating one now happens from the artist page rather than a separate list
 * screen, and the same logic will be wanted elsewhere; keeping it here means
 * the route action is a thin wrapper that only decides what to do with the
 * result.
 */

/** Thrown for anything the artist can fix by editing the form. */
export class CollectionInputError extends Error {}

/**
 * Creates an empty collection and returns its slug.
 *
 * The slug is what the caller wants: every inline surface is addressed by slug,
 * and the redirect after creating goes to `/c/<slug>`.
 */
export function createCollection(user: User, title: string): string {
	const trimmed = title.trim();
	if (!trimmed) throw new CollectionInputError('Give the collection a title.');
	if (trimmed.length > 200) throw new CollectionInputError('That title is too long.');

	let slug = '';

	db.transaction((tx) => {
		// Uniqueness is checked inside the transaction that inserts, so two
		// simultaneous creates can't settle on the same slug.
		slug = uniqueSlug(trimmed, (candidate) => {
			return !!tx
				.select({ id: collections.id })
				.from(collections)
				.where(and(eq(collections.ownerId, user.id), eq(collections.slug, candidate)))
				.get();
		});

		// New collections go to the top: it's the one you just made and want to
		// start filling.
		const first = tx
			.select({ sortKey: collections.sortKey })
			.from(collections)
			.where(eq(collections.ownerId, user.id))
			.orderBy(asc(collections.sortKey))
			.limit(1)
			.get();

		tx.insert(collections)
			.values({
				id: crypto.randomUUID(),
				ownerId: user.id,
				slug,
				title: trimmed,
				sortKey: keyBetween(null, first?.sortKey ?? null),
				// Today, until the artist dates it themselves. Under the default
				// ordering that also puts it at the top, agreeing with `sortKey`.
				datedAt: new Date(),
				// Private until the artist decides otherwise — publishing should be a
				// deliberate act, not the default for an empty collection.
				visibility: 'private'
			})
			.run();
	});

	return slug;
}
