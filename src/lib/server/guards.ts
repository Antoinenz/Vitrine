import { redirect, error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { collections, type Collection, type User } from './db/schema';

/**
 * Authorisation helpers for anything the artist owns.
 *
 * Every owner-only load function and action goes through these rather than
 * checking `locals.user` inline. Centralising it means a new route can't
 * accidentally ship without a check, and the redirect behaviour stays
 * consistent — which matters more now that editing happens inline on public
 * pages, where an unguarded action would sit next to unguarded public code.
 */

/** Reachable while the account is pinned to a password change. */
const PASSWORD_EXEMPT = new Set(['/password', '/logout']);

/**
 * Requires a signed-in owner, redirecting to the login page otherwise.
 *
 * The current path is passed as `next` so the artist lands back where they were
 * trying to go after signing in, rather than being dumped on a dashboard.
 *
 * This also carries the forced-password pin that the deleted `/admin` layout
 * used to own, which makes it *stronger* than before: layout loads never ran
 * for `+server.ts` endpoints, so the upload endpoint was reachable by an
 * account still using its bootstrap password.
 */
export function requireOwner(locals: App.Locals, pathname?: string): User {
	if (!locals.user) {
		const next = pathname ? `?next=${encodeURIComponent(pathname)}` : '';
		redirect(303, `/login${next}`);
	}

	// A bootstrap password from an env file or compose config shouldn't stay
	// usable, so the account is pinned to the change screen until it's rotated.
	if (locals.user.mustChangePassword && !(pathname && PASSWORD_EXEMPT.has(pathname))) {
		redirect(303, '/password');
	}

	return locals.user;
}

/**
 * Requires a signed-in owner for an endpoint, replying rather than redirecting.
 *
 * `requireOwner`'s 303 is right for a page — the browser follows it and the
 * artist sees the login form. It is wrong for `fetch`/XHR: the redirect is
 * followed transparently, `/login` renders fine, and the caller sees **200 with
 * an HTML body**. The uploader checks only the status code, so an expired
 * session would look like a successful upload of every file, with nothing
 * appearing in the collection afterwards.
 *
 * So endpoints get a status their caller can actually act on.
 */
export function requireOwnerApi(locals: App.Locals): User {
	if (!locals.user) error(401, 'Not signed in');
	if (locals.user.mustChangePassword) error(403, 'Password change required');
	return locals.user;
}

/**
 * Loads a collection the given user owns, or 404s.
 *
 * Deliberately 404 rather than 403: replying "forbidden" would confirm that a
 * collection with this id exists, which leaks the existence of private work to
 * anyone probing ids.
 */
export function requireOwnedCollection(userId: string, collectionId: string): Collection {
	const collection = db
		.select()
		.from(collections)
		.where(and(eq(collections.id, collectionId), eq(collections.ownerId, userId)))
		.get();

	if (!collection) error(404, 'Collection not found');
	return collection;
}

/**
 * The same, addressed by slug.
 *
 * Inline editing works from the public URL, where the slug is what the artist
 * is looking at — the id never appears. Slugs are unique per owner, so scoping
 * the lookup by owner is what makes this unambiguous.
 */
export function requireOwnedCollectionBySlug(userId: string, slug: string): Collection {
	const collection = db
		.select()
		.from(collections)
		.where(and(eq(collections.slug, slug), eq(collections.ownerId, userId)))
		.get();

	if (!collection) error(404, 'Collection not found');
	return collection;
}
