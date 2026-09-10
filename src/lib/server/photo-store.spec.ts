import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guards the rule that anything querying the `photos` table has to consider
 * whether it should see trashed photographs.
 *
 * ## A weaker rule than the one for collections, on purpose
 *
 * Collections have a single reader and the test forbids the table being touched
 * anywhere else. That works because there are five query shapes and all of them
 * mean "find me a collection".
 *
 * Photographs are not like that: an upload, a processing state machine,
 * reordering, cover selection and retries between them make thirty queries of a
 * dozen shapes. Wrapping each one would produce a module of single-caller
 * functions that hides the state machine without making anything safer.
 *
 * So the rule here only requires that the question was asked: a file that
 * queries the table must mention `photoNotTrashed`. It cannot prove the filter
 * was applied to the right query, and it is worth being clear that it does not.
 * What it does prevent is the case that has now happened twice in this
 * repository — a new query written by someone who had not thought about the
 * trash at all.
 */

const ROOT = new URL('../../..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/**
 * Files allowed to touch the table without mentioning the filter.
 *
 * `photo-store.ts` defines it. The purge path deliberately works on trashed rows
 * and nothing else, so requiring the live-only predicate there would be
 * backwards.
 */
const ALLOWED = new Set(['lib/server/photo-store.ts', 'lib/server/actions/trash.ts']);

const PATTERNS = ['from(photos)', 'insert(photos)', 'update(photos)', 'delete(photos)'];

/**
 * Reaching the table sideways, through a join.
 *
 * The same hole the collections rule left open, and it opened again here: the
 * rendition endpoint selects *derivatives* and joins photographs along to check
 * access, so `from(photos)` never matched it. Trashing a photograph removed it
 * from its collection while `/i/<id>/<size>` went on serving every rendition.
 *
 * Caught by an end-to-end test rather than by this file, which is the argument
 * for adding it here: the next such query should fail the build instead.
 */
const JOINS = ['Join(photos'];

function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
		else if (/\.(ts|svelte)$/.test(entry)) found.push(full);
	}
	return found;
}

describe('queries against the photos table', () => {
	it('all consider whether trashed photographs belong in them', () => {
		const offenders: string[] = [];

		for (const file of sourceFiles(SRC)) {
			const path = relative(SRC, file);
			if (ALLOWED.has(path) || path.endsWith('.spec.ts')) continue;

			const source = readFileSync(file, 'utf8');
			const touches =
				PATTERNS.some((p) => source.includes(p)) || JOINS.some((j) => source.includes(j));
			if (touches && !source.includes('photoNotTrashed')) {
				offenders.push(path);
			}
		}

		expect(
			offenders,
			'Queries on `photos` must apply `photoNotTrashed`, or use lib/server/photo-store.ts. ' +
				'If trashed rows genuinely belong in the result, add the file to ALLOWED with a reason.'
		).toEqual([]);
	});

	it('finds the module that defines the filter, so the search is known to work', () => {
		const source = readFileSync(join(SRC, 'lib/server/photo-store.ts'), 'utf8');
		expect(source).toContain('from(photos)');
		expect(source).toContain('photoNotTrashed');
	});
});
