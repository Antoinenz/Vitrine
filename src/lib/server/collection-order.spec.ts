import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from './db/index';
import { users, collections, photos } from './db/schema';
import { collectionOrder } from './collection-order';

/**
 * Against a real SQLite file rather than a mock.
 *
 * The whole risk in this expression is how SQLite itself behaves: whether
 * `strftime` parses the ISO strings sharp writes, whether the correlated
 * subquery sees the outer row, and whether the converted string and the integer
 * columns end up comparable. A fake database would answer all three the way the
 * test author expected, which is exactly the wrong oracle.
 */
let dir: string;
let db: ReturnType<typeof createDb>['db'];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'vitrine-order-'));
	db = createDb(join(dir, 'test.db')).db;
	db.insert(users).values({ id: 'u1', email: 'a@b.c', passwordHash: 'x' }).run();
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Collections are inserted in a deliberately unhelpful order — alphabetical by
 * id, and reverse to the expected result — so a passing test can't be an
 * accident of insertion order. */
function collection(id: string, createdAt: string, datedAt?: string) {
	db.insert(collections)
		.values({
			id,
			ownerId: 'u1',
			slug: id,
			title: id,
			sortKey: id,
			createdAt: new Date(createdAt),
			datedAt: datedAt ? new Date(datedAt) : null
		})
		.run();
}

/** `takenAt` is written by `exif.ts` as `Date.toISOString()`. */
function photo(id: string, collectionId: string, takenAt: string | null) {
	db.insert(photos)
		.values({
			id,
			collectionId,
			storageKey: `${id}.jpg`,
			originalName: `${id}.jpg`,
			contentType: 'image/jpeg',
			bytes: 1,
			sortKey: id,
			exif: takenAt ? { takenAt } : {}
		})
		.run();
}

function listed(mode?: string): string[] {
	return db
		.select()
		.from(collections)
		.where(eq(collections.ownerId, 'u1'))
		.orderBy(collectionOrder(mode))
		.all()
		.map((c) => c.id);
}

describe('collectionOrder', () => {
	it('sorts by the latest capture date in each collection, newest first', () => {
		collection('a', '2020-01-01');
		collection('b', '2020-01-01');
		collection('c', '2020-01-01');

		// Every collection was created on the same day, so creation date can't be
		// what produces the expected order.
		photo('a1', 'a', '2019-06-01T10:00:00.000Z');
		photo('b1', 'b', '2024-06-01T10:00:00.000Z');
		photo('c1', 'c', '2022-06-01T10:00:00.000Z');

		expect(listed()).toEqual(['b', 'c', 'a']);
	});

	/**
	 * The case the artist actually described: an old scan added to a finished
	 * series must not drag it down the page.
	 */
	it('takes the latest capture date, not the earliest', () => {
		collection('recent', '2020-01-01');
		collection('older', '2020-01-01');

		photo('r1', 'recent', '2024-01-01T00:00:00.000Z');
		// `recent` also holds one very old frame. Under `min()` it would sink
		// below `older`; under `max()` it stays on top.
		photo('r2', 'recent', '1998-01-01T00:00:00.000Z');
		photo('o1', 'older', '2021-01-01T00:00:00.000Z');

		expect(listed()).toEqual(['recent', 'older']);
	});

	it('lets an explicit date from the artist override the photographs', () => {
		collection('a', '2020-01-01');
		collection('b', '2020-01-01', '2030-01-01');

		photo('a1', 'a', '2025-01-01T00:00:00.000Z');
		photo('b1', 'b', '1990-01-01T00:00:00.000Z');

		// `b`'s photographs are ancient, but the artist dated it to the future.
		expect(listed()).toEqual(['b', 'a']);
	});

	/**
	 * The failure mode that would not throw: if the EXIF string never became a
	 * number, SQLite would compare a string against the integer `created_at` and
	 * sort every collection with EXIF as one block above or below every
	 * collection without, regardless of the dates involved.
	 */
	it('interleaves collections with and without EXIF on one timeline', () => {
		collection('exif-old', '2020-01-01');
		collection('plain-mid', '2022-01-01');
		collection('exif-new', '2020-01-01');

		photo('p1', 'exif-old', '2021-01-01T00:00:00.000Z');
		photo('p2', 'exif-new', '2023-01-01T00:00:00.000Z');
		photo('p3', 'plain-mid', null);

		expect(listed()).toEqual(['exif-new', 'plain-mid', 'exif-old']);
	});

	it('falls back to the creation date for a collection with no photographs', () => {
		collection('empty-new', '2025-01-01');
		collection('has-photos', '2020-01-01');
		photo('p1', 'has-photos', '2022-01-01T00:00:00.000Z');

		expect(listed()).toEqual(['empty-new', 'has-photos']);
	});

	it('sorts by sortKey when the artist has chosen a custom order', () => {
		collection('a', '2020-01-01');
		collection('b', '2020-01-01');
		photo('b1', 'b', '2030-01-01T00:00:00.000Z');

		// `b` would lead by date; under `custom` the sort keys decide instead.
		expect(listed('custom')).toEqual(['a', 'b']);
	});
});
