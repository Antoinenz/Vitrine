import type { Handle, ServerInit } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	validateSessionToken,
	setSessionCookie,
	deleteSessionCookie
} from '$lib/server/auth';
import { bootstrap } from '$lib/server/bootstrap';

/**
 * Runs once before the first request is served: creates storage directories and
 * seeds the owner account on a fresh install.
 *
 * The image worker is started from here too once it exists — it also needs to
 * requeue any processing a previous shutdown interrupted.
 */
export const init: ServerInit = async () => {
	await bootstrap();
};

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);

	if (!token) {
		event.locals.user = null;
		event.locals.session = null;
		return resolve(event);
	}

	const { session, user } = validateSessionToken(token);

	if (session) {
		// `validateSessionToken` slides the expiry; re-issue the cookie so the
		// browser's copy expires at the same time the database record does.
		setSessionCookie(event, token, session.expiresAt);
	} else {
		// Expired or forged — clear it so the browser stops sending it.
		deleteSessionCookie(event);
	}

	event.locals.user = user;
	event.locals.session = session;

	return resolve(event);
};
