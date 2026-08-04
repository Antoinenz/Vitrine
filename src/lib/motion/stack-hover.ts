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

/** Peak pull toward the cursor, in pixels, for a card directly beneath it. */
const MAGNET_STRENGTH = 34;

/**
 * Distance over which the magnet fades, as a fraction of the stack's diagonal.
 *
 * Proportional rather than a fixed pixel radius, so the effect feels the same
 * on a small stack as on a large one.
 */
const MAGNET_REACH = 1.15;

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

	const toX = cards.map((c) => gsap.quickTo(c, 'x', { duration: 0.6, ease: MOTION.ease }));
	const toY = cards.map((c) => gsap.quickTo(c, 'y', { duration: 0.6, ease: MOTION.ease }));
	const toZ = cards.map((c) => gsap.quickTo(c, 'z', { duration: MOTION.hover, ease: MOTION.ease }));

	gsap.set(node, { transformPerspective: 1100, transformStyle: 'preserve-3d' });

	/**
	 * The slow idle sway, each card at its own speed and direction, taken from
	 * CSS custom properties the server derived from the photo id so the motion is
	 * stable across reloads.
	 *
	 * Nothing else writes `rotation` any more, so it simply runs continuously —
	 * it only needs pausing before the transition measures the stack.
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

	function onMove(event: PointerEvent) {
		const rect = node.getBoundingClientRect();
		// -0.5 … 0.5 relative to the centre of the stack.
		const px = (event.clientX - rect.left) / rect.width - 0.5;
		const py = (event.clientY - rect.top) / rect.height - 0.5;

		tiltY(px * MAX_TILT_Y * 2);
		// Inverted, so pushing the pointer up tips the top of the stack away.
		tiltX(-py * MAX_TILT_X * 2);

		const reach = Math.hypot(rect.width, rect.height) * MAGNET_REACH * 0.5;

		for (let i = 0; i < cards.length; i++) {
			const card = cards[i].getBoundingClientRect();
			const dx = event.clientX - (card.left + card.width / 2);
			const dy = event.clientY - (card.top + card.height / 2);
			const distance = Math.hypot(dx, dy);

			/**
			 * Pull rises as the cursor nears the card rather than being a flat
			 * function of position, so a print reaches toward the pointer when it
			 * comes close and settles again as it moves away. Squared, so the
			 * approach is felt rather than merely linear.
			 */
			const nearness = Math.max(0, 1 - distance / reach);
			const force = MAGNET_STRENGTH * nearness * nearness * pull[i];
			const unit = distance || 1;

			toX[i]((dx / unit) * force);
			toY[i]((dy / unit) * force);
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
			for (const drift of drifts) drift.pause();
			gsap.set(node, { rotationX: 0, rotationY: 0 });
			gsap.set(cards, { x: 0, y: 0, z: 0, rotation: 0 });
		},
		destroy() {
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerenter', onEnter);
			node.removeEventListener('pointerleave', onLeave);
			for (const drift of drifts) drift.kill();
			gsap.killTweensOf([node, ...cards]);
			handles.delete(node);
		}
	};

	handles.set(node, handle);
	return handle;
}
