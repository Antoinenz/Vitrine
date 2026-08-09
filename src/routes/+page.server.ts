import { fail, redirect } from '@sveltejs/kit';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { collections, photos, profiles, users } from '$lib/server/db/schema';
import { toPhotoViews } from '$lib/server/photos';
import { isListed } from '$lib/server/access';
import { requireOwner } from '$lib/server/guards';
import { collectionOrder } from '$lib/server/collection-order';
import { createCollection, CollectionInputError } from '$lib/server/actions/collection';
import {
	avatarCandidates,
	loadProfile,
	saveProfile,
	ProfileInputError
} from '$lib/server/actions/profile';

/** How many photos make up the visual stack for each collection. */
const STACK_DEPTH = 4;

export const load: PageServerLoad = async ({ locals }) => {
	// Single-artist install: the first account is the owner whose page this is.
	// `owner_id` already exists throughout, so serving several artists later is a
	// routing change rather than a migration.
	const owner = db.select().from(users).orderBy(asc(users.createdAt)).limit(1).get();
	if (!owner) return { profile: null, collections: [], isOwner: false, owner: null };

	const profile = db.select().from(profiles).where(eq(profiles.userId, owner.id)).get();

	// Newest work first, by when it was photographed rather than uploaded.
	// `collectionDate()` explains the fallback chain.
	const all = db
		.select()
		.from(collections)
		.where(eq(collections.ownerId, owner.id))
		.orderBy(collectionOrder(profile?.collectionOrder))
		.all();

	/**
	 * Only public collections are listed. Unlisted ones stay reachable by URL but
	 * must never appear here — that distinction is the whole point of the state.
	 * The owner sees their private and unlisted work too, so the page doubles as
	 * a preview of their own site.
	 */
	const isOwner = locals.user?.id === owner.id;
	const visible = all.filter((c) => isListed(c) || isOwner);
	if (visible.length === 0) {
		return {
			profile: profile ?? null,
			collections: [],
			isOwner,
			/**
			 * Carried here too, and this is the case that matters most: an install
			 * with nothing in it is exactly when the artist needs the create button,
			 * and returning early without this would leave the empty page with no
			 * way forward.
			 */
			owner: isOwner
				? { profile: loadProfile(owner.id), candidates: avatarCandidates(owner.id) }
				: null
		};
	}

	// One query for every stack, rather than one per collection.
	const rows = db
		.select()
		.from(photos)
		.where(
			inArray(
				photos.collectionId,
				visible.map((c) => c.id)
			)
		)
		.orderBy(asc(photos.sortKey))
		.all();

	const byCollection = new Map<string, typeof rows>();
	for (const row of rows) {
		const list = byCollection.get(row.collectionId) ?? [];
		list.push(row);
		byCollection.set(row.collectionId, list);
	}

	const stacks = visible
		.map((collection) => {
			const owned = byCollection.get(collection.id) ?? [];

			/**
			 * The stack shows the grid's opening photographs, in the grid's own
			 * order — no cover-first reshuffle.
			 *
			 * Leading with the cover meant the stack and the grid disagreed about
			 * order whenever the cover wasn't already first, so opening a collection
			 * visibly rearranged the photographs even though each one flew to the
			 * right place. Artists control the face of a collection by ordering it;
			 * `coverPhotoId` remains for social preview images.
			 */
			const ordered = owned;

			return {
				id: collection.id,
				slug: collection.slug,
				title: collection.title,
				description: collection.description,
				visibility: collection.visibility,
				hasPassword: !!collection.passwordHash,
				photoCount: owned.filter((p) => p.status === 'ready').length,
				/**
				 * Owner-only progress. Counted from rows already in memory, so this
				 * costs nothing, and without it a collection whose photographs are
				 * still being processed looks simply broken to the person who just
				 * uploaded them.
				 */
				pendingCount: isOwner
					? owned.filter((p) => p.status === 'pending' || p.status === 'processing').length
					: 0,
				failedCount: isOwner ? owned.filter((p) => p.status === 'failed').length : 0,
				stack: toPhotoViews(ordered.slice(0, STACK_DEPTH), collection)
			};
		})
		/**
		 * A collection with nothing processed yet has no stack to show a visitor.
		 * The owner still sees it, otherwise a collection they just created would
		 * vanish the moment it was made and there would be no way back to it.
		 */
		.filter((c) => isOwner || c.stack.length > 0);

	return {
		profile: profile ?? null,
		collections: stacks,
		isOwner,
		/**
		 * Everything the inline editors need, and nothing a visitor would receive.
		 * Gated on ownership rather than merely hidden in the markup, so the
		 * anonymous payload doesn't grow and the portrait candidate list — which
		 * names photographs — never reaches anyone else.
		 */
		owner: isOwner
			? { profile: loadProfile(owner.id), candidates: avatarCandidates(owner.id) }
			: null
	};
};

/**
 * The artist page edits itself.
 *
 * Named actions here rather than JSON endpoints, because `fail()` /
 * `form?.message` / `use:enhance` is the pattern the whole app already uses and
 * it keeps working with JavaScript off. Each action calls `requireOwner` itself:
 * actions run *before* loads, so nothing the load checked can be relied on.
 */
export const actions: Actions = {
	createCollection: async ({ locals, request, url }) => {
		const user = requireOwner(locals, url.pathname);
		const data = await request.formData();

		let slug: string;
		try {
			slug = createCollection(user, String(data.get('title') ?? ''));
		} catch (err) {
			if (err instanceof CollectionInputError) {
				return fail(400, { scope: 'create', message: err.message });
			}
			throw err;
		}

		// Straight into the new collection, which is empty and wants photographs.
		redirect(303, `/c/${slug}`);
	},

	profile: async ({ locals, request, url }) => {
		const user = requireOwner(locals, url.pathname);
		const data = await request.formData();

		try {
			saveProfile(user, data);
		} catch (err) {
			if (err instanceof ProfileInputError) {
				return fail(400, { scope: 'profile', message: err.message });
			}
			throw err;
		}

		return { scope: 'profile', saved: true };
	}
};
