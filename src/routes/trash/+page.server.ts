import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOwner } from '$lib/server/guards';
import { listTrashed } from '$lib/server/collections';
import {
	restore,
	purge,
	restorePhoto,
	purgePhoto,
	listTrashedPhotos,
	TRASH_RETENTION_DAYS
} from '$lib/server/actions/trash';
import { countsForCollections } from '$lib/server/photo-store';

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
	const counts = countsForCollections(trashed.map((c) => c.id));

	const retentionMs = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	const purgesAt = (at: Date | null) => (at ? new Date(at.getTime() + retentionMs) : null);

	return {
		retentionDays: TRASH_RETENTION_DAYS,

		photographs: listTrashedPhotos(user.id).map((row) => ({
			id: row.photo.id,
			name: row.photo.originalName,
			collectionTitle: row.collectionTitle,
			// A photograph inside a collection that is itself in the trash cannot be
			// brought back on its own, and saying so is kinder than a restore that
			// appears to work and changes nothing visible.
			collectionTrashed: row.collectionTrashed,
			deletedAt: row.photo.deletedAt,
			purgesAt: purgesAt(row.photo.deletedAt)
		})),
		collections: trashed.map((c) => ({
			id: c.id,
			title: c.title,
			photoCount: counts.get(c.id) ?? 0,
			deletedAt: c.deletedAt,
			// Precomputed, so the page never has to agree with the server about
			// what "thirty days from now" means.
			purgesAt: purgesAt(c.deletedAt)
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

	restorePhoto: async ({ locals, request }) => {
		const user = requireOwner(locals);
		const id = String((await request.formData()).get('id') ?? '');

		if (!restorePhoto(user.id, id)) {
			return fail(404, { message: 'That photograph is no longer in the trash.' });
		}
		return { restoredPhoto: true };
	},

	purgePhoto: async ({ locals, request }) => {
		const user = requireOwner(locals);
		const id = String((await request.formData()).get('id') ?? '');

		if (!(await purgePhoto(user.id, id))) {
			return fail(404, { message: 'That photograph is no longer in the trash.' });
		}
		return { purged: true };
	},

	empty: async ({ locals }) => {
		const user = requireOwner(locals);

		// Read the list first: purging mutates what `listTrashed` would return.
		for (const collection of listTrashed(user.id)) {
			await purge(user.id, collection.id);
		}

		// Photographs after collections: purging a collection takes its own with
		// it, so this pass has fewer rows and cannot trip over one already gone.
		for (const row of listTrashedPhotos(user.id)) {
			await purgePhoto(user.id, row.photo.id);
		}

		redirect(303, '/trash');
	}
};
