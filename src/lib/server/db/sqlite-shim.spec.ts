import { describe, it, expect } from 'vitest';
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import { createDrizzle } from './driver';
import { SqliteShim } from './sqlite-shim';

/**
 * These tests pin down the contract the shim has to honour for
 * `drizzle-orm/better-sqlite3` to work against Node's built-in `node:sqlite`.
 * If Drizzle changes which driver methods it calls, these fail loudly here
 * rather than at runtime in a route handler.
 */

const authors = sqliteTable('authors', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull()
});

const books = sqliteTable('books', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	authorId: integer('author_id')
		.notNull()
		.references(() => authors.id),
	title: text('title').notNull()
});

function makeDb() {
	const client = new SqliteShim(':memory:');
	client.exec('PRAGMA foreign_keys = ON');
	client.exec('CREATE TABLE authors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
	client.exec(
		`CREATE TABLE books (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
			title TEXT NOT NULL
		)`
	);
	return { client, db: createDrizzle(client, { authors, books }) };
}

describe('SqliteShim + drizzle', () => {
	it('inserts and selects through the query builder', () => {
		const { db } = makeDb();
		db.insert(authors).values({ name: 'Sally Mann' }).run();

		const rows = db.select().from(authors).all();
		expect(rows).toEqual([{ id: 1, name: 'Sally Mann' }]);
	});

	it('returns a single row via .get()', () => {
		const { db } = makeDb();
		db.insert(authors).values({ name: 'Fan Ho' }).run();

		const row = db.select().from(authors).where(eq(authors.name, 'Fan Ho')).get();
		expect(row).toEqual({ id: 1, name: 'Fan Ho' });
	});

	it('returns typed values from .returning() (exercises raw/array mode)', () => {
		const { db } = makeDb();
		const returned = db.insert(authors).values({ name: 'Saul Leiter' }).returning().all();
		expect(returned).toEqual([{ id: 1, name: 'Saul Leiter' }]);
	});

	/**
	 * The mode-flipping path is the subtlest part of the shim: Drizzle calls
	 * `.raw().all()` for some queries and plain `.all()` for others. Interleaving
	 * them on one connection is what would break a naive implementation.
	 */
	it('keeps object-mode and array-mode queries correct when interleaved', () => {
		const { db } = makeDb();
		db.insert(authors).values({ name: 'Vivian Maier' }).run();

		expect(db.insert(authors).values({ name: 'Robert Frank' }).returning().all()).toEqual([
			{ id: 2, name: 'Robert Frank' }
		]);
		// A plain object-mode select immediately after an array-mode one.
		expect(db.select().from(authors).all()).toEqual([
			{ id: 1, name: 'Vivian Maier' },
			{ id: 2, name: 'Robert Frank' }
		]);
		expect(db.insert(authors).values({ name: 'Daido Moriyama' }).returning().all()).toEqual([
			{ id: 3, name: 'Daido Moriyama' }
		]);
	});

	it('joins across tables', () => {
		const { db } = makeDb();
		db.insert(authors).values({ name: 'Alec Soth' }).run();
		db.insert(books).values({ authorId: 1, title: 'Sleeping by the Mississippi' }).run();

		const rows = db
			.select({ title: books.title, author: authors.name })
			.from(books)
			.innerJoin(authors, eq(books.authorId, authors.id))
			.all();

		expect(rows).toEqual([{ title: 'Sleeping by the Mississippi', author: 'Alec Soth' }]);
	});

	it('commits a transaction', () => {
		const { db } = makeDb();
		db.transaction((tx) => {
			tx.insert(authors).values({ name: 'Nan Goldin' }).run();
			tx.insert(books).values({ authorId: 1, title: 'The Ballad' }).run();
		});

		expect(db.select().from(authors).all()).toHaveLength(1);
		expect(db.select().from(books).all()).toHaveLength(1);
	});

	it('rolls back a failed transaction, leaving no partial writes', () => {
		const { db } = makeDb();
		db.insert(authors).values({ name: 'Stephen Shore' }).run();

		expect(() =>
			db.transaction((tx) => {
				tx.insert(books).values({ authorId: 1, title: 'Uncommon Places' }).run();
				throw new Error('boom');
			})
		).toThrow('boom');

		// The book insert must not have survived the rollback.
		expect(db.select().from(books).all()).toHaveLength(0);
		expect(db.select().from(authors).all()).toHaveLength(1);
	});

	it('recovers and can transact again after a rollback', () => {
		const { db } = makeDb();
		expect(() =>
			db.transaction(() => {
				throw new Error('first');
			})
		).toThrow('first');

		db.transaction((tx) => {
			tx.insert(authors).values({ name: 'Rinko Kawauchi' }).run();
		});
		expect(db.select().from(authors).all()).toHaveLength(1);
	});

	it('enforces foreign keys (pragma actually applied)', () => {
		const { db } = makeDb();
		expect(() => db.insert(books).values({ authorId: 999, title: 'Orphan' }).run()).toThrow(
			/FOREIGN KEY/i
		);
	});
});
