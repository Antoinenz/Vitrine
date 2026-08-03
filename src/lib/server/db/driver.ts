import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core/db';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core/dialect';
import { createTableRelationsHelpers, extractTablesRelationalConfig } from 'drizzle-orm/relations';
import type { SqliteShim } from './sqlite-shim';

/**
 * Builds a Drizzle database over our `node:sqlite` client.
 *
 * This mirrors what `drizzle-orm/better-sqlite3`'s own `construct()` does, and
 * exists to avoid one line in that module: `import Client from 'better-sqlite3'`.
 * That import is used *only* by the `drizzle('path/to.db')` convenience
 * overload, which we never call — we always pass an already-open client. But a
 * static import still has to resolve, which would force the native package into
 * the dependency tree purely as a phantom.
 *
 * Aliasing it away was the other option, but a bundler alias only applies where
 * the bundler is in charge; Vite externalises `drizzle-orm` for SSR and Node
 * then resolves the import itself, so the alias silently doesn't apply. Building
 * the session directly works identically under Vite, Vitest and plain Node.
 *
 * The pieces below are all public subpath exports of `drizzle-orm`, and
 * `session.js` itself has no reference to `better-sqlite3`.
 */
export function createDrizzle<TSchema extends Record<string, unknown>>(
	client: SqliteShim,
	schema: TSchema
) {
	const dialect = new SQLiteSyncDialect();

	const tablesConfig = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
	const relationalSchema = {
		fullSchema: schema,
		schema: tablesConfig.tables,
		tableNamesMap: tablesConfig.tableNamesMap
	};

	const session = new BetterSQLiteSession(client as never, dialect, relationalSchema as never, {});

	return new BaseSQLiteDatabase(
		'sync',
		dialect,
		session as never,
		relationalSchema as never
	) as BaseSQLiteDatabase<'sync', unknown, TSchema>;
}
