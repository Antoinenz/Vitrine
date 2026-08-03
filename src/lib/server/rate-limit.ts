/**
 * A small in-memory rate limiter for credential endpoints (login, collection
 * password unlock) and expensive ones (ZIP building).
 *
 * In-memory is the right scope here: the app is a single Node process by
 * design, so there is no second instance whose counters would need to agree.
 * Introducing Redis to throttle logins on a one-person photo gallery would cost
 * far more operationally than it buys.
 *
 * The trade-off is that limits reset on restart. That's acceptable for
 * throttling guesses, and the alternative — writing every failed attempt to
 * SQLite — turns a cheap check into a disk write an attacker controls.
 */

interface Bucket {
	/** Attempts consumed in the current window. */
	count: number;
	/** Epoch ms at which the window resets. */
	resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Reclaims expired buckets. Without this, a flood of one-off keys (a distributed
 * guessing attempt cycling IPs) would grow the map without bound.
 */
function sweep(now: number): void {
	for (const [key, bucket] of buckets) {
		if (bucket.resetAt <= now) buckets.delete(key);
	}
}

let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

export interface RateLimitResult {
	allowed: boolean;
	/** Attempts left in this window. */
	remaining: number;
	/** Seconds until the window resets — suitable for a `Retry-After` header. */
	retryAfterSeconds: number;
}

/**
 * Consumes one attempt against `key`.
 *
 * @param key    Identity of the caller *and* the action, e.g. `login:1.2.3.4`.
 *               Always include the action so a throttled login doesn't also
 *               block an unrelated endpoint.
 * @param limit  Attempts permitted per window.
 * @param windowMs Window length in milliseconds.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
	const now = Date.now();

	if (now - lastSweep > SWEEP_INTERVAL_MS) {
		sweep(now);
		lastSweep = now;
	}

	const existing = buckets.get(key);

	if (!existing || existing.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
	}

	existing.count++;
	const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

	if (existing.count > limit) {
		return { allowed: false, remaining: 0, retryAfterSeconds };
	}

	return { allowed: true, remaining: limit - existing.count, retryAfterSeconds };
}

/** Clears an entry — call after a *successful* login so one typo doesn't linger. */
export function resetRateLimit(key: string): void {
	buckets.delete(key);
}

/** Test seam. */
export function clearAllRateLimits(): void {
	buckets.clear();
	lastSweep = 0;
}

/** Tuned limits for the endpoints that need them. */
export const LIMITS = {
	/** Password guessing against the admin account. */
	login: { limit: 10, windowMs: 15 * 60 * 1000 },
	/** Guessing a collection's share password. */
	unlock: { limit: 20, windowMs: 15 * 60 * 1000 },
	/** ZIP builds are I/O heavy; keep one client from queueing many at once. */
	zip: { limit: 5, windowMs: 60 * 1000 }
} as const;
