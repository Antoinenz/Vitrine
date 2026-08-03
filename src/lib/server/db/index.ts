import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createDrizzle } from './driver';
import { openDatabase, type SqliteShim } from './sqlite-shim';
import { DATABASE_PATH } from '../config';
import * as schema from './schema';

export { schema };

export const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

/**
 * Applies any migration SQL not yet recorded in `_migrations`.
 *
 * Migrations run at startup rather than via a separate `drizzle-kit migrate`
 * step: for a self-hosted app, upgrading should be "pull the new version and
 * restart". drizzle-kit is still used to *generate* the SQL (`npm run
 * db:generate`); it needs no database connection to do that.
 *
 * Each file applies inside a transaction and is recorded in the same
 * transaction, so a failure leaves the database on the previous version rather
 * than half-migrated.
 */
export function runMigrations(client: SqliteShim, migrationsDir = MIGRATIONS_DIR): string[] {
	client.exec(
		`CREATE TABLE IF NOT EXISTS _migrations (
			name TEXT PRIMARY KEY,
			applied_at INTEGER NOT NULL
		)`
	);

	if (!existsSync(migrationsDir)) return [];

	const applied = new Set(
		(client.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name)
	);

	const pending = readdirSync(migrationsDir)
		.filter((f) => f.endsWith('.sql'))
		.sort() // drizzle-kit zero-pads a sequence prefix, so lexical order is correct
		.filter((f) => !applied.has(f));

	for (const file of pending) {
		const sql = readFileSync(join(migrationsDir, file), 'utf8');

		client.exec('BEGIN');
		try {
			// drizzle-kit separates statements with this marker. Splitting on it
			// rather than on ";" keeps semicolons inside triggers and string
			// literals intact.
			for (const stmt of sql.split('--> statement-breakpoint')) {
				const trimmed = stmt.trim();
				if (trimmed) client.exec(trimmed);
			}
			client
				.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
				.run(file, Date.now());
			client.exec('COMMIT');
		} catch (err) {
			try {
				client.exec('ROLLBACK');
			} catch {
				/* already unwound */
			}
			throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
		}
	}

	return pending;
}

/**
 * Opens a database, applies migrations, and returns the Drizzle instance.
 * Exported as a factory so tests can run against a throwaway path.
 */
export function createDb(path: string, migrationsDir = MIGRATIONS_DIR) {
	mkdirSync(dirname(path), { recursive: true });
	const client = openDatabase(path);
	runMigrations(client, migrationsDir);
	return { client, db: createDrizzle(client, schema) };
}

/**
 * The application-wide instance. `createDb` runs migrations on open, so any
 * process that imports this — the server, the worker, the seed script — brings
 * the schema up to date automatically.
 */
const instance = createDb(DATABASE_PATH);
export const client = instance.client;
export const db = instance.db;
export type Database = typeof db;
