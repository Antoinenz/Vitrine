import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { invalidateSession, deleteSessionCookie } from '$lib/server/auth';

export const actions: Actions = {
	/**
	 * POST-only. Signing out via a GET would let any page log the artist out with
	 * an <img> tag pointing at this URL.
	 */
	default: async (event) => {
		if (event.locals.session) invalidateSession(event.locals.session.id);
		deleteSessionCookie(event);
		redirect(303, '/');
	}
};
