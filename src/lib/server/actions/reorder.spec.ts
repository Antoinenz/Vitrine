import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { createDb } from '../db/index';
import { users, profiles, collections, type User } from '../db/schema';
import { reorderCollection, setVisibility } from './collection';
import { listForOwner, findOwnedById } from '../collections';

/**
 * Ordering and visibility, against a real database.
 *
 * The interesting behaviour is not the key arithmetic — that has its own tests
 * — but the two side effects: that a drag switches the gallery to custom order,
 * and that changing visibility keeps `publishedAt` telling the truth.
 */
let dir: string;
let db: ReturnType<typeof createDb>['db'];
const user = { id: 'u1' } as User;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'vitrine-reorder-'));
	db = createDb(join(dir, 'test.db')).db;
	db.insert(users).values({ id: 'u1', email: 'a@b.c', passwordHash: 'x' }).run();
	db.insert(profiles).values({ userId: 'u1' }).run();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function add(id: string, sortKey: string) {
	db.insert(collections)
		.values({ id, ownerId: 'u1', slug: id, title: id, sortKey, visibility: 'private' })
		.run();
}

const order = () => listForOwner('u1', asc(collections.sortKey), db).map((c) => c.id);

describe('reordering collections', () => {
	beforeEach(() => {
		add('a', 'a0');
		add('b', 'a1');
		add('c', 'a2');
	});

	it('moves a collection between two others', () => {
		reorderCollection(user, 'c', 'a', 'b', db);
		expect(order()).toEqual(['a', 'c', 'b']);
	});

	it('moves a collection to the very top', () => {
		reorderCollection(user, 'c', null, 'a', db);
		expect(order()).toEqual(['c', 'a', 'b']);
	});

	it('moves a collection to the very bottom', () => {
		reorderCollection(user, 'a', 'c', null, db);
		expect(order()).toEqual(['b', 'c', 'a']);
	});

	it('switches the gallery to custom order, and says it did', () => {
		// Without this the key is rewritten and nothing reads it: the tile snaps
		// back and the page looks broken with nothing to see in any log.
		const result = reorderCollection(user, 'c', null, 'a', db);

		expect(result.switchedToCustom).toBe(true);
		expect(db.select().from(profiles).get()?.collectionOrder).toBe('custom');
	});

	it('does not claim to have switched a second time', () => {
		reorderCollection(user, 'c', null, 'a', db);
		const second = reorderCollection(user, 'b', null, 'c', db);

		// The notice is worth showing once. Repeating it on every drag would train
		// the artist to dismiss it without reading.
		expect(second.switchedToCustom).toBe(false);
	});

	it('does not disturb anything else when it switches to custom order', () => {
		/**
		 * The failure this pins was visible on the first real drag: one collection
		 * was moved and an unrelated one jumped from fifth place to first.
		 *
		 * `sortKey` is written at creation and, while the gallery sorts by date, is
		 * never read — so the keys describe the order things were made in, which is
		 * usually nothing like what is on screen. Honouring them without seeding
		 * them first reshuffles the whole gallery.
		 */
		const byDate = ['c', 'a', 'b'];
		byDate.forEach((id, i) => {
			db.update(collections)
				.set({ datedAt: new Date(2026, 0, 10 - i) })
				.where(eq(collections.id, id))
				.run();
		});

		// Nothing moves: the same collection is asked to stay between the same two.
		reorderCollection(user, 'a', 'c', 'b', db);

		expect(order()).toEqual(byDate);
	});

	it('rewrites one row, not the whole gallery', () => {
		const keysBefore = listForOwner('u1', asc(collections.sortKey), db).map((c) => [
			c.id,
			c.sortKey
		]);
		reorderCollection(user, 'c', 'a', 'b', db);
		const keysAfter = new Map(
			listForOwner('u1', asc(collections.sortKey), db).map((c) => [c.id, c.sortKey])
		);

		const changed = keysBefore.filter(([id, key]) => keysAfter.get(id as string) !== key);
		expect(changed.map(([id]) => id)).toEqual(['c']);
	});

	it('refuses a collection belonging to someone else', () => {
		db.insert(users).values({ id: 'u2', email: 'x@y.z', passwordHash: 'x' }).run();
		expect(() => reorderCollection({ id: 'u2' } as User, 'a', null, 'b', db)).toThrow();
	});
});

describe('changing visibility', () => {
	beforeEach(() => add('a', 'a0'));

	it('stamps publishedAt on the way out of private', () => {
		setVisibility(user, 'a', 'public', db);
		expect(findOwnedById('u1', 'a', db)?.publishedAt).toBeInstanceOf(Date);
	});

	it('keeps the original date when the state changes again', () => {
		setVisibility(user, 'a', 'public', db);
		const first = findOwnedById('u1', 'a', db)?.publishedAt;

		setVisibility(user, 'a', 'unlisted', db);

		// Published once means published once. Rewriting the date each time would
		// make it a record of the last fiddle rather than of when the work went out.
		expect(findOwnedById('u1', 'a', db)?.publishedAt).toEqual(first);
	});

	it('clears publishedAt when the collection goes private again', () => {
		setVisibility(user, 'a', 'public', db);
		setVisibility(user, 'a', 'private', db);
		expect(findOwnedById('u1', 'a', db)?.publishedAt).toBeNull();
	});

	it('refuses a value that is not one of the three', () => {
		expect(() => setVisibility(user, 'a', 'secret' as never, db)).toThrow();
	});
});
