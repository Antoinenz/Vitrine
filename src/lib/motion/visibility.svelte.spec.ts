import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isPageActive, onPageActive } from './visibility';

/**
 * Runs in a real Chromium instance, not jsdom — the `client` project in
 * `vite.config.ts`. `document.hidden` and `visibilitychange` are the browser's,
 * so what is being checked is the wiring rather than a reimplementation of it.
 *
 * The visibility *state* still has to be faked: Playwright can background a tab
 * only by opening another, which a unit test has no business doing. Shadowing
 * the getter and dispatching the real event exercises every line the browser
 * would, and the module reads `document.hidden` inside the handler rather than
 * caching it, which is what makes that substitution honest.
 */
function setHidden(hidden: boolean) {
	Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
	document.dispatchEvent(new Event('visibilitychange'));
}

/** Long enough to cover two animation frames plus the settle delay. */
const AFTER_SETTLE_MS = 700;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the module to actually reach its resting state.
 *
 * Originally a fixed sleep, which passed alone and failed in the full suite:
 * the settle is two animation frames plus a timer, and under a machine running
 * both test projects at once that took longer than the sleep allowed. The next
 * test then either subscribed while still inactive or had the late timer fire
 * underneath it. Polling the condition removes the guess.
 */
async function settle() {
	for (let i = 0; i < 100; i++) {
		if (isPageActive()) return;
		await wait(20);
	}
	throw new Error('page never settled back to active');
}

beforeEach(async () => {
	Reflect.deleteProperty(document, 'hidden');
	document.dispatchEvent(new Event('visibilitychange'));
	await settle();
});

afterEach(async () => {
	// Hand `hidden` back to the browser, so a pending settle timer from one test
	// cannot resolve inside the next.
	Reflect.deleteProperty(document, 'hidden');
	document.dispatchEvent(new Event('visibilitychange'));
	await settle();
});

describe('page visibility', () => {
	it('is active while the page is visible', () => {
		expect(isPageActive()).toBe(true);
	});

	it('calls a new subscriber immediately with the current answer', () => {
		const seen: boolean[] = [];
		const stop = onPageActive((v) => seen.push(v));
		stop();

		expect(seen).toEqual([true]);
	});

	it('goes inactive as soon as the page is hidden', () => {
		const seen: boolean[] = [];
		const stop = onPageActive((v) => seen.push(v));

		setHidden(true);
		stop();

		// Immediately, with no frame in between: a hidden page shows nothing, so
		// there is nothing to be gained by animating one more time.
		expect(seen).toEqual([true, false]);
		expect(isPageActive()).toBe(false);
	});

	it('does not become active again the instant the page returns', async () => {
		setHidden(true);
		setHidden(false);

		// This is the whole point of the module. The browser is rebuilding layers
		// and decoding images in these first frames, and joining in is what the
		// stutter on return was.
		expect(isPageActive()).toBe(false);

		await wait(AFTER_SETTLE_MS);
		expect(isPageActive()).toBe(true);
	});

	it('stays inactive when the page is hidden again before it settles', async () => {
		setHidden(true);
		setHidden(false);
		setHidden(true);

		await wait(AFTER_SETTLE_MS);

		// The pending settle from the middle call must not fire underneath the
		// hide that followed it, or a backgrounded tab quietly resumes animating.
		expect(isPageActive()).toBe(false);
	});

	it('stops notifying an unsubscribed listener', async () => {
		const seen: boolean[] = [];
		const stop = onPageActive((v) => seen.push(v));
		stop();

		setHidden(true);
		setHidden(false);
		await wait(AFTER_SETTLE_MS);

		expect(seen).toEqual([true]);
	});
});
