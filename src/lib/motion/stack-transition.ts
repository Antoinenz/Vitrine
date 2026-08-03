import { gsap, Flip, prefersReducedMotion, MOTION } from './gsap';
import { getStackHandle } from './stack-hover';

/**
 * The stack → grid page transition.
 *
 * ## Why ghosts
 *
 * The obvious approach — capture Flip state on the artist page, navigate, then
 * `Flip.from()` on the collection page — breaks in three separate ways:
 *
 * 1. **The source elements stop existing.** SvelteKit tears down the old page's
 *    DOM on navigation, so by the time we could play the animation, the things
 *    Flip recorded are gone.
 * 2. **Scroll resets.** Flip records viewport-relative rectangles. A stack
 *    measured at y=900 while scrolled down animates from the wrong place once
 *    navigation returns the page to the top.
 * 3. **Flip has no 3D support.** The stacks tilt in 3D under the cursor, and
 *    that tilt is live at the moment of the click.
 *
 * So instead of animating the real elements, we clone them into a
 * `position: fixed` overlay attached to `<body>`. The clones are outside the
 * page being destroyed and live in viewport coordinates, which makes both the
 * teardown and the scroll reset irrelevant. Problem 3 is handled by flattening
 * the tilt before measuring.
 *
 * The overlay is torn down on a timer no matter what, so a slow or failed image
 * can never leave a visitor staring at frozen ghosts.
 */

const LAYER_ID = 'vitrine-ghost-layer';

/**
 * Attribute marking a grid figure as an animation target.
 *
 * Deliberately **not** `data-flip-id`: that attribute is GSAP Flip's own
 * identification mechanism, and Flip stamps it onto any element it operates on.
 * Using the same name meant the ghosts were silently tagged as targets too, so
 * `[data-flip-id]` matched both the grid and the overlay.
 */
const TARGET_ATTR = '[data-photo]';

/** Ghosts older than this are stale — a slow navigation, or a back button. */
const MAX_AGE_MS = 2500;

/** Released even if images never decode, so the page is never stuck. */
const DECODE_TIMEOUT_MS = 400;

interface Ghost {
	el: HTMLElement;
	rect: DOMRect;
}

interface PendingTransition {
	collectionId: string;
	ghosts: Ghost[];
	layer: HTMLElement;
	at: number;
}

let pending: PendingTransition | null = null;

function removeLayer() {
	pending?.layer.remove();
	document.getElementById(LAYER_ID)?.remove();
	pending = null;
}

/**
 * Clones the stack's layers into a fixed overlay, pinned exactly where they
 * appear right now. Call from the link's click handler, before navigating.
 */
export function captureStack(stackEl: HTMLElement, collectionId: string): void {
	if (prefersReducedMotion()) return;

	// A previous transition that never completed — a rapid second click, or a
	// navigation that failed. Drop it rather than stacking overlays.
	removeLayer();

	/**
	 * Flatten the 3D tilt *before* measuring. Flip (and our own rect maths) work
	 * in 2D, so a stack captured mid-rotation reports a skewed box and the
	 * photos would fly in from the wrong place. This is synchronous, so the
	 * `getBoundingClientRect` calls below see the flat geometry.
	 */
	getStackHandle(stackEl)?.resetTilt();

	const layers = Array.from(stackEl.querySelectorAll<HTMLElement>('.layer'));
	if (layers.length === 0) return;

	const layer = document.createElement('div');
	layer.id = LAYER_ID;
	Object.assign(layer.style, {
		position: 'fixed',
		inset: '0',
		zIndex: '9999',
		pointerEvents: 'none',
		// The clones are decoration; the real grid underneath carries the content.
		contain: 'strict'
	});

	const ghosts: Ghost[] = [];

	for (const source of layers) {
		const rect = source.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) continue;

		const clone = source.cloneNode(true) as HTMLElement;
		Object.assign(clone.style, {
			position: 'fixed',
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
			margin: '0',
			// The stack fans its layers with a transform; the clone is already
			// positioned where that transform put it, so applying it again would
			// double the offset.
			transform: 'none',
			transition: 'none'
		});
		clone.setAttribute('aria-hidden', 'true');

		layer.appendChild(clone);
		ghosts.push({ el: clone, rect });
	}

	if (ghosts.length === 0) return;

	document.body.appendChild(layer);
	pending = { collectionId, ghosts, layer, at: Date.now() };
}

