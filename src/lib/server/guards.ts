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
