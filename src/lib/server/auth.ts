import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import { sessions, users, type User } from './db/schema';
import { SESSION_TTL_MS, IS_PRODUCTION } from './config';

/**
 * Session handling follows the reference implementation published by Lucia,
 * which was deprecated as a library in 2025 and re-released as a guide. It's
 * about a hundred lines, so we own it outright rather than taking on a
 * general-purpose auth framework for a single-user application.
 */

export const SESSION_COOKIE = 'vitrine_session';

/** Renew a session once it's past halfway, so active users are never logged out. */
const RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2;

/**
 * `Algorithm.Argon2id` from @node-rs/argon2, inlined.
 *
 * That export is an ambient `const enum`, which TypeScript refuses to read
 * under `verbatimModuleSyntax` (the value would have to survive erasure). The
 * numeric value is part of the package's public API, and stating it explicitly
 * is preferable to relying on the library's default: argon2id is the variant
 * that resists both GPU and side-channel attacks, and that choice should be
 * visible at the call site rather than inherited silently.
 */
const ARGON2ID = 2;

/**
 * Argon2id parameters following OWASP's recommended baseline (19 MiB, 2
 * iterations, 1 lane). The memory cost is what makes GPU cracking expensive, so
 * it shouldn't be lowered casually to speed up logins.
 */
const ARGON2_OPTIONS = {
	algorithm: ARGON2ID,
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1
} as const;

export function hashPassword(password: string): Promise<string> {
	return argonHash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(digest: string, password: string): Promise<boolean> {
	try {
		return await argonVerify(digest, password, ARGON2_OPTIONS);
	} catch {
		// A malformed or truncated hash must read as "wrong password" rather than
		// crashing the login route.
		return false;
	}
}

/** A fresh, unguessable session token. Shown to the client exactly once. */
export function generateSessionToken(): string {
	const bytes = new Uint8Array(20);
	crypto.getRandomValues(bytes);
	return encodeBase32LowerCaseNoPadding(bytes);
}

/**
 * The token is stored only as its SHA-256. A leaked database therefore yields
 * no usable sessions — an attacker would have to invert the hash to mint a
 * cookie. No salt is needed: the token is already high-entropy random.
 */
function tokenToSessionId(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

export function createSession(token: string, userId: string) {
	const session = {
		id: tokenToSessionId(token),
		userId,
		expiresAt: new Date(Date.now() + SESSION_TTL_MS)
	};
	db.insert(sessions).values(session).run();
	return session;
}

export type SessionValidation =
	{ session: typeof sessions.$inferSelect; user: User } | { session: null; user: null };

/**
 * Resolves a token to its session and user, deleting it if expired and
 * extending it if it's more than half-used.
 */
export function validateSessionToken(token: string): SessionValidation {
	const sessionId = tokenToSessionId(token);

	const row = db
		.select({ session: sessions, user: users })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, sessionId))
		.get();

	if (!row) return { session: null, user: null };

	const { session, user } = row;

	if (Date.now() >= session.expiresAt.getTime()) {
		db.delete(sessions).where(eq(sessions.id, session.id)).run();
		return { session: null, user: null };
	}

	// Sliding expiry: someone using the app daily should never be logged out,
	// but an abandoned session still ages out.
	if (Date.now() >= session.expiresAt.getTime() - RENEW_THRESHOLD_MS) {
		session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
		db.update(sessions)
			.set({ expiresAt: session.expiresAt })
			.where(eq(sessions.id, session.id))
			.run();
	}

	return { session, user };
}

export function invalidateSession(sessionId: string): void {
	db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

/** Invalidate every session for a user — used after a password change. */
export function invalidateUserSessions(userId: string): void {
	db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export function setSessionCookie(event: RequestEvent, token: string, expiresAt: Date): void {
	event.cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		// `lax` still sends the cookie on top-level navigation, so following a
		// link into the admin area keeps you logged in, while cross-site POSTs
		// don't carry it.
		sameSite: 'lax',
		secure: IS_PRODUCTION,
		expires: expiresAt
	});
}

export function deleteSessionCookie(event: RequestEvent): void {
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
}
