import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from './db/index';
import { users, collections, photos } from './db/schema';
import {
	listForCollection,
	listReadyForCollection,
	countForCollection,
	findInCollection,
	listTrashedForOwner,
	listTrashedBefore,
	moveToTrash,
	restoreFromTrash,
	storageKeyStillUsed
} from './photo-store';

/**
 * Against a real database, like the collection trash.
 *
 * The question in almost every case is what a query returns once a row carries
 * `deleted_at`, which is a question about SQLite rather than about this code.
 */
let dir: string;
let db: ReturnType<typeof createDb>['db'];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'vitrine-photo-trash-'));
	db = createDb(join(dir, 'test.db')).db;
	db.insert(users).values({ id: 'u1', email: 'a@b.c', passwordHash: 'x' }).run();
	db.insert(collections)
		.values({ id: 'c1', ownerId: 'u1', slug: 'c1', title: 'C1', sortKey: 'a0' })
		.run();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function add(id: string, extra: Partial<typeof photos.$inferInsert> = {}) {
	db.insert(photos)
		.values({
			id,
			collectionId: 'c1',
			storageKey: `key-${id}`,
			originalName: `${id}.jpg`,
			contentType: 'image/jpeg',
			bytes: 1,
			sortKey: id,
			status: 'ready',
			...extra
		})
		.run();
}

describe('the photograph trash', () => {
	it('hides a trashed photograph from every read of its collection', () => {
		add('p1');
		add('p2');

		expect(moveToTrash('c1', ['p1'], db)).toBe(1);

		expect(listForCollection('c1', db).map((p) => p.id)).toEqual(['p2']);
		expect(listReadyForCollection('c1', db).map((p) => p.id)).toEqual(['p2']);
		expect(countForCollection('c1', db)).toBe(1);
		expect(findInCollection('p1', 'c1', db)).toBeUndefined();
	});

	it('discards several at once, or none', () => {
		add('p1');
		add('p2');
		add('p3');

		// The reason this takes a list: a bulk delete that half-succeeds leaves
		// the artist guessing which half.
		expect(moveToTrash('c1', ['p1', 'p3'], db)).toBe(2);
		expect(listForCollection('c1', db).map((p) => p.id)).toEqual(['p2']);
	});

	it('refuses photographs from another collection', () => {
		db.insert(collections)
			.values({ id: 'c2', ownerId: 'u1', slug: 'c2', title: 'C2', sortKey: 'a1' })
			.run();
		add('p1');
		db.insert(photos)
			.values({
				id: 'other',
				collectionId: 'c2',
				storageKey: 'k',
				originalName: 'o.jpg',
				contentType: 'image/jpeg',
				bytes: 1,
				sortKey: 'a0'
			})
			.run();

		// Ids come from a form, so the pairing is what stops a crafted request
		// reaching into a collection it was not sent from.
		expect(moveToTrash('c1', ['other'], db)).toBe(0);
		expect(listForCollection('c2', db)).toHaveLength(1);
	});

	it('gives up the cover when the cover is discarded', () => {
		add('p1');
		add('p2');
		db.update(collections).set({ coverPhotoId: 'p1' }).run();

		moveToTrash('c1', ['p1'], db);

		// Otherwise the collection points at something nobody can see, and the
		// stack falls back to a blank frame with no explanation.
		expect(db.select().from(collections).get()?.coverPhotoId).toBeNull();
	});

	it('leaves the cover alone when something else is discarded', () => {
		add('p1');
		add('p2');
		db.update(collections).set({ coverPhotoId: 'p1' }).run();

		moveToTrash('c1', ['p2'], db);

		expect(db.select().from(collections).get()?.coverPhotoId).toBe('p1');
	});

	it('lists what is in the trash, and puts it back', () => {
		add('p1');
		moveToTrash('c1', ['p1'], db);

		const trashed = listTrashedForOwner('u1', db);
		expect(trashed).toHaveLength(1);
		expect(trashed[0].collectionTitle).toBe('C1');
		expect(trashed[0].collectionTrashed).toBe(false);

		expect(restoreFromTrash('u1', 'p1', db)).toBe(true);
		expect(listForCollection('c1', db).map((p) => p.id)).toEqual(['p1']);
	});

	it('says when the collection is in the trash as well', () => {
		add('p1');
		moveToTrash('c1', ['p1'], db);
		db.update(collections).set({ deletedAt: new Date() }).run();

		// Restoring the photograph alone would put it somewhere nobody can see,
		// which looks like the restore having failed.
		expect(listTrashedForOwner('u1', db)[0].collectionTrashed).toBe(true);
	});

	it('will not restore a photograph belonging to someone else', () => {
		db.insert(users).values({ id: 'u2', email: 'x@y.z', passwordHash: 'x' }).run();
		add('p1');
		moveToTrash('c1', ['p1'], db);

		expect(restoreFromTrash('u2', 'p1', db)).toBe(false);
	});

	it('lists only what was discarded before the cutoff', () => {
		add('p1', { deletedAt: new Date('2026-01-01') });
		add('p2', { deletedAt: new Date('2026-09-01') });
		add('p3');

		expect(listTrashedBefore(new Date('2026-06-01'), db).map((p) => p.id)).toEqual(['p1']);
	});

	it('counts a trashed row as still needing its file', () => {
		// Content-addressed originals are shared. Unlinking one while a trashed row
		// still refers to it would leave nothing to restore.
		add('p1', { storageKey: 'shared' });
		add('p2', { storageKey: 'shared' });
		moveToTrash('c1', ['p2'], db);

		expect(storageKeyStillUsed('shared', 'p1', db)).toBe(true);
	});
});
