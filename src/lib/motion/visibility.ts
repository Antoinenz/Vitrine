import { browser } from '$app/environment';

/**
 * When ambient motion is allowed to run.
 *
 * Motion stops when the page is hidden, because no frames are being shown and
 * none are worth computing. It then waits for the page to be drawn once, and a
 * beat longer, before resuming: coming back to a tab is a rebuild rather than a
 * resume, since Chrome releases rasterised tiles and decoded images for a
 * background tab, and there is nothing to gain by animating through that.
 *
 * The delay is free. A stack that starts swaying a third of a second after you
 * look at it is indistinguishable from one that never stopped.
 *
 * ## What this is not
 *
 * This was written to fix a reported stutter of several seconds on returning to
 * a backgrounded tab. **It was not the cause and this did not fix it.** A trace
 * eventually put the six seconds after the tab returned at 4,659ms of
 * JavaScript, 197 dropped frames and 23ms of raster — and most of that
 * JavaScript belonged to a browser extension that hooks every image's `load`
 * event, running 150–300ms per photograph as the page reloaded them.
 *
 * Recorded here because the reasoning above is plausible, tidy, and was arrived
 * at twice by two different routes without either being right. It justifies the
 * code on its own terms — do not animate what nobody is looking at — and that
 * is the only claim it should be read as making. If motion feels bad again,
 * measure before believing anything in this comment.
 */

/**
 * How long to leave the browser alone after the page is shown again.
 *
 * Long enough to cover re-rastering a screen of photographs on a modest machine,
 * short enough that nobody notices the stacks were still. Two animation frames
 * are waited first, so this is measured from the point the page has actually
 * been painted rather than from the visibility event.
 */
const SETTLE_MS = 400;

type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();

/** Hidden pages start inactive, so nothing runs for a tab restored in the background. */
let active = browser ? !document.hidden : false;
let settle: ReturnType<typeof setTimeout> | null = null;

function set(next: boolean) {
	if (next === active) return;
	active = next;
	for (const listener of listeners) listener(active);
}

function onVisibilityChange() {
	if (settle !== null) {
		clearTimeout(settle);
		settle = null;
	}

	if (document.hidden) {
		set(false);
		return;
	}

	/**
	 * Two frames, then a pause.
	 *
	 * The first frame is the one the browser spends rebuilding what it discarded;
	 * asking for the second means the timer starts from a page that has genuinely
	 * been painted, not from an event that fired before any of that work began.
	 */
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			if (document.hidden) return;
			settle = setTimeout(() => set(true), SETTLE_MS);
		});
	});
}

if (browser) {
	document.addEventListener('visibilitychange', onVisibilityChange);
}

/** Whether ambient motion should be running right now. */
export function isPageActive(): boolean {
	return active;
}

/**
 * Calls `listener` whenever that answer changes, and once immediately with the
 * current one — so a caller has no separate "get the initial value" step to
 * forget. Returns an unsubscribe function.
 */
export function onPageActive(listener: Listener): () => void {
	listeners.add(listener);
	listener(active);
	return () => listeners.delete(listener);
}
