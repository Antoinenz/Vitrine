import { db } from '../db';
import type { User } from '../db/schema';
import { uniqueSlug } from '../slug';
import { keyBetween } from '../sort-key';
import { slugTaken, firstSortKey } from '../collections';
import { insertCollection } from '../collections';

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
		slug = uniqueSlug(trimmed, (candidate) => slugTaken(user.id, candidate, { runner: tx }));

		// New collections go to the top: it's the one you just made and want to
		// start filling.
		const first = { sortKey: firstSortKey(user.id, tx) };

		insertCollection(
			{
				id: crypto.randomUUID(),
				ownerId: user.id,
				slug,
				title: trimmed,
				sortKey: keyBetween(null, first.sortKey),
				/**
				 * `datedAt` is deliberately left null.
				 *
				 * It is an override, not a stamp. Ordering falls back to the capture
				 * dates of the photographs, and a date written here at creation would
				 * outrank those forever — every collection would sort by the day it
				 * happened to be made rather than by when the work was shot.
				 */
				// Private until the artist decides otherwise — publishing should be a
				// deliberate act, not the default for an empty collection.
				visibility: 'private'
			},
			tx
		);
	});

	return slug;
}
