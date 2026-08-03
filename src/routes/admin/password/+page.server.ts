import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import {
	hashPassword,
	verifyPassword,
	invalidateUserSessions,
	generateSessionToken,
	createSession,
	setSessionCookie
} from '$lib/server/auth';
import { requireOwner } from '$lib/server/guards';

const MIN_LENGTH = 12;

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireOwner(locals, url.pathname);
	return { forced: user.mustChangePassword };
};

export const actions: Actions = {
	default: async (event) => {
		const user = requireOwner(event.locals, event.url.pathname);
		const data = await event.request.formData();

		const current = String(data.get('current') ?? '');
		const next = String(data.get('next') ?? '');
		const confirm = String(data.get('confirm') ?? '');

		if (next.length < MIN_LENGTH) {
			return fail(400, { message: `Use at least ${MIN_LENGTH} characters.` });
		}
		if (next !== confirm) {
			return fail(400, { message: 'The two new passwords don’t match.' });
		}

		/**
		 * The current password is still required even on the forced-change screen.
		 * Otherwise anyone who got hold of the session cookie could lock the real
		 * owner out by setting a password of their own.
		 */
		if (!(await verifyPassword(user.passwordHash, current))) {
			return fail(400, { message: 'Your current password is incorrect.' });
		}

		if (next === current) {
			return fail(400, { message: 'Choose a password you haven’t used here before.' });
		}

		const passwordHash = await hashPassword(next);
		db.update(users)
			.set({ passwordHash, mustChangePassword: false })
			.where(eq(users.id, user.id))
			.run();

		// Changing a password should end every other session — that's the action
		// you take when you think someone else has one.
		invalidateUserSessions(user.id);

		// Which includes this one, so issue a fresh cookie rather than logging the
		// artist out of the browser they're actively using.
		const token = generateSessionToken();
		const session = createSession(token, user.id);
		setSessionCookie(event, token, session.expiresAt);

		redirect(303, '/admin/collections');
	}
};
