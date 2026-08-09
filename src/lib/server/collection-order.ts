import { asc, desc, sql, type SQL } from 'drizzle-orm';
import { collections, photos } from './db/schema';

/**
 * When a collection was *photographed*, as far as the database can tell.
 *
 * Ordering by `createdAt` puts an old series scanned last week above this
 * year's, because that records when the artist got round to uploading it. The
 * photographs themselves know better: their EXIF carries the moment the shutter
 * opened.
 *
 * Three levels, in order of how much they can be trusted:
 *
 * 1. `datedAt` — the artist said so explicitly, which beats anything derived.
 *    Null unless they have actually set one; see `0004_dated_at_is_an_override`.
 * 2. The latest capture date among the collection's photographs. The *latest*
 *    rather than the earliest or the most recently uploaded, so adding an old
 *    scan to a finished series doesn't drag the whole collection backwards.
 * 3. `createdAt`, for a collection whose photographs carry no EXIF at all —
 *    scans and exports often don't.
 *
 * The capture date is stored as an ISO string inside the `exif` JSON, so it has
 * to be converted to epoch milliseconds to sit alongside the other two in one
 * `coalesce`. Comparing a string against an integer would not error: SQLite
 * sorts every integer below every string, so the whole gallery would quietly
 * split into two blocks. That conversion is the reason this lives in its own
 * module with a test against a real database rather than inline in the load.
 */
export function collectionDate(): SQL {
	/**
	 * `max()` over an empty set is null, not an error, so a collection with no
	 * photographs — or none carrying EXIF — falls through to `createdAt` on its
	 * own without a special case here.
	 */
	const captured = sql`(
		select max(cast(strftime('%s', json_extract(${photos.exif}, '$.takenAt')) as integer) * 1000)
		from ${photos}
		where ${photos.collectionId} = ${collections.id}
	)`;

	return sql`coalesce(${collections.datedAt}, ${captured}, ${collections.createdAt})`;
}

/**
 * How the artist page lists collections, per the site setting.
 *
 * `custom` means `sortKey`, which today is only ever written at creation — so
 * it currently reads as "newest created first" until the drag-to-arrange editor
 * lands.
 */
export function collectionOrder(mode: string | undefined): SQL {
	return mode === 'custom' ? asc(collections.sortKey) : desc(collectionDate());
}
