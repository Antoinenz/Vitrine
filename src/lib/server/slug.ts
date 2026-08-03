/**
 * URL slugs for collections.
 *
 * A collection's slug is the shareable part of its URL, so it should stay
 * readable and stable. It is derived from the title once, on creation, and
 * thereafter only changes if the artist edits it deliberately — silently
 * re-slugging on every rename would break links that have already been shared.
 */

/** Slugs we can't hand out because they'd collide with real routes. */
const RESERVED = new Set(['admin', 'api', 'c', 'login', 'logout', 'unlock', 'static', '_app']);

/**
 * Converts arbitrary text into a URL-safe slug.
 *
 * Accents are decomposed and stripped rather than dropped, so "Sierra Nevada
 * Otoño" becomes `sierra-nevada-otono` instead of losing the word entirely.
 */
export function slugify(input: string): string {
	const slug = input
		.normalize('NFKD')
		// Strip combining marks left behind by NFKD (the accents themselves).
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		// Long slugs are unwieldy in a URL and the tail adds nothing.
		.slice(0, 80)
		.replace(/-+$/g, '');

	return slug;
}

/**
 * Produces a slug that doesn't collide, appending `-2`, `-3`, … as needed.
 *
 * `taken` is supplied by the caller rather than queried here so the check can
 * run inside the same transaction as the insert, and so this stays a pure
 * function that's trivial to test.
 */
export function uniqueSlug(input: string, taken: (slug: string) => boolean): string {
	// An all-punctuation title ("...") slugifies to nothing; fall back rather
	// than generating an empty URL segment.
	const base = slugify(input) || 'untitled';

	let candidate = base;
	let n = 1;
	while (taken(candidate) || RESERVED.has(candidate)) {
		n++;
		candidate = `${base}-${n}`;
	}
	return candidate;
}

export function isReservedSlug(slug: string): boolean {
	return RESERVED.has(slug);
}
