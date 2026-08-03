import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { collections, users } from '$lib/server/db/schema';
import { verifyPassword } from '$lib/server/auth';
import { collectionAccess, grantUnlock } from '$lib/server/access';
import { rateLimit, resetRateLimit, LIMITS } from '$lib/server/rate-limit';

function findCollection(slug: string) {
	const owner = db.select().from(users).orderBy(asc(users.createdAt)).limit(1).get();
	if (!owner) error(404);

	const collection = db
		.select()
		.from(collections)
		.where(and(eq(collections.ownerId, owner.id), eq(collections.slug, slug)))
		.get();

	if (!collection) error(404);
	return collection;
}

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
	const collection = findCollection(params.slug);
	const access = collectionAccess(collection, locals, cookies);

	// Nothing to unlock — either it's already open or it isn't visible at all.
	if (access === 'granted') redirect(303, `/c/${collection.slug}`);
	if (access === 'denied') error(404);

	// Only the title is exposed before unlocking, so the visitor knows what
	// they've been sent without the contents leaking.
	return { title: collection.title, slug: collection.slug };
};

export const actions: Actions = {
	default: async ({ params, request, cookies, locals, getClientAddress, url }) => {
		const collection = findCollection(params.slug);

		if (collectionAccess(collection, locals, cookies) === 'denied') error(404);
		if (!collection.passwordHash) redirect(303, `/c/${collection.slug}`);

		// Scoped per collection *and* per address, so guessing at one gallery
		// doesn't throttle a legitimate visitor to another.
		const key = `unlock:${collection.id}:${getClientAddress()}`;
		const limit = rateLimit(key, LIMITS.unlock.limit, LIMITS.unlock.windowMs);
		if (!limit.allowed) {
			return fail(429, {
				message: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`
			});
		}

		const password = String((await request.formData()).get('password') ?? '');
		if (!(await verifyPassword(collection.passwordHash, password))) {
			return fail(400, { message: 'That password doesn’t match.' });
		}

		resetRateLimit(key);
		grantUnlock(cookies, collection);

		const next = url.searchParams.get('next');
		// Confined to this collection: an attacker-supplied `next` must not turn
		// the unlock form into a redirect to somewhere else entirely.
		const target =
			next && next.startsWith(`/c/${collection.slug}`) ? next : `/c/${collection.slug}`;

		redirect(303, target);
	}
};
