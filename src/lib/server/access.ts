import { hmac } from '@oslojs/crypto/hmac';
import { SHA256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { constantTimeEqual } from '@oslojs/crypto/subtle';
import type { Cookies } from '@sveltejs/kit';
import type { Collection } from './db/schema';

/**
 * The single place that decides who may see a collection.
 *
 * Every route that exposes collection content — the page, the image endpoint,
 * a download, the ZIP — resolves access through `collectionAccess`. Keeping it
 * in one function is what stops a new route from shipping with a subtly
 * different rule; a private collection is only as private as its least careful
 * endpoint.
 */

export type AccessResult =
	/** Show it. */
	| 'granted'
	/** Exists, but needs the share password first. */
	| 'locked'
	/** Behave as if it doesn't exist. */
	| 'denied';

/** Grants are scoped per collection, so unlocking one never reveals another. */
function unlockCookieName(collectionId: string): string {
	return `vitrine_unlock_${collectionId}`;
}

/**
 * Derives the grant token from the collection's own password hash.
 *
 * Using the hash as the key means changing (or clearing) a collection's
 * password invalidates every outstanding grant for it automatically, with no
 * separate revocation list and no server-wide secret to configure. It also
 * makes a grant useless for any other collection by construction.
 */
function grantToken(collection: Collection): string {
	if (!collection.passwordHash) return '';
	const mac = hmac(
		SHA256,
		new TextEncoder().encode(collection.passwordHash),
		new TextEncoder().encode(collection.id)
	);
	return encodeHexLowerCase(mac);
}

export function grantUnlock(cookies: Cookies, collection: Collection, secure: boolean): void {
	cookies.set(unlockCookieName(collection.id), grantToken(collection), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// Follows the request scheme, not NODE_ENV — see `isSecureRequest`. A
		// `Secure` cookie over plain http is dropped by the browser, which here
		// would mean the password appearing to be rejected on every attempt.
		secure,
		maxAge: 60 * 60 * 24 * 30
	});
}

export function revokeUnlock(cookies: Cookies, collectionId: string): void {
	cookies.delete(unlockCookieName(collectionId), { path: '/' });
}

function hasUnlocked(cookies: Cookies, collection: Collection): boolean {
	const presented = cookies.get(unlockCookieName(collection.id));
	if (!presented) return false;

	const expected = grantToken(collection);
	if (!expected || presented.length !== expected.length) return false;

	// Compared in constant time: a length-independent early exit would leak the
	// token a byte at a time to anyone willing to make enough requests.
	return constantTimeEqual(new TextEncoder().encode(presented), new TextEncoder().encode(expected));
}

/**
 * Resolves what a given visitor may do with a collection.
 *
 * Note the ordering: ownership wins outright, then privacy, then the password.
 * A password on a *private* collection doesn't make it reachable — visibility
 * is the outer gate and the password is an additional lock, never a bypass.
 */
export function collectionAccess(
	collection: Collection,
	locals: App.Locals,
	cookies: Cookies
): AccessResult {
	// The owner always sees their own work, including drafts.
	if (locals.user?.id === collection.ownerId) return 'granted';

	if (collection.visibility === 'private') return 'denied';

	// `public` and `unlisted` differ only in whether the collection is *listed*
	// on the artist's page; both are reachable by URL. That distinction lives in
	// the listing query, not here.
	if (collection.passwordHash && !hasUnlocked(cookies, collection)) return 'locked';

	return 'granted';
}

/** True when a collection should appear in the artist's public index. */
export function isListed(collection: Pick<Collection, 'visibility'>): boolean {
	return collection.visibility === 'public';
}
