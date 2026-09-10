import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { photos, profiles, type User, type Visibility } from '../db/schema';
import { VISIBILITIES } from '$lib/visibility';
import { slugify, uniqueSlug, isReservedSlug } from '../slug';
import { keyBetween, keysAfter } from '../sort-key';
import { collectionOrder } from '../collection-order';
import {
	slugTaken,
	firstSortKey,
	findOwnedById,
	listForOwner,
	updateCollection,
	type Runner
} from '../collections';
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

/** What a collection is called before the artist has called it anything. */
export const DEFAULT_TITLE = 'New collection';

/**
 * Creates an empty collection.
 *
 * Returns the id as well as the slug, because the artist page now names the
 * collection in place rather than navigating to it: the id is what identifies
 * the tile whose title should open for editing.
 *
 * An empty title is no longer an error. Creating is a single click that puts a
 * tile on the page with its name selected, exactly as a file manager makes a
 * folder called "New folder" — so there is a default to fall back to, and
 * pressing Enter immediately is a choice rather than a mistake.
 */
export function createCollection(
	user: User,
	title: string
): { id: string; slug: string; title: string } {
	const trimmed = title.trim() || DEFAULT_TITLE;
	if (trimmed.length > 200) throw new CollectionInputError('That title is too long.');

	let slug = '';
	const id = crypto.randomUUID();

	db.transaction((tx) => {
		// Uniqueness is checked inside the transaction that inserts, so two
		// simultaneous creates can't settle on the same slug.
		slug = uniqueSlug(trimmed, (candidate) => slugTaken(user.id, candidate, { runner: tx }));

		// New collections go to the top: it's the one you just made and want to
		// start filling.
		const first = { sortKey: firstSortKey(user.id, tx) };

		insertCollection(
			{
				id,
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

	return { id, slug, title: trimmed };
}

/**
 * Renames a collection in place, and moves its address with it only while that
 * is safe.
 *
 * ## When the address follows the name
 *
 * A file manager renames the folder and its path together. A gallery cannot
 * always do that: the address is what an artist sends a client, and silently
 * changing it turns a shared link into a 404 — the kind of breakage nobody
 * discovers until someone else does.
 *
 * So the slug moves only when both are true:
 *
 * - **The collection has no photographs.** There is nothing at that address
 *   worth linking to; the page reads "still being prepared".
 * - **The slug still matches the old title.** If they differ, the artist set
 *   the address by hand on the collection's own page, and that is a decision to
 *   respect rather than overwrite.
 *
 * Which covers the case this exists for — create, name it, then upload — and
 * leaves every established collection's address exactly where it was.
 * Deliberate address changes stay on the collection's settings page, where the
 * field is visible and the consequence can be spelled out.
 */
export function renameCollection(
	user: User,
	id: string,
	title: string,
	runner: Runner = db
): { slug: string; renamed: boolean } {
	const trimmed = title.trim() || DEFAULT_TITLE;
	if (trimmed.length > 200) throw new CollectionInputError('That title is too long.');

	const collection = findOwnedById(user.id, id, runner);
	if (!collection) throw new CollectionInputError('That collection no longer exists.');

	const { count } = runner
		.select({ count: sql<number>`count(*)` })
		.from(photos)
		.where(eq(photos.collectionId, id))
		.get() ?? { count: 0 };

	/**
	 * Whether the address was chosen by the artist or generated from the title.
	 *
	 * Not simply `slug === slugify(title)`, because `uniqueSlug` appends `-2`,
	 * `-3` when the obvious address is already taken. Making two collections
	 * without naming the first leaves the second at `new-collection-2`, which is
	 * every bit as automatic as `new-collection` — and treating it as
	 * hand-chosen would strand it there, titled one thing and addressed another.
	 */
	const base = slugify(collection.title);
	const suffixed = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`);
	const untouchedAddress =
		base !== '' && (collection.slug === base || suffixed.test(collection.slug));
	let slug = collection.slug;

	if (count === 0 && untouchedAddress) {
		const wanted = slugify(trimmed);
		// A title that slugifies to nothing at all, or to a reserved word, leaves
		// the address alone rather than inventing one.
		if (wanted && !isReservedSlug(wanted)) {
			slug = uniqueSlug(trimmed, (candidate) =>
				slugTaken(user.id, candidate, { exceptId: id, runner })
			);
		}
	}

	updateCollection(id, { title: trimmed, slug }, runner);
	return { slug, renamed: slug !== collection.slug };
}

/**
 * Changes a collection's visibility, keeping `publishedAt` honest.
 *
 * The stamp records when the work was first shared, so it is set on the way out
 * of private and left alone afterwards — going public, then unlisted, then
 * public again should not rewrite the date the work was published. Returning to
 * private clears it, because at that point nothing has been published.
 */
export function setVisibility(user: User, id: string, visibility: Visibility, runner: Runner = db) {
	if (!VISIBILITIES.has(visibility)) throw new CollectionInputError('Unknown visibility.');

	const collection = findOwnedById(user.id, id, runner);
	if (!collection) throw new CollectionInputError('That collection no longer exists.');

	updateCollection(
		id,
		{
			visibility,
			publishedAt: visibility === 'private' ? null : (collection.publishedAt ?? new Date())
		},
		runner
	);

	return { visibility };
}

/**
 * Moves a collection between two others.
 *
 * `before` and `after` are the neighbours it should end up between, either of
 * which may be null at the ends of the list. A fractional key means one row is
 * rewritten rather than the whole gallery renumbered.
 *
 * ## Why this also changes a setting
 *
 * The gallery sorts by capture date unless the artist has chosen custom order,
 * and `sortKey` was written once at creation and never read. So dragging while
 * in date order would rewrite a key nothing consults: the tile would snap back
 * and the page would look broken, with nothing to see in any log.
 *
 * Rather than refuse the drag, or leave it silently ineffective, the first one
 * switches the gallery to custom order and says so. Dragging should do what it
 * appears to do; being told why the whole gallery just changed is the price,
 * and it is a fair one.
 */
export function reorderCollection(
	user: User,
	id: string,
	beforeId: string | null,
	afterId: string | null,
	runner: Runner = db
): { switchedToCustom: boolean } {
	if (!findOwnedById(user.id, id, runner)) {
		throw new CollectionInputError('That collection no longer exists.');
	}

	const profile = runner
		.select({ order: profiles.collectionOrder })
		.from(profiles)
		.where(eq(profiles.userId, user.id))
		.get();

	const switchedToCustom = profile?.order !== 'custom';

	if (switchedToCustom) {
		/**
		 * Freeze the order that is on screen before honouring `sortKey`.
		 *
		 * `sortKey` was written once at creation and never read, because the
		 * gallery sorted by date — so the keys describe the order the collections
		 * were *made* in, which is usually nothing like the order being looked at.
		 * Switching to custom order without this makes the first drag reshuffle
		 * the whole gallery into an arrangement the artist never chose, with one
		 * tile moved somewhere inside it.
		 *
		 * It was visible immediately when tried: dragging one collection sent an
		 * unrelated one from fifth place to first.
		 *
		 * So the keys are seeded from what is currently displayed. The switch then
		 * changes nothing except the tile that was actually dragged.
		 */
		// `collectionOrder('date')` rather than a copy of it: one definition of
		// what the default order is.
		const displayed = listForOwner(user.id, collectionOrder('date'), runner);
		const seeded = keysAfter(null, displayed.length);
		displayed.forEach((c, i) => updateCollection(c.id, { sortKey: seeded[i] }, runner));

		runner
			.update(profiles)
			.set({ collectionOrder: 'custom' })
			.where(eq(profiles.userId, user.id))
			.run();
	}

	// Read after any seeding, since that rewrote every key.
	const before = beforeId ? findOwnedById(user.id, beforeId, runner) : null;
	const after = afterId ? findOwnedById(user.id, afterId, runner) : null;

	updateCollection(
		id,
		{ sortKey: keyBetween(before?.sortKey ?? null, after?.sortKey ?? null) },
		runner
	);

	return { switchedToCustom };
}
