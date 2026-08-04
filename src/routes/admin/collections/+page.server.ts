import { fail, redirect } from '@sveltejs/kit';
import { eq, sql, and, asc } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { collections, photos } from '$lib/server/db/schema';
import { requireOwner } from '$lib/server/guards';
import { uniqueSlug } from '$lib/server/slug';
import { keyBetween } from '$lib/server/sort-key';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireOwner(locals, url.pathname);

	/**
	 * Photo counts come from a correlated subquery rather than a join with GROUP
	 * BY, so a collection with no photos still appears — a brand-new, empty
	 * collection is exactly the one the artist is about to work on.
	 */
	const rows = db
		.select({
			id: collections.id,
			slug: collections.slug,
			title: collections.title,
			visibility: collections.visibility,
			hasPassword: sql<number>`(${collections.passwordHash} is not null)`,
			sortKey: collections.sortKey,
			updatedAt: collections.updatedAt,
			photoCount: sql<number>`(select count(*) from ${photos} where ${photos.collectionId} = ${collections.id})`,
			pendingCount: sql<number>`(select count(*) from ${photos} where ${photos.collectionId} = ${collections.id} and ${photos.status} in ('pending','processing'))`
		})
		.from(collections)
		.where(eq(collections.ownerId, user.id))
		.orderBy(asc(collections.sortKey))
		.all();

	return {
		collections: rows.map((r) => ({ ...r, hasPassword: !!r.hasPassword }))
	};
};

export const actions: Actions = {
	create: async ({ locals, request, url }) => {
		const user = requireOwner(locals, url.pathname);
		const data = await request.formData();
		const title = String(data.get('title') ?? '').trim();

		if (!title) return fail(400, { message: 'Give the collection a title.' });
		if (title.length > 200) return fail(400, { message: 'That title is too long.' });

		const id = crypto.randomUUID();

		db.transaction((tx) => {
			// Uniqueness is checked inside the transaction that inserts, so two
			// simultaneous creates can't settle on the same slug.
			const slug = uniqueSlug(title, (candidate) => {
				return !!tx
					.select({ id: collections.id })
					.from(collections)
					.where(and(eq(collections.ownerId, user.id), eq(collections.slug, candidate)))
					.get();
			});

			// New collections go to the top: it's the one you just made and want to
			// start filling.
			const first = tx
				.select({ sortKey: collections.sortKey })
				.from(collections)
				.where(eq(collections.ownerId, user.id))
				.orderBy(asc(collections.sortKey))
				.limit(1)
				.get();

			tx.insert(collections)
				.values({
					id,
					ownerId: user.id,
					slug,
					title,
					sortKey: keyBetween(null, first?.sortKey ?? null),
					// Today, until the artist dates it themselves. Under the default
					// ordering that also puts it at the top, agreeing with `sortKey`.
					datedAt: new Date(),
					// Private until the artist decides otherwise — publishing should be
					// a deliberate act, not the default for an empty collection.
					visibility: 'private'
				})
				.run();
		});

		redirect(303, `/admin/collections/${id}`);
	}
};
