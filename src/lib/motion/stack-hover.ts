import { gsap, canHover, prefersReducedMotion, MOTION } from './gsap';

/**
 * Cursor-tracked 3D tilt and magnet for a collection stack.
 *
 * ## Transform ownership
 *
 * Three elements, three owners, so CSS and GSAP never write the same property:
 *
 * - `.stack` — GSAP only: the 3D tilt (rotationX/Y).
 * - `.layer` — CSS only: the static fan offset and rotation, plus the hover
 *   spread. Untouched by JS, so the stacks still fan without JavaScript.
 * - `.card`  — GSAP only: the magnet offset and depth.
 *
 * Sharing an element between the two would mean CSS transitions and GSAP tweens
 * both writing `transform`, which produces flicker that is very hard to trace.
 */

/** Maximum tilt at the far edge of the stack, in degrees. */
const MAX_ROTATE_Y = 10;
const MAX_ROTATE_X = 8;

/** How far the top card slides toward the cursor, in pixels. */
const MAGNET_STRENGTH = 26;

/** How far apart the cards sit along Z when the stack lifts. */
const LAYER_DEPTH = 16;

export interface StackHoverHandle {
	/**
	 * Snaps tilt, magnet and depth back to rest, immediately and synchronously.
	 *
	 * GSAP's Flip plugin has no 3D support, so a stack captured mid-tilt measures
	 * a skewed box and the photographs fly in from the wrong place. The click
	 * handler calls this before measuring; because it uses `set` rather than a
	 * tween, the very next `getBoundingClientRect` sees flat geometry.
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
	// mid-tilt after the finger lifts. The CSS spread alone is the right feedback.
	if (!canHover() || prefersReducedMotion()) {
		return { destroy() {} };
	}

	const cards = Array.from(node.querySelectorAll<HTMLElement>('.card'));
	if (cards.length === 0) return { destroy() {} };

	const last = Math.max(1, cards.length - 1);

	/**
	 * How strongly each card follows the cursor: 1 at the top of the stack,
	 * falling to 0 at the bottom. The lower cards staying put is what makes the
	 * stack read as a pile of physical prints rather than one rigid object.
	 */
	const pull = cards.map((_, i) => 1 - i / last);

	/**
	 * `quickTo` reuses one tween per property instead of allocating on every
	 * pointer event — at pointer rates that is the difference between a smooth
	 * follow and visible stutter.
	 */
	const rotateY = gsap.quickTo(node, 'rotationY', { duration: MOTION.hover, ease: MOTION.ease });
	const rotateX = gsap.quickTo(node, 'rotationX', { duration: MOTION.hover, ease: MOTION.ease });

	const cardX = cards.map((c) => gsap.quickTo(c, 'x', { duration: 0.55, ease: MOTION.ease }));
	const cardY = cards.map((c) => gsap.quickTo(c, 'y', { duration: 0.55, ease: MOTION.ease }));
	const cardZ = cards.map((c) =>
		gsap.quickTo(c, 'z', { duration: MOTION.hover, ease: MOTION.ease })
	);

	gsap.set(node, { transformPerspective: 900, transformStyle: 'preserve-3d' });

	function onMove(event: PointerEvent) {
		const rect = node.getBoundingClientRect();
		// -0.5 … 0.5, relative to the centre of the stack.
		const px = (event.clientX - rect.left) / rect.width - 0.5;
		const py = (event.clientY - rect.top) / rect.height - 0.5;

		rotateY(px * MAX_ROTATE_Y * 2);
		// Inverted, so pushing the pointer up tips the top of the stack away.
		rotateX(-py * MAX_ROTATE_X * 2);

		for (let i = 0; i < cards.length; i++) {
			cardX[i](px * MAGNET_STRENGTH * pull[i]);
			cardY[i](py * MAGNET_STRENGTH * pull[i]);
		}
	}

	function onEnter() {
		/**
		 * The *top* card lifts furthest forward, not the bottom one.
		 *
		 * Under `preserve-3d` the browser paints by 3D position, which overrides
		 * `z-index` entirely. Lifting by ascending index therefore dragged the
		 * bottom photograph in front of the stack on hover and dropped it back on
		 * leave — a very visible reordering bug.
		 */
		cardZ.forEach((to, i) => to((cards.length - 1 - i) * LAYER_DEPTH));
	}

	function onLeave() {
		rotateY(0);
		rotateX(0);
		for (let i = 0; i < cards.length; i++) {
			cardX[i](0);
			cardY[i](0);
			cardZ[i](0);
		}
	}

	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerenter', onEnter);
	node.addEventListener('pointerleave', onLeave);

	const handle: StackHoverHandle = {
		resetTilt() {
			gsap.set(node, { rotationX: 0, rotationY: 0 });
			gsap.set(cards, { x: 0, y: 0, z: 0 });
		},
		destroy() {
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerenter', onEnter);
			node.removeEventListener('pointerleave', onLeave);
			gsap.killTweensOf([node, ...cards]);
			handles.delete(node);
		}
	};

	handles.set(node, handle);
	return handle;
}
