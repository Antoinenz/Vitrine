import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { setSessionCookie, SESSION_COOKIE } from './auth';

/**
 * The session cookie, and the clocks it has to survive.
 *
 * Two bugs in this file's history were invisible to every server-side test: a
 * `Secure` flag over plain HTTP, and an absolute `Expires` written by a server
 * whose clock had drifted. Both produce a *successful* login — the server sets
 * a cookie, returns a redirect, and logs nothing — that the browser then throws
 * away, leaving the artist staring at the sign-in form. So these assert the
 * attributes actually handed to the browser, which is where the failure lives.
 */
function fakeEvent(url: string): {
	event: RequestEvent;
	captured: () => { value: string; opts: Record<string, unknown> };
} {
	let seen: { value: string; opts: Record<string, unknown> } | null = null;
	const event = {
		url: new URL(url),
		cookies: {
			set(name: string, value: string, opts: Record<string, unknown>) {
				if (name === SESSION_COOKIE) seen = { value, opts };
			}
		}
	} as unknown as RequestEvent;
	return {
		event,
		captured: () => {
			if (!seen) throw new Error('no session cookie was set');
			return seen;
		}
	};
}

afterEach(() => vi.useRealTimers());

describe('setSessionCookie', () => {
	/**
	 * The regression that prompted this file.
	 *
	 * A server clock reading a month behind the browser's would emit
	 * `Expires` a month in the browser's past for a 30-day session. The browser
	 * discards an already-expired cookie immediately, so sign-in silently loops
	 * back to the form. A duration cannot express that mistake: it is measured
	 * from the moment the response arrives.
	 */
	it('expresses lifetime as a duration, so a wrong server clock cannot kill it', () => {
		const { event, captured } = fakeEvent('http://gallery.local/login');
		const thirtyDays = 30 * 24 * 60 * 60 * 1000;

		setSessionCookie(event, 'tok', new Date(Date.now() + thirtyDays));

		const { opts } = captured();
		expect(opts.maxAge).toBeCloseTo(thirtyDays / 1000, -1);
		// An absolute date would reintroduce the dependence on the browser's clock.
		expect(opts.expires).toBeUndefined();
	});

	/**
	 * The lifetime is a difference between two readings of one clock, so it must
	 * come out right even when that clock is absurdly wrong — which is the whole
	 * point of preferring a duration.
	 */
	it('sends the right lifetime even when the server clock is a month out', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));

		const { event, captured } = fakeEvent('http://gallery.local/login');
		const sevenDays = 7 * 24 * 60 * 60 * 1000;

		setSessionCookie(event, 'tok', new Date(Date.now() + sevenDays));

		expect(captured().opts.maxAge).toBe(sevenDays / 1000);
	});

	/**
	 * A session in its last moments must still be sent as a live cookie: zero or
	 * negative is the wire encoding for "delete this", which would turn a nearly
	 * expired session into an immediate, unexplained sign-out.
	 */
	it('never emits a zero or negative lifetime for an expiry that has just lapsed', () => {
		const { event, captured } = fakeEvent('http://gallery.local/login');

		setSessionCookie(event, 'tok', new Date(Date.now() - 1000));

		expect(captured().opts.maxAge).toBeGreaterThan(0);
	});

	/**
	 * The original bug: `Secure` over plain HTTP. A self-hosted install is
	 * usually first reached at a LAN or Tailscale address over HTTP, where the
	 * browser refuses to store a `Secure` cookie.
	 */
	it('omits Secure over HTTP and sets it over HTTPS', () => {
		const plain = fakeEvent('http://antoinepi.local:5174/login');
		setSessionCookie(plain.event, 'tok', new Date(Date.now() + 1000));
		expect(plain.captured().opts.secure).toBe(false);

		const tls = fakeEvent('https://gallery.example.com/login');
		setSessionCookie(tls.event, 'tok', new Date(Date.now() + 1000));
		expect(tls.captured().opts.secure).toBe(true);
	});

	it('stays httpOnly and lax across the whole site', () => {
		const { event, captured } = fakeEvent('http://gallery.local/login');
		setSessionCookie(event, 'tok', new Date(Date.now() + 1000));

		const { opts } = captured();
		expect(opts.httpOnly).toBe(true);
		expect(opts.sameSite).toBe('lax');
		expect(opts.path).toBe('/');
	});
});
