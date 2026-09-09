import { fail, redirect } from '@sveltejs/kit';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { photos } from '$lib/server/db/schema';
import { requireOwner } from '$lib/server/guards';
import { listTrashed } from '$lib/server/collections';
import { restore, purge, TRASH_RETENTION_DAYS } from '$lib/server/actions/trash';

/**
 * The trash.
 *
 * A place rather than a panel, which is how a file manager treats it: the
 * recycle bin is somewhere you go, not a mode the desktop enters. That keeps it
 * consistent with editing happening in place everywhere else — this is the one
 * screen that is genuinely about collections you cannot see anywhere.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireOwner(locals, url.pathname);
	const trashed = listTrashed(user.id);

	/**
	 * Photograph counts in one query rather than one per collection.
	 *
	 * Small numbers here today, but this is the page someone reaches after
	 * discarding a great deal at once, which is exactly when it should not
	 * become slow.
	 */
	const counts = new Map<string, number>();
	if (trashed.length > 0) {
		const rows = db
			.select({ collectionId: photos.collectionId, n: sql<number>`count(*)` })
			.from(photos)
			.where(
				inArray(
					photos.collectionId,
					trashed.map((c) => c.id)
				)
			)
			.groupBy(photos.collectionId)
			.all();
		for (const row of rows) counts.set(row.collectionId, row.n);
	}

	const retentionMs = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

	return {
		retentionDays: TRASH_RETENTION_DAYS,
		collections: trashed.map((c) => ({
			id: c.id,
			title: c.title,
			photoCount: counts.get(c.id) ?? 0,
			deletedAt: c.deletedAt,
			// Precomputed, so the page never has to agree with the server about
			// what "thirty days from now" means.
			purgesAt: c.deletedAt ? new Date(c.deletedAt.getTime() + retentionMs) : null
		}))
	};
};

export const actions: Actions = {
	restore: async ({ locals, request }) => {
		const user = requireOwner(locals);
		const id = String((await request.formData()).get('id') ?? '');

		const result = restore(user.id, id);
		if (!result) return fail(404, { message: 'That collection is no longer in the trash.' });

		/**
		 * Reported rather than silently applied. The address can change if
		 * something claimed the old one meanwhile, and an artist who hands out
		 * links needs to be told that in the moment, not discover it later.
		 */
		return {
			restored: result.collection.title,
			slug: result.slug,
			renamed: result.renamed
		};
	},

	purge: async ({ locals, request }) => {
		const user = requireOwner(locals);
		const id = String((await request.formData()).get('id') ?? '');

		const done = await purge(user.id, id);
		if (!done) return fail(404, { message: 'That collection is no longer in the trash.' });

		return { purged: true };
	},

	empty: async ({ locals }) => {
		const user = requireOwner(locals);

		// Read the list first: purging mutates what `listTrashed` would return.
		for (const collection of listTrashed(user.id)) {
			await purge(user.id, collection.id);
		}

		redirect(303, '/trash');
	}
};
