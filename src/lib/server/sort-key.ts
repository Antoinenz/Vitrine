/**
 * Fractional index keys for ordering photos and collections.
 *
 * Integer `position` columns force a renumbering write across every sibling row
 * whenever one item moves. Fractional keys instead let us mint a value that
 * sorts strictly between two neighbours, so a drag-and-drop reorder is a
 * single-row UPDATE regardless of collection size — which matters when a
 * collection holds several hundred photos.
 *
 * Keys compare with ordinary lexicographic ordering, which is exactly what
 * SQLite's default `TEXT` collation does, so `ORDER BY sort_key` needs no
 * special collation.
 *
 * ## Structure
 *
 * A key is an *integer part* followed by an optional *fractional part*:
 *
 *     a0      integer 0
 *     a1      integer 1
 *     a0V     between a0 and a1
 *
 * The integer part's first character encodes how many digits follow ('a' → 1
 * digit, 'b' → 2, and so on; capitals run the other way for the negative side).
 * Appending therefore *increments an integer* rather than repeatedly halving the
 * remaining space — the key stays ~2 characters no matter how many photos are
 * added. A pure-fraction scheme would instead converge on the top of the
 * keyspace, growing by a character every few appends (~200 chars after 1000
 * uploads), which is the failure this structure exists to avoid.
 *
 * This is the well-tested scheme popularised by Implementing Fractional
 * Indexing (rocicorp/fractional-indexing), reimplemented here to avoid a
 * dependency for ~100 lines.
 */

/** 62 digits in ASCII order, so digit order and string comparison agree. */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const ZERO = DIGITS[0];

/** The lowest representable integer part; nothing may sort below it. */
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26);

function digitIndex(c: string): number {
	const i = DIGITS.indexOf(c);
	if (i === -1) throw new Error(`Invalid sort-key digit: ${JSON.stringify(c)}`);
	return i;
}

/** Number of digits following the head character. */
function integerLength(head: string): number {
	if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
	if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
	throw new Error(`Invalid sort-key head: ${JSON.stringify(head)}`);
}

function integerPart(key: string): string {
	const len = integerLength(key[0]);
	if (len > key.length) throw new Error(`Sort key is too short: ${key}`);
	return key.slice(0, len);
}

function validateInteger(int: string): void {
	if (int.length !== integerLength(int[0])) {
		throw new Error(`Invalid sort-key integer part: ${int}`);
	}
}

function validate(key: string, label: string): void {
	if (key === '') throw new Error(`${label} sort key must not be empty`);
	if (key === SMALLEST_INTEGER) throw new Error(`${label} sort key is at the lower bound`);

	const int = integerPart(key);
	validateInteger(int);

	const fraction = key.slice(int.length);
	for (const c of fraction) digitIndex(c);
	// A trailing zero would make two different strings denote the same value
	// while comparing differently, breaking "strictly between".
	if (fraction.endsWith(ZERO)) {
		throw new Error(`${label} sort key must not end in '${ZERO}': ${key}`);
	}
}

/** Returns the next integer part, or null if the keyspace is exhausted. */
function incrementInteger(int: string): string | null {
	validateInteger(int);
	const [head, ...digits] = int.split('');

	let carry = true;
	for (let i = digits.length - 1; carry && i >= 0; i--) {
		const d = digitIndex(digits[i]) + 1;
		if (d === BASE) {
			digits[i] = ZERO;
		} else {
			digits[i] = DIGITS[d];
			carry = false;
		}
	}

	if (!carry) return head + digits.join('');

	// Overflowed the digits: widen by moving to the next head character.
	if (head === 'Z') return 'a' + ZERO;
	if (head === 'z') return null;

	const next = String.fromCharCode(head.charCodeAt(0) + 1);
	if (next > 'a') digits.push(ZERO);
	else digits.pop();
	return next + digits.join('');
}

