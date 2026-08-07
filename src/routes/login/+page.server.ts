import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import {
	verifyPassword,
	generateSessionToken,
	createSession,
	setSessionCookie,
	hashPassword
} from '$lib/server/auth';
import { rateLimit, resetRateLimit, LIMITS } from '$lib/server/rate-limit';

/**
 * The `next` parameter, but only when it points back into this site.
 *
 * An attacker-supplied absolute URL would turn the sign-in form into an open
 * redirect, and `//evil.example` is a protocol-relative URL, not a local path —
 * hence rejecting a leading double slash as well.
 */
function safeNext(url: URL): string | null {
	const next = url.searchParams.get('next');
	return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	// Already signed in — nothing to do here.
	if (locals.user) redirect(303, safeNext(url) ?? '/');

	// Surfaced so a fresh install can explain itself rather than showing a login
	// form for an account that was never created.
	const hasAccount = !!db.select({ id: users.id }).from(users).limit(1).get();
	return { hasAccount };
};

export const actions: Actions = {
	default: async (event) => {
		const { request, getClientAddress, url } = event;
		const data = await request.formData();
		const email = String(data.get('email') ?? '')
			.toLowerCase()
			.trim();
		const password = String(data.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { email, message: 'Enter your email and password.' });
		}

		// Keyed by address so one client can't grind through passwords. Not keyed
		// by email as well: that would let an attacker reset their own budget by
		// varying the address they submit.
		const key = `login:${getClientAddress()}`;
		const limit = rateLimit(key, LIMITS.login.limit, LIMITS.login.windowMs);
		if (!limit.allowed) {
			return fail(429, {
				email,
				message: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`
			});
		}

		const user = db.select().from(users).where(eq(users.email, email)).get();

		/**
		 * Hash even when the account doesn't exist.
		 *
		 * Argon2 is deliberately slow, so returning early for an unknown email
		 * would make "no such user" measurably faster than "wrong password" and
		 * turn the login form into an account-enumeration oracle.
		 */
		const valid = user
			? await verifyPassword(user.passwordHash, password)
			: (await hashPassword(password), false);

		if (!user || !valid) {
			return fail(400, { email, message: 'Incorrect email or password.' });
		}

		resetRateLimit(key);

		const token = generateSessionToken();
		const session = createSession(token, user.id);
		setSessionCookie(event, token, session.expiresAt);

		redirect(303, user.mustChangePassword ? '/password' : (safeNext(url) ?? '/'));
	}
};
