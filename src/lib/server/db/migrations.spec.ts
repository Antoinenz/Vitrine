import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb, runMigrations, MIGRATIONS_DIR } from './index';
import { openDatabase } from './sqlite-shim';
import { users, profiles, collections, photos, derivatives } from './schema';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'vitrine-test-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
	it('applies the generated schema and round-trips the full object graph', () => {
		const { db } = createDb(join(dir, 'test.db'));

		db.insert(users).values({ id: 'u1', email: 'a@example.com', passwordHash: 'x' }).run();
		db.insert(profiles)
			.values({
				userId: 'u1',
				displayName: 'Antoine',
				bio: 'Photographs of quiet places.',
				socialLinks: [{ label: 'Instagram', url: 'https://instagram.com/x' }]
			})
			.run();
		db.insert(collections)
			.values({
				id: 'c1',
				ownerId: 'u1',
				slug: 'sierra',
				title: 'Sierra',
				sortKey: 'a0',
				visibility: 'public',
				metadataFields: ['camera', 'aperture']
			})
			.run();
		db.insert(photos)
			.values({
				id: 'p1',
				collectionId: 'c1',
				storageKey: 'ab/cd/original.jpg',
				originalName: 'DSCF1234.jpg',
				contentType: 'image/jpeg',
				bytes: 4_200_000,
				width: 6000,
				height: 4000,
				sortKey: 'a0',
				exif: { camera: 'Fujifilm X-T5', aperture: 'f/2.8', iso: 160 }
			})
			.run();
		db.insert(derivatives)
			.values({
				id: 'd1',
				photoId: 'p1',
				width: 1280,
				height: 853,
				format: 'webp',
				storageKey: 'ab/cd/1280.webp',
				bytes: 180_000
			})
			.run();

		// JSON columns must survive the round trip as structured values.
		const profile = db.select().from(profiles).where(eq(profiles.userId, 'u1')).get();
		expect(profile?.socialLinks).toEqual([{ label: 'Instagram', url: 'https://instagram.com/x' }]);

		const collection = db.select().from(collections).where(eq(collections.id, 'c1')).get();
		expect(collection?.metadataFields).toEqual(['camera', 'aperture']);
		// Booleans round-trip as real booleans, not 0/1.
		expect(collection?.downloadsEnabled).toBe(false);
		expect(collection?.createdAt).toBeInstanceOf(Date);

		const photo = db.select().from(photos).where(eq(photos.id, 'p1')).get();
		expect(photo?.exif).toEqual({ camera: 'Fujifilm X-T5', aperture: 'f/2.8', iso: 160 });
		expect(photo?.status).toBe('pending');
	});

	/**
	 * `dated_at` drives the default order of the artist page. Adding it without a
	 * backfill would leave every existing collection null, and since the ordering
	 * falls back to `created_at` only through `coalesce`, an install that had been
	 * running for a year would have had its gallery silently rearranged by an
	 * upgrade. So the migration carries a hand-written `UPDATE`, and this asserts
	 * it against a database that genuinely predates the column.
	 */
	it('backfills dated_at from created_at for collections that predate the column', () => {
		// Only the migrations that existed before 0003, so the row is inserted
		// into the old shape rather than the current one.
		const older = join(dir, 'older');
		mkdirSync(older);
		const before = readdirSync(MIGRATIONS_DIR)
			.filter((f) => f.endsWith('.sql') && f < '0003')
			.sort();
		for (const file of before) {
			copyFileSync(join(MIGRATIONS_DIR, file), join(older, file));
		}

		const path = join(dir, 'test.db');
		const client = openDatabase(path);
		runMigrations(client, older);

		client
			.prepare(
				`INSERT INTO users (id, email, password_hash, created_at)
				 VALUES ('u1', 'a@b.c', 'x', 1000)`
			)
			.run();
		client
			.prepare(
				`INSERT INTO collections (id, owner_id, slug, title, sort_key, created_at)
				 VALUES ('c1', 'u1', 's', 'T', 'a0', 1700000000000)`
			)
			.run();

		// Now the real thing, 0003 included.
		expect(runMigrations(client)).toContain('0003_collection_date_and_order.sql');

		const row = client.prepare('SELECT dated_at FROM collections WHERE id = ?').get('c1') as {
			dated_at: number | null;
		};
		expect(row.dated_at).toBe(1700000000000);
		client.close();
	});

	it('is idempotent — a second run applies nothing', () => {
		const path = join(dir, 'test.db');
		const first = createDb(path);
		first.client.close();

		const client = openDatabase(path);
		expect(runMigrations(client)).toEqual([]);
		client.close();
	});

	it('cascades deletes from collection to photos and derivatives', () => {
		const { db } = createDb(join(dir, 'test.db'));
		db.insert(users).values({ id: 'u1', email: 'a@b.c', passwordHash: 'x' }).run();
		db.insert(collections)
			.values({ id: 'c1', ownerId: 'u1', slug: 's', title: 'T', sortKey: 'a0' })
			.run();
		db.insert(photos)
			.values({
				id: 'p1',
				collectionId: 'c1',
				storageKey: 'k',
				originalName: 'n.jpg',
				contentType: 'image/jpeg',
				bytes: 1,
				sortKey: 'a0'
			})
			.run();
		db.insert(derivatives)
			.values({
				id: 'd1',
				photoId: 'p1',
				width: 320,
				height: 200,
				format: 'webp',
				storageKey: 'k2',
				bytes: 1
			})
			.run();

		db.delete(collections).where(eq(collections.id, 'c1')).run();

		// Without `PRAGMA foreign_keys = ON` these would be orphaned rather than removed.
		expect(db.select().from(photos).all()).toHaveLength(0);
		expect(db.select().from(derivatives).all()).toHaveLength(0);
	});

	it('rolls back and reports the file when a migration fails', () => {
		const badDir = join(dir, 'migrations');
		mkdirSync(badDir);
		writeFileSync(join(badDir, '0000_ok.sql'), 'CREATE TABLE good (id TEXT);');
		writeFileSync(join(badDir, '0001_bad.sql'), 'CREATE TABLE bad ();');

		const client = openDatabase(join(dir, 'test.db'));
		expect(() => runMigrations(client, badDir)).toThrow(/0001_bad\.sql/);

		// The good migration stays applied; the bad one is not recorded.
		const applied = client.prepare('SELECT name FROM _migrations').all() as { name: string }[];
		expect(applied.map((r) => r.name)).toEqual(['0000_ok.sql']);
		client.close();
	});

	it('enforces per-owner slug uniqueness but allows the same slug for another owner', () => {
		const { db } = createDb(join(dir, 'test.db'));
		db.insert(users).values({ id: 'u1', email: 'a@b.c', passwordHash: 'x' }).run();
		db.insert(users).values({ id: 'u2', email: 'd@e.f', passwordHash: 'x' }).run();

		db.insert(collections)
			.values({ id: 'c1', ownerId: 'u1', slug: 'sierra', title: 'A', sortKey: 'a0' })
			.run();

		expect(() =>
			db
				.insert(collections)
				.values({ id: 'c2', ownerId: 'u1', slug: 'sierra', title: 'B', sortKey: 'a1' })
				.run()
		).toThrow(/UNIQUE/i);

		// The multi-artist-ready part: a different owner may reuse the slug.
		expect(() =>
			db
				.insert(collections)
				.values({ id: 'c3', ownerId: 'u2', slug: 'sierra', title: 'C', sortKey: 'a0' })
				.run()
		).not.toThrow();
	});
});
