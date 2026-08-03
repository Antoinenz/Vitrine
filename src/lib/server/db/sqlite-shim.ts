/**
 * A `better-sqlite3`-compatible facade over Node's built-in `node:sqlite`.
 *
 * Why this exists
 * ---------------
 * Drizzle's synchronous SQLite driver (`drizzle-orm/better-sqlite3`) is the
 * best-supported SQLite path: it gives us `db.transaction()`, savepoints and
 * fully synchronous queries. But `better-sqlite3` is a native module, and its
 * prebuilt binaries are linked against a newer glibc than many hosts ship
 * (Debian 12 / `node:24-bookworm` are on glibc 2.36; the prebuilds want 2.38).
 * When no prebuild matches, installing needs a full C++ toolchain.
 *
 * For a self-hosted app that is unacceptable friction: `npm install` should
 * just work on any machine a self-hoster happens to own, and the Docker image
 * shouldn't need build tools.
 *
 * Node 22.5+ ships SQLite in core as `node:sqlite`, and as of Node 24 it is
 * stable and exposes exactly the primitives Drizzle's driver needs — including
 * `setReturnArrays()`, the equivalent of better-sqlite3's `.raw()` mode. So we
 * adapt the built-in module to the interface Drizzle expects and drop the
 * native dependency entirely.
 *
 * The surface below is deliberately minimal: it implements precisely what
 * `drizzle-orm/better-sqlite3` calls (prepare/run/all/get/raw/transaction/exec)
 * and nothing more.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';

/** The subset of `better-sqlite3`'s Statement that Drizzle actually calls. */
export interface ShimStatement {
	run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
	all(...params: unknown[]): unknown[];
	get(...params: unknown[]): unknown;
	/** Switches this statement into array-row mode, mirroring better-sqlite3's `.raw()`. */
	raw(toggle?: boolean): ShimStatement;
}

/**
 * A better-sqlite3 transaction callable: invocable directly, and carrying the
 * BEGIN-behavior variants Drizzle selects between.
 */
export type TransactionFn<T extends (...args: never[]) => unknown> = ((
	...args: Parameters<T>
) => ReturnType<T>) & {
	default: (...args: Parameters<T>) => ReturnType<T>;
	deferred: (...args: Parameters<T>) => ReturnType<T>;
	immediate: (...args: Parameters<T>) => ReturnType<T>;
	exclusive: (...args: Parameters<T>) => ReturnType<T>;
};

class Statement implements ShimStatement {
	#stmt: StatementSync;
	#returnArrays = false;

	constructor(stmt: StatementSync) {
		this.#stmt = stmt;
	}

	/**
	 * better-sqlite3's `.raw()` is *sticky* — it mutates the statement. Drizzle
	 * relies on that (`stmt.raw().all(...)`) but also calls `stmt.all(...)` on
	 * statements that may have been flipped earlier. So rather than trusting the
	 * call order, every execution asserts the mode it wants first. This makes the
	 * shim correct regardless of how the statement is reused.
	 */
	#apply(returnArrays: boolean) {
		if (this.#returnArrays !== returnArrays) {
			this.#stmt.setReturnArrays(returnArrays);
			this.#returnArrays = returnArrays;
		}
		return this.#stmt;
	}

	run(...params: unknown[]) {
		// `run` never returns rows, so row shape is irrelevant; don't touch the mode.
		const r = this.#stmt.run(...(params as never[]));
		return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
	}

	all(...params: unknown[]): unknown[] {
		return this.#apply(this.#returnArrays).all(...(params as never[])) as unknown[];
	}

	get(...params: unknown[]): unknown {
		return this.#apply(this.#returnArrays).get(...(params as never[]));
	}

	raw(toggle = true): ShimStatement {
		this.#apply(toggle);
		return this;
	}
}

export class SqliteShim {
	#db: DatabaseSync;
	/**
	 * SQLite has no nested transactions, so `BEGIN` inside a transaction is an
	 * error. Drizzle issues savepoints for nesting itself, but it wraps the
	 * *outermost* call in `client.transaction()`. We track depth so a nested
	 * call becomes a no-op passthrough rather than a "cannot start a transaction
	 * within a transaction" failure.
	 */
	#depth = 0;

	constructor(location: string) {
		this.#db = new DatabaseSync(location);
	}

	prepare(sql: string): ShimStatement {
		return new Statement(this.#db.prepare(sql));
	}

	exec(sql: string): void {
		this.#db.exec(sql);
	}

	/**
	 * Mirrors better-sqlite3's `db.transaction(fn)`, which returns a *callable*
	 * that runs `fn` inside BEGIN/COMMIT and rolls back on throw.
	 *
	 * The returned function also carries `.deferred` / `.immediate` / `.exclusive`
	 * properties selecting the BEGIN variant — Drizzle depends on these: it calls
	 * `client.transaction(fn)[behavior]()` where `behavior` defaults to
	 * `'deferred'`. Returning a bare function makes every `db.transaction()` fail
	 * with "nativeTx[...] is not a function".
	 */
	transaction<T extends (...args: never[]) => unknown>(fn: T): TransactionFn<T> {
		const run = (begin: string, args: Parameters<T>): ReturnType<T> => {
			// SQLite cannot nest transactions. Drizzle emits savepoints for nesting
			// itself, so an inner call must pass straight through.
			if (this.#depth > 0) return fn(...args) as ReturnType<T>;

			this.#db.exec(begin);
			this.#depth++;
			try {
				const result = fn(...args) as ReturnType<T>;
				this.#db.exec('COMMIT');
				return result;
			} catch (err) {
				// A failed COMMIT may already have unwound the transaction; rolling
				// back a non-existent one would mask the original error.
				try {
					this.#db.exec('ROLLBACK');
				} catch {
					/* already unwound */
				}
				throw err;
			} finally {
				this.#depth--;
			}
		};

		const wrapped = ((...args: Parameters<T>) => run('BEGIN', args)) as TransactionFn<T>;
		wrapped.default = wrapped;
		wrapped.deferred = (...args: Parameters<T>) => run('BEGIN DEFERRED', args);
		wrapped.immediate = (...args: Parameters<T>) => run('BEGIN IMMEDIATE', args);
		wrapped.exclusive = (...args: Parameters<T>) => run('BEGIN EXCLUSIVE', args);
		return wrapped;
	}

	close(): void {
		this.#db.close();
	}
}

/**
 * Default export so this module can stand in for `better-sqlite3` via a build
 * alias (see `vite.config.ts`).
 *
 * Drizzle's driver does `import Client from 'better-sqlite3'` at module scope
 * purely to support its `drizzle('path/to.db')` convenience overload. We always
 * hand it an already-open client, so `Client` is never constructed — but the
 * static import still has to resolve. Aliasing it here keeps the real native
 * package out of the dependency tree entirely, rather than installing a package
 * we never call.
 */
export default SqliteShim;

/**
 * Opens the database with the pragmas a small self-hosted server wants:
 * - `journal_mode=WAL` so a long-running read (a ZIP stream enumerating photos)
 *   never blocks an upload writing rows.
 * - `busy_timeout` so concurrent writers wait rather than throwing SQLITE_BUSY.
 * - `foreign_keys=ON` — SQLite defaults this *off*, which would silently let
 *   photos outlive their deleted collection.
 */
export function openDatabase(location: string): SqliteShim {
	const db = new SqliteShim(location);
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA busy_timeout = 5000');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec('PRAGMA synchronous = NORMAL');
	return db;
}
