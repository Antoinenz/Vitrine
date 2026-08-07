import { gsap, canHover, prefersReducedMotion, MOTION } from './gsap';

/**
 * Cursor-driven motion for a collection stack.
 *
 * ## Transform ownership
 *
 * Three elements, three owners, so CSS and GSAP never write the same property:
 *
 * - `.stack` — GSAP only: the 3D tilt.
 * - `.layer` — CSS only: the resting scatter and the hover spread. Untouched by
 *   JS, so the stacks still fan without JavaScript.
 * - `.card`  — GSAP only: magnet offset, depth, and the idle sway.
 *
 * ## Depth falloff
 *
 * Every effect is scaled by `pull[i]`, which runs from 1 at the top of the pile
 * to 0 at the bottom. The top print reacts fully, each one below it less, and
 * the last barely at all — that difference is what makes the stack read as
 * loose sheets rather than one rigid object.
 */

/** Tilt of the whole stack at its far edge, in degrees. Deliberately gentle. */
const MAX_TILT_Y = 5;
const MAX_TILT_X = 4;

/**
 * Magnet travel as a fraction of the stack's own size.
 *
 * Following GSAP's magnetic-button demo, the offset is a straight mapping of
 * where the cursor is within the stack rather than a force computed from
 * distance: at the left edge the cards sit `-STRENGTH * width / 2` across, at
 * the right edge the same amount the other way, and linearly between. A
 * mapping has no state and no feedback, so the same cursor position always
 * produces the same arrangement — the previous distance-based version could
 * settle differently depending on which way the pointer had come in.
 */
const MAGNET_STRENGTH = 0.16;

/** Separation along Z when the pile lifts. */
const LAYER_DEPTH = 14;

export interface StackHoverHandle {
	/**
	 * Snaps tilt, magnet, sway and depth back to rest, synchronously.
	 *
	 * GSAP's Flip plugin has no 3D support, so a stack captured mid-tilt measures
	 * a skewed box and its photographs fly in from the wrong place. The click
	 * handler calls this before measuring; using `set` rather than a tween means
	 * the very next `getBoundingClientRect` sees flat geometry.
	 */
	resetTilt(): void;
	destroy(): void;
}

const handles = new WeakMap<HTMLElement, StackHoverHandle>();

export function getStackHandle(el: HTMLElement | null): StackHoverHandle | undefined {
	return el ? handles.get(el) : undefined;
}

