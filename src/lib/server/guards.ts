import { redirect, error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { collections, type Collection, type User } from './db/schema';

/**
 * Authorisation helpers for admin routes.
 *
 * Every admin load function and action goes through these rather than checking
 * `locals.user` inline. Centralising it means a new route can't accidentally
 * ship without a check, and the redirect behaviour stays consistent.
 */

/**
 * Requires a signed-in owner, redirecting to the login page otherwise.
 *
 * The current path is passed as `next` so the user lands back where they were
 * trying to go after logging in, rather than being dumped on a dashboard.
 */
export function requireOwner(locals: App.Locals, pathname?: string): User {
	if (!locals.user) {
		const next = pathname && pathname !== '/admin' ? `?next=${encodeURIComponent(pathname)}` : '';
		redirect(303, `/admin/login${next}`);
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
