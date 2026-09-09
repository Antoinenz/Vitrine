import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from './db/index';
import { users, collections } from './db/schema';
import {
	findBySlug,
	findOwnedById,
	listForOwner,
	listPublicForSitemap,
	listTrashed,
	listTrashedBefore,
	moveToTrash,
	restoreFromTrash,
	slugTaken,
	firstSortKey
} from './collections';
import { asc } from 'drizzle-orm';

/**
 * Against a real SQLite file, like the ordering suite.
 *
 * What is being checked here is mostly about what the database returns for
 * queries carrying an `is null` — whether a trashed row is genuinely invisible
 * to each read path — and a fake would answer that the way the author expected.
 */
let dir: string;
let db: ReturnType<typeof createDb>['db'];

const OWNER = 'u1';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'vitrine-trash-'));
	db = createDb(join(dir, 'test.db')).db;
	db.insert(users).values({ id: OWNER, email: 'a@b.c', passwordHash: 'x' }).run();
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function add(id: string, slug: string, extra: Partial<typeof collections.$inferInsert> = {}) {
	db.insert(collections)
		.values({
			id,
			ownerId: OWNER,
			slug,
			title: slug,
			sortKey: id,
			visibility: 'public',
			...extra
		})
		.run();
}

describe('the trash', () => {
	it('hides a trashed collection from every read path', () => {
		add('c1', 'auckland');
		add('c2', 'katsu');

		moveToTrash(OWNER, 'c1', db);

		expect(findBySlug(OWNER, 'auckland', db)).toBeUndefined();
		expect(listForOwner(OWNER, asc(collections.sortKey), db).map((c) => c.id)).toEqual(['c2']);
		expect(listPublicForSitemap(OWNER, db).map((c) => c.slug)).toEqual(['katsu']);
	});

	it('is unreachable even at the address it was parked under', () => {
		/**
		 * The previous test passes on its own without the `is null` filter,
		 * because trashing renames the row and nothing answers to `auckland` any
		 * more. That makes it a weak guard against the failure that matters, so
		 * this one asks for the collection by the address it actually has.
		 *
		 * Not a theoretical address, either: it is the original slug plus the
		 * first eight characters of the collection id, and collection ids reach
		 * the browser. Someone who wanted to find discarded work could construct
		 * it. The filter is what makes that fail.
		 */
		add('c1', 'auckland');
		moveToTrash(OWNER, 'c1', db);

		const parked = listTrashed(OWNER, db)[0].slug;
		expect(parked).not.toBe('auckland');

		expect(findBySlug(OWNER, parked, db)).toBeUndefined();
		expect(findOwnedById(OWNER, 'c1', db)).toBeUndefined();
	});

	it('releases the slug, so the name can be used again straight away', () => {
		add('c1', 'auckland');
		moveToTrash(OWNER, 'c1', db);

		// The exact thing a file manager allows: delete a folder, immediately make
		// another with the same name.
		expect(slugTaken(OWNER, 'auckland', { runner: db })).toBe(false);
	});

	it('keeps the trashed collection findable in the trash', () => {
		add('c1', 'auckland');
		moveToTrash(OWNER, 'c1', db);

		const trashed = listTrashed(OWNER, db);
		expect(trashed).toHaveLength(1);
		expect(trashed[0].id).toBe('c1');
		expect(trashed[0].deletedAt).toBeInstanceOf(Date);
	});

	it('gives a restored collection its old address back', () => {
		add('c1', 'auckland');
		moveToTrash(OWNER, 'c1', db);

		const restored = restoreFromTrash(OWNER, 'c1', db);

		expect(restored?.slug).toBe('auckland');
		expect(restored?.renamed).toBe(false);
		expect(findBySlug(OWNER, 'auckland', db)?.id).toBe('c1');
		expect(listTrashed(OWNER, db)).toEqual([]);
	});

	it('restores under a new address when the old one was taken meanwhile', () => {
		add('c1', 'auckland');
		moveToTrash(OWNER, 'c1', db);
		// The artist made a new collection with the freed name.
		add('c2', 'auckland');

		const restored = restoreFromTrash(OWNER, 'c1', db);

		// Restoring must not fail over an address the artist may not even
		// remember, and must not steal it from the collection now using it.
		expect(restored?.renamed).toBe(true);
		expect(restored?.slug).toBe('auckland-2');
		expect(findBySlug(OWNER, 'auckland', db)?.id).toBe('c2');
		expect(findBySlug(OWNER, 'auckland-2', db)?.id).toBe('c1');
	});

	it('will not trash a collection belonging to someone else', () => {
		db.insert(users).values({ id: 'u2', email: 'x@y.z', passwordHash: 'x' }).run();
		add('c1', 'auckland');

		expect(moveToTrash('u2', 'c1', db)).toBeUndefined();
		expect(findBySlug(OWNER, 'auckland', db)?.id).toBe('c1');
	});

	it('will not restore a collection that is not in the trash', () => {
		add('c1', 'auckland');
		expect(restoreFromTrash(OWNER, 'c1', db)).toBeUndefined();
	});

	it('lists only what was discarded before the cutoff', () => {
		const old = new Date('2026-01-01T00:00:00Z');
		const recent = new Date('2026-09-01T00:00:00Z');
		add('c1', 'old', { deletedAt: old });
		add('c2', 'recent', { deletedAt: recent });
		add('c3', 'live');

		const expired = listTrashedBefore(new Date('2026-06-01T00:00:00Z'), db);

		expect(expired.map((c) => c.id)).toEqual(['c1']);
	});

	it('does not let a trashed collection hold the top sort position', () => {
		// A new collection is placed above the first live one. If the trash still
		// counted, a discarded collection would keep pushing new ones below it.
		add('c1', 'discarded', { sortKey: 'a0' });
		add('c2', 'kept', { sortKey: 'a5' });

		moveToTrash(OWNER, 'c1', db);

		expect(firstSortKey(OWNER, db)).toBe('a5');
	});
});