export function stackHover(node: HTMLElement) {
	// On touch, hover is synthesised by a tap and would leave the stack stuck
	// mid-effect after the finger lifts. The CSS spread alone is right there.
	if (!canHover() || prefersReducedMotion()) {
		return { destroy() {} };
	}

	const cards = Array.from(node.querySelectorAll<HTMLElement>('.card'));
	if (cards.length === 0) return { destroy() {} };

	const last = Math.max(1, cards.length - 1);

	/**
	 * Influence per card: 1 at the top, easing to 0 at the bottom.
	 *
	 * Squared rather than linear so the falloff is weighted toward the top of the
	 * pile — the second print still feels clearly attached to the cursor, while
	 * the bottom one is very nearly inert.
	 */
	const pull = cards.map((_, i) => (1 - i / last) ** 2);

	/**
	 * `quickTo` reuses one tween per property instead of allocating on every
	 * pointer event — at pointer rates that is the difference between smooth
	 * motion and visible stutter.
	 */
	const tiltY = gsap.quickTo(node, 'rotationY', { duration: MOTION.hover, ease: MOTION.ease });
	const tiltX = gsap.quickTo(node, 'rotationX', { duration: MOTION.hover, ease: MOTION.ease });

	/**
	 * `overwrite: 'auto'` rather than the demo's `true`.
	 *
	 * `true` kills *every* tween on the target, which here would include the idle
	 * sway below — the pile would freeze the moment the pointer entered. `'auto'`
	 * kills only tweens competing for the same properties, so `x`/`y` are taken
	 * over cleanly while `rotation` keeps running.
	 */
	const toX = cards.map((c) =>
		gsap.quickTo(c, 'x', { duration: 0.4, ease: 'power2.out', overwrite: 'auto' })
	);
	const toY = cards.map((c) =>
		gsap.quickTo(c, 'y', { duration: 0.4, ease: 'power2.out', overwrite: 'auto' })
	);
	const toZ = cards.map((c) => gsap.quickTo(c, 'z', { duration: MOTION.hover, ease: MOTION.ease }));

	gsap.set(node, { transformPerspective: 1100, transformStyle: 'preserve-3d' });

	/**
	 * The slow idle sway, each card at its own speed and direction, taken from
	 * CSS custom properties the server derived from the photo id so the motion is
	 * stable across reloads.
	 *
	 * Nothing else writes `rotation`, so these run on their own; what they need
	 * is to *stop* when there is no reason to run. See `syncDrift` below.
	 */
	const drifts = cards.map((card) => {
		const style = getComputedStyle(card.parentElement ?? card);
		const seconds = parseFloat(style.getPropertyValue('--drift')) || 11;
		const direction = parseFloat(style.getPropertyValue('--drift-dir')) || 1;

		return gsap.to(card, {
			rotation: 1.1 * direction,
			duration: seconds,
			ease: 'sine.inOut',
			repeat: -1,
			yoyo: true
		});
	});

	/**
	 * The sway only runs when the stack is on screen and nothing has suspended it.
	 *
	 * Every card of every stack was tweening `rotation` forever, whether or not
	 * it was anywhere near the viewport. On an artist page with a dozen
	 * collections that is around fifty infinite tweens writing transforms on
	 * every frame — enough continuous main-thread and compositor work to show up
	 * as stutter in anything else that animates, including the stack→grid
	 * transition it is meant to complement.
	 *
	 * Two independent reasons to stop, tracked separately so neither can undo the
	 * other: scrolled out of view, and suspended for a measurement.
	 */
	let onScreen = false;
	let suspended = false;

	function syncDrift() {
		const shouldRun = onScreen && !suspended;
		for (const drift of drifts) {
			if (shouldRun) drift.resume();
			else drift.pause();
		}
	}

	// Starts paused: `observe` fires immediately with the real answer, so a stack
	// below the fold never runs even for a frame.
	for (const drift of drifts) drift.pause();

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				onScreen = entry.isIntersecting;
			}
			syncDrift();
		},
		// A generous margin, so a stack is already swaying by the time it is
		// actually looked at rather than starting the moment it appears.
		{ rootMargin: '200px' }
	);
	observer.observe(node);

	function onMove(event: PointerEvent) {
		const rect = node.getBoundingClientRect();

		/**
		 * The cursor's offset from the centre of the stack, in pixels.
		 *
		 * `mapRange` is the mapping used in GSAP's magnetic-button demo: the left
		 * edge of the zone maps to `-width / 2`, the right edge to `+width / 2`.
		 * It reads the pointer and nothing else, so there is no state to drift.
		 */
		const dx = gsap.utils.mapRange(
			rect.left,
			rect.right,
			-rect.width / 2,
			rect.width / 2,
			event.clientX
		);
		const dy = gsap.utils.mapRange(
			rect.top,
			rect.bottom,
			-rect.height / 2,
			rect.height / 2,
			event.clientY
		);

		/**
		 * The stack leans *toward* the cursor: the edge under the pointer rises
		 * to meet it and the far edge drops away.
		 *
		 * Both CSS rotations are positive away from the viewer — `rotateY` swings
		 * the right edge back, `rotateX` swings the top edge back — so lifting the
		 * near edge means negating both. Tilting the other way put the surface in
		 * opposition to the magnet, the pile sinking under the cursor while the
		 * prints reached out to it, which is what read as an inverted axis.
		 */
		tiltY((-dx / rect.width) * MAX_TILT_Y * 2);
		tiltX((dy / rect.height) * MAX_TILT_X * 2);

		for (let i = 0; i < cards.length; i++) {
			toX[i](dx * MAGNET_STRENGTH * pull[i]);
			toY[i](dy * MAGNET_STRENGTH * pull[i]);
		}
	}

	function onEnter() {
		/**
		 * The *top* card lifts furthest forward. Under `preserve-3d` the browser
		 * paints by 3D position and ignores `z-index`, so lifting by ascending
		 * index would drag the bottom photograph in front of the pile.
		 */
		toZ.forEach((to, i) => to((cards.length - 1 - i) * LAYER_DEPTH));
	}

	function onLeave() {
		tiltY(0);
		tiltX(0);
		for (let i = 0; i < cards.length; i++) {
			toX[i](0);
			toY[i](0);
			toZ[i](0);
		}
	}

	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerenter', onEnter);
	node.addEventListener('pointerleave', onLeave);

	const handle: StackHoverHandle = {
		resetTilt() {
			// Suspended rather than merely paused: the stack is about to be
			// measured for the transition, and an intersection callback arriving
			// mid-measurement must not start it swaying again.
			suspended = true;
			syncDrift();
			gsap.set(node, { rotationX: 0, rotationY: 0 });
			gsap.set(cards, { x: 0, y: 0, z: 0, rotation: 0 });
		},
		destroy() {
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerenter', onEnter);
			node.removeEventListener('pointerleave', onLeave);
			observer.disconnect();
			for (const drift of drifts) drift.kill();
			gsap.killTweensOf([node, ...cards]);
			handles.delete(node);
		}
	};

	handles.set(node, handle);
	return handle;
}