/** Resolves once the image has pixels, or when the timeout runs out. */
function whenDecoded(el: HTMLElement, timeoutMs: number): Promise<void> {
	const img = el.querySelector('img');
	if (!img) return Promise.resolve();
	if (img.complete && img.naturalWidth > 0) return Promise.resolve();

	return Promise.race([
		img.decode().catch(() => undefined),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
	]).then(() => undefined);
}

/**
 * Flies the ghosts onto their counterparts in the grid, then hands over.
 *
 * Call from the collection page once the grid is in the DOM. Returns `false`
 * when there was nothing to animate — a direct link, a reload, or reduced
 * motion — so the caller can fall back to revealing the grid plainly.
 */
export async function playIntoGrid(gridEl: HTMLElement, collectionId: string): Promise<boolean> {
	const state = pending;

	// Nothing captured, a different collection (browser back into a stale
	// overlay), or too long ago to still be believable.
	if (!state || state.collectionId !== collectionId || Date.now() - state.at > MAX_AGE_MS) {
		removeLayer();
		return false;
	}

	pending = null;

	const targets = Array.from(gridEl.querySelectorAll<HTMLElement>(TARGET_ATTR)).slice(
		0,
		state.ghosts.length
	);

	if (targets.length === 0) {
		state.layer.remove();
		return false;
	}

	const pairs = state.ghosts.slice(0, targets.length).map((ghost, i) => ({
		ghost,
		target: targets[i]
	}));

	/**
	 * The grid stays invisible until the ghosts land on it, otherwise both copies
	 * of every photo are on screen at once and the effect reads as a duplicate
	 * rather than a movement.
	 */
	gsap.set(targets, { opacity: 0 });
	// Everything past the animated run simply fades up.
	const rest = Array.from(gridEl.querySelectorAll<HTMLElement>(TARGET_ATTR)).slice(targets.length);
	gsap.set(rest, { opacity: 0 });

	// Wait for the destination images before moving, so the ghosts don't land on
	// empty boxes. The stack and the grid request the same derivative URLs, so
	// these are usually already in cache and this resolves immediately.
	await Promise.all(pairs.map(({ target }) => whenDecoded(target, DECODE_TIMEOUT_MS)));

	const timeline = gsap.timeline({
		onComplete: () => state.layer.remove()
	});

	for (const { ghost, target } of pairs) {
		/**
		 * `Flip.fit` computes the transform that makes one element occupy
		 * another's box. Because the ghost is `position: fixed`, the target's
		 * viewport rectangle is exactly the right frame of reference, so no
		 * scroll compensation is needed.
		 */
		const tween = Flip.fit(ghost.el, target, {
			duration: MOTION.transition,
			ease: MOTION.easeInOut,
			scale: true,
			absolute: true
		});
		if (tween) timeline.add(tween as gsap.core.Tween, 0);
	}

	// The real photo appears underneath just before its ghost dissolves, so
	// there's never a frame showing neither.
	timeline.to(targets, { opacity: 1, duration: 0.2 }, MOTION.transition * 0.65);
	timeline.to(
		state.ghosts.map((g) => g.el),
		{ opacity: 0, duration: 0.18 },
		MOTION.transition * 0.8
	);
	timeline.to(rest, { opacity: 1, duration: 0.35, stagger: 0.03 }, MOTION.transition * 0.55);

	await timeline.then();
	return true;
}

/** Reveals a grid that arrived without a transition — a direct link or a reload. */
export function revealGrid(gridEl: HTMLElement): void {
	const figures = Array.from(gridEl.querySelectorAll<HTMLElement>(TARGET_ATTR));
	if (figures.length === 0) return;

	if (prefersReducedMotion()) {
		gsap.set(figures, { opacity: 1, y: 0 });
		return;
	}

	gsap.fromTo(
		figures,
		{ opacity: 0, y: 12 },
		{ opacity: 1, y: 0, duration: 0.5, ease: MOTION.ease, stagger: 0.04 }
	);
}

/** Drops any captured state, e.g. when a navigation is cancelled. */
export function cancelTransition(): void {
	removeLayer();
}
