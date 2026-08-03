import { describe, it, expect } from 'vitest';
import { keyBetween, keysAfter } from './sort-key';

describe('keyBetween', () => {
	it('seeds an empty list', () => {
		const k = keyBetween(null, null);
		expect(k).toBeTruthy();
		// Round-trips: the seed must itself be a valid bound for further keys.
		expect(() => keyBetween(k, null)).not.toThrow();
		expect(() => keyBetween(null, k)).not.toThrow();
	});

	it('appends after a key', () => {
		const a = keyBetween(null, null);
		const b = keyBetween(a, null);
		expect(b > a).toBe(true);
	});

	it('prepends before a key', () => {
		const a = keyBetween(null, null);
		const b = keyBetween(null, a);
		expect(b < a).toBe(true);
	});

	it('inserts strictly between two keys', () => {
		const a = keyBetween(null, null);
		const c = keyBetween(a, null);
		const b = keyBetween(a, c);
		expect(a < b).toBe(true);
		expect(b < c).toBe(true);
	});

	it('rejects reversed bounds', () => {
		const a = keyBetween(null, null);
		const b = keyBetween(a, null);
		expect(() => keyBetween(b, a)).toThrow(/out of order/);
	});

	it('rejects equal bounds', () => {
		const a = keyBetween(null, null);
		expect(() => keyBetween(a, a)).toThrow(/out of order/);
	});

	it('rejects malformed keys', () => {
		expect(() => keyBetween('', null)).toThrow(/empty/);
		expect(() => keyBetween('!!', null)).toThrow(/Invalid sort-key head/);
		// A trailing '0' in the fraction is ambiguous with the key without it.
		expect(() => keyBetween('a0V0', null)).toThrow(/must not end/);
		// Integer part shorter than its head character promises.
		expect(() => keyBetween('b0', null)).toThrow(/too short/);
	});

	it('produces the documented key shapes', () => {
		expect(keyBetween(null, null)).toBe('a0');
		expect(keyBetween('a0', null)).toBe('a1');
		expect(keyBetween('a0', 'a1')).toBe('a0V');
	});

	/**
	 * The property that actually matters in production: no matter how many times
	 * an item is dropped between the same two neighbours, a valid key always
	 * exists and ordering is preserved. This is the case that would break a
	 * naive "average the two midpoints" float scheme once precision ran out.
	 */
	it('survives repeated insertion at the same position', () => {
		let lo = keyBetween(null, null);
		const hi = keyBetween(lo, null);

		for (let i = 0; i < 500; i++) {
			const mid = keyBetween(lo, hi);
			expect(lo < mid).toBe(true);
			expect(mid < hi).toBe(true);
			lo = mid; // squeeze into an ever-narrower gap
		}
	});

	it('keeps a list sorted through many random insertions', () => {
		const list: string[] = [keyBetween(null, null)];

		for (let i = 0; i < 300; i++) {
			const at = Math.floor(Math.random() * (list.length + 1));
			const before = at === 0 ? null : list[at - 1];
			const after = at === list.length ? null : list[at];
			list.splice(at, 0, keyBetween(before, after));
		}

		// Re-sorting lexicographically must be a no-op: insertion order already
		// matches SQLite's `ORDER BY sort_key`.
		expect([...list].sort()).toEqual(list);
		expect(new Set(list).size).toBe(list.length);
	});

	/**
	 * Appending is the most common operation (every upload appends), so it must
	 * not grow keys. The integer part makes this increment rather than subdivide.
	 */
	it('keeps keys short under sequential appends', () => {
		let k: string | null = null;
		const keys: string[] = [];
		for (let i = 0; i < 5000; i++) {
			k = keyBetween(k, null);
			keys.push(k);
		}
		expect(k!.length).toBeLessThanOrEqual(4);
		expect([...keys].sort()).toEqual(keys);
	});

	it('keeps keys short under sequential prepends', () => {
		let k: string | null = null;
		const keys: string[] = [];
		for (let i = 0; i < 5000; i++) {
			k = keyBetween(null, k);
			keys.push(k);
		}
		expect(k!.length).toBeLessThanOrEqual(4);
		// Prepending produces descending keys.
		expect([...keys].sort().reverse()).toEqual(keys);
	});
});

describe('keysAfter', () => {
	it('returns n ascending keys', () => {
		const keys = keysAfter(null, 40);
		expect(keys).toHaveLength(40);
		expect([...keys].sort()).toEqual(keys);
	});

	it('continues after an existing key', () => {
		const first = keyBetween(null, null);
		const keys = keysAfter(first, 10);
		expect(keys[0] > first).toBe(true);
		expect([...keys].sort()).toEqual(keys);
	});

	it('returns nothing for n = 0', () => {
		expect(keysAfter(null, 0)).toEqual([]);
	});
});
