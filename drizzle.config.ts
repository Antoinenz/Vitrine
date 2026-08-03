import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is used only to *generate* migration SQL (`npm run db:generate`).
 * Applying migrations is done by the app itself at startup — see
 * `runMigrations()` in `src/lib/server/db/index.ts` — so that upgrading a
 * self-hosted install is just "restart with the new version", and so we don't
 * need a native SQLite driver in the toolchain.
 */
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: { url: process.env.DATABASE_URL ?? './data/vitrine.db' },
	verbose: true,
	strict: true
});