/** Returns the previous integer part, or null if the keyspace is exhausted. */
function decrementInteger(int: string): string | null {
	validateInteger(int);
	const [head, ...digits] = int.split('');

	let borrow = true;
	for (let i = digits.length - 1; borrow && i >= 0; i--) {
		const d = digitIndex(digits[i]) - 1;
		if (d === -1) {
			digits[i] = DIGITS[BASE - 1];
		} else {
			digits[i] = DIGITS[d];
			borrow = false;
		}
	}

	if (!borrow) return head + digits.join('');

	if (head === 'a') return 'Z' + DIGITS[BASE - 1];
	if (head === 'A') return null;

	const prev = String.fromCharCode(head.charCodeAt(0) - 1);
	if (prev < 'Z') digits.push(DIGITS[BASE - 1]);
	else digits.pop();
	return prev + digits.join('');
}

/**
 * A fraction strictly between `a` and `b`, both bare digit strings, where an
 * empty `a` means zero and a null `b` means one.
 */
function midpoint(a: string, b: string | null): string {
	if (b !== null && a >= b) {
		throw new Error(`Sort keys out of order: ${JSON.stringify(a)} >= ${JSON.stringify(b)}`);
	}

	// Share the longest common prefix, then solve the smaller problem.
	if (b !== null) {
		let n = 0;
		while (n < b.length && (a[n] ?? ZERO) === b[n]) n++;
		if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
	}

	const digitA = a === '' ? 0 : digitIndex(a[0]);
	const digitB = b === null || b === '' ? BASE : digitIndex(b[0]);

	// Room for a digit strictly between: take the middle one and stop.
	if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)];

	// Adjacent digits: descend into b's remainder...
	if (b !== null && b.length > 1) return b.slice(0, 1);
	// ...or keep a's leading digit and find room further right.
	return DIGITS[digitA] + midpoint(a.slice(1), null);
}

/**
 * Mints a key ordering strictly between `before` and `after`.
 *
 * Pass `null` for an open end: `keyBetween(null, first)` prepends,
 * `keyBetween(last, null)` appends, and `keyBetween(null, null)` seeds an empty
 * list.
 */
export function keyBetween(before: string | null, after: string | null): string {
	if (before !== null) validate(before, 'before');
	if (after !== null) validate(after, 'after');
	if (before !== null && after !== null && before >= after) {
		throw new Error(`Sort keys out of order: ${before} >= ${after}`);
	}

	// Seed.
	if (before === null && after === null) return 'a' + ZERO;

	// Prepend.
	if (before === null) {
		const int = integerPart(after!);
		const fraction = after!.slice(int.length);

		if (int === SMALLEST_INTEGER) return int + midpoint('', fraction);
		// `after` has a fractional part, so its integer part alone sorts below it.
		if (int < after!) return int;

		const decremented = decrementInteger(int);
		if (decremented === null) throw new Error('Sort keyspace exhausted below');
		return decremented;
	}

	// Append.
	if (after === null) {
		const int = integerPart(before);
		const fraction = before.slice(int.length);
		const incremented = incrementInteger(int);
		// Only once integers are exhausted do we fall back to growing a fraction.
		return incremented === null ? int + midpoint(fraction, null) : incremented;
	}

	// Insert between.
	const intBefore = integerPart(before);
	const fractionBefore = before.slice(intBefore.length);
	const intAfter = integerPart(after);
	const fractionAfter = after.slice(intAfter.length);

	if (intBefore === intAfter) return intBefore + midpoint(fractionBefore, fractionAfter);

	const incremented = incrementInteger(intBefore);
	if (incremented === null) throw new Error('Sort keyspace exhausted above');
	// If there's a whole integer free between them, use it — it's the shortest key.
	if (incremented < after) return incremented;
	return intBefore + midpoint(fractionBefore, null);
}

/**
 * `n` ascending keys after `before`, for bulk insert such as a multi-file
 * upload.
 */
export function keysAfter(before: string | null, n: number): string[] {
	const keys: string[] = [];
	let prev = before;
	for (let i = 0; i < n; i++) {
		prev = keyBetween(prev, null);
		keys.push(prev);
	}
	return keys;
}
