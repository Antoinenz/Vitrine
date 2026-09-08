import { browser } from '$app/environment';

/**
 * When ambient motion is allowed to run.
 *
 * ## The problem this exists for
 *
 * A backgrounded tab is not simply a paused one. Chrome stops calling
 * `requestAnimationFrame`, and — for a tab it considers expensive — releases the
 * rasterised tiles and decoded images backing it. Coming back is therefore not a
 * resume but a rebuild: every promoted layer has to be rastered again and every
 * photograph decoded again, which on a page of stacked prints is a great deal of
 * work crammed into the first few hundred milliseconds after the tab reappears.
 *
 * That rebuild is what the stutter on return actually is. Animating *through* it
 * makes it worse twice over: the ambient sway asks the compositor for new frames
 * while it is still rebuilding the old ones, and those frames are the ones a
 * visitor is looking straight at, so every dropped one is visible.
 *
 * So motion stops when the page is hidden — no frames are shown, so none are
 * worth computing — and does not start again the instant it returns. It waits
 * for the page to be drawn once, and then a beat longer, and only then resumes.
 * The delay costs nothing: a stack that begins swaying a third of a second after
 * you look at it is indistinguishable from one that was always swaying, whereas
 * one that stutters for five seconds is not.
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
