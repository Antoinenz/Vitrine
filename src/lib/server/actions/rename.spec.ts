import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../db/index';
import { users, collections, photos, type User } from '../db/schema';
import { renameCollection } from './collection';
import { findOwnedById } from '../collections';

/**
 * The rule that decides whether a rename moves the address with it.
 *
 * Worth testing against a real database rather than reasoning about, because
 * getting it wrong in the permissive direction turns a link an artist has
 * already sent a client into a 404 — and that is discovered by the client, not
 * by the artist.
 */
let dir: string;
let db: ReturnType<typeof createDb>['db'];

const user = { id: 'u1' } as User;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'vitrine-rename-'));
	db = createDb(join(dir, 'test.db')).db;
	db.insert(users).values({ id: 'u1', email: 'a@b.c', passwordHash: 'x' }).run();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function add(id: string, title: string, slug: string) {
	db.insert(collections)
		.values({ id, ownerId: 'u1', slug, title, sortKey: id, visibility: 'private' })
		.run();
}

function addPhoto(collectionId: string) {
	db.insert(photos)
		.values({
			id: `p-${collectionId}`,
			collectionId,
			storageKey: 'k',
			originalName: 'a.jpg',
			contentType: 'image/jpeg',
			bytes: 1,
			sortKey: 'a0'
		})
		.run();
}

describe('renaming a collection', () => {
	it('moves the address while the collection is empty and unaddressed', () => {
		// The case this exists for: create, then type over the default name.
		add('c1', 'New collection', 'new-collection');

		const result = renameCollection(user, 'c1', 'Auckland', db);

		expect(result.slug).toBe('auckland');
		expect(result.renamed).toBe(true);
		expect(findOwnedById('u1', 'c1', db)?.title).toBe('Auckland');
	});

	it('leaves the address alone once there are photographs in it', () => {
		add('c1', 'Auckland', 'auckland');
		addPhoto('c1');

		const result = renameCollection(user, 'c1', 'Auckland 2019', db);

		// The title changes; the link someone may already hold does not.
		expect(result.slug).toBe('auckland');
		expect(result.renamed).toBe(false);
		expect(findOwnedById('u1', 'c1', db)?.title).toBe('Auckland 2019');
	});

	it('still moves the address when the default one had been disambiguated', () => {
		// Two collections made without naming the first: the second is at
		// `new-collection-2`, which is automatic, not chosen.
		add('c1', 'New collection', 'new-collection');
		add('c2', 'New collection', 'new-collection-2');

		const result = renameCollection(user, 'c2', 'Katsu', db);

		expect(result.slug).toBe('katsu');
		expect(result.renamed).toBe(true);
	});

	it('leaves a hand-set address alone even when empty', () => {
		// Slug and title disagree, so the artist chose the address deliberately.
		add('c1', 'Auckland', 'nz-2019');

		const result = renameCollection(user, 'c1', 'Wellington', db);

		expect(result.slug).toBe('nz-2019');
		expect(result.renamed).toBe(false);
	});

	it('falls back to the default name rather than accepting nothing', () => {
		add('c1', 'New collection', 'new-collection');

		// Enter on an emptied field. A file manager keeps "New folder" here; it
		// does not create a folder with no name.
		renameCollection(user, 'c1', '   ', db);

		expect(findOwnedById('u1', 'c1', db)?.title).toBe('New collection');
	});

	it('does not collide with an address already in use', () => {
		add('c1', 'New collection', 'new-collection');
		add('c2', 'Auckland', 'auckland');

		const result = renameCollection(user, 'c1', 'Auckland', db);

		expect(result.slug).not.toBe('auckland');
		expect(result.slug).toMatch(/^auckland-/);
		expect(findOwnedById('u1', 'c2', db)?.slug).toBe('auckland');
	});

	it('keeps the old address when the new name has no usable slug', () => {
		add('c1', 'New collection', 'new-collection');

		// Punctuation alone slugifies to nothing; inventing an address from it
		// would be worse than leaving the one that works.
		const result = renameCollection(user, 'c1', '???', db);

		expect(result.slug).toBe('new-collection');
		expect(findOwnedById('u1', 'c1', db)?.title).toBe('???');
	});

	it('refuses a collection belonging to someone else', () => {
		db.insert(users).values({ id: 'u2', email: 'x@y.z', passwordHash: 'x' }).run();
		add('c1', 'Auckland', 'auckland');

		expect(() => renameCollection({ id: 'u2' } as User, 'c1', 'Mine now', db)).toThrow();
	});
});
