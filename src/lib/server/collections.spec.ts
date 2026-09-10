import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guards the rule that `lib/server/collections.ts` is the only place that reads
 * the collections table.
 *
 * ## Why a test shaped like a linter
 *
 * A trashed collection has to disappear from nine different read paths, and the
 * failure mode of missing one is not cosmetic: it serves work the artist
 * believes they deleted, at a URL a client may already hold. That is a bug
 * nobody would find by using the app, because everything looks correct from the
 * inside — the collection is gone from the gallery, and only someone with the
 * old link ever sees otherwise.
 *
 * Ordinary tests cannot cover it, because the thing to prove is about code that
 * has not been written yet: the tenth query, added in a year, by someone who
 * has not read this file. So the assertion is made against the source itself.
 *
 * This is deliberately the crudest possible check — a substring search. It
 * cannot be defeated by accident and it needs no parser, and the one way around
 * it is to write the query somewhere the search does not look, which is not
 * something anyone does by mistake.
 */

const ROOT = new URL('../../..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/**
 * Files permitted to touch the table directly.
 *
 * `collections.ts` is the sanctioned module. Tests are exempt because they
 * build and inspect their own fixture databases, and a test that lies about the
 * data is a broken test rather than a leak.
 */
const ALLOWED = new Set(['lib/server/collections.ts']);

const isExempt = (path: string) => ALLOWED.has(path) || path.endsWith('.spec.ts');

function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
		else if (/\.(ts|svelte)$/.test(entry)) found.push(full);
	}
	return found;
}

/** Every way Drizzle can be pointed at the table as the subject of a query. */
const PATTERNS = [
	'from(collections)',
	'insert(collections)',
	'update(collections)',
	'delete(collections)'
];

/**
 * Reaching the table sideways, through a join.
 *
 * This is the hole the first version of these rules left open, and it was not
 * theoretical. Three queries selected derivatives or photographs and joined
 * collections along to check access — so trashing a collection removed its page
 * while `/i/<photoId>/<size>` went on serving every rendition in it, and
 * `/api/photos/<photoId>/download` went on serving the untouched originals, to
 * anyone holding a photograph id. The page publishes those ids in `data-photo`.
 *
 * Such queries cannot move into `collections.ts` — the collection is not what
 * they are selecting — so the rule is different in shape: join it if you must,
 * but say `notTrashed` while you do.
 */
const JOINS = ['Join(collections'];

describe('the collections table has one reader', () => {
	it('is queried only through lib/server/collections.ts', () => {
		const offenders: string[] = [];

		for (const file of sourceFiles(SRC)) {
			const path = relative(SRC, file);
			if (isExempt(path)) continue;

			const source = readFileSync(file, 'utf8');
			for (const pattern of PATTERNS) {
				if (source.includes(pattern)) offenders.push(`${path} — ${pattern}`);
			}

			for (const join of JOINS) {
				if (source.includes(join) && !source.includes('notTrashed')) {
					offenders.push(`${path} — joins collections without notTrashed`);
				}
			}
		}

		expect(
			offenders,
			'Query collections through lib/server/collections.ts, which excludes trashed rows. ' +
				'If the shape you need is missing, add it there rather than reaching past it.'
		).toEqual([]);
	});

	it('finds the sanctioned module itself, so the search is known to work', () => {
		// Without this, a broken path or a renamed file would make the test above
		// pass by finding nothing at all — the worst way for a guard to fail.
		const source = readFileSync(join(SRC, 'lib/server/collections.ts'), 'utf8');
		expect(source).toContain('from(collections)');
	});

	it('notices a join that forgets the filter', () => {
		// The guard above is only worth having if it fails on the shape that got
		// through last time, so this checks the check.
		const leaky = '.innerJoin(collections, eq(photos.collectionId, collections.id))';
		expect(JOINS.some((j) => leaky.includes(j))).toBe(true);
		expect(leaky.includes('notTrashed')).toBe(false);
	});

	it('scans a plausible number of files', () => {
		// The same failure again, one level up: a wrong root would scan nothing and
		// report a clean bill of health.
		expect(sourceFiles(SRC).length).toBeGreaterThan(30);
	});
});
