import { gsap, canHover, prefersReducedMotion, MOTION } from './gsap';

/**
 * Cursor-tracked 3D tilt for a collection stack.
 *
 * Used as a Svelte action on the `.stack` element:
 *
 *     <div class="stack" use:stackHover>
 *
 * The CSS already fans the layers out on hover; this adds the parallax tilt on
 * top for pointer devices. Keeping the two separate means the stacks still
 * respond with JavaScript disabled, and it gives the transition a clean way to
 * undo *only* the 3D part before measuring (see `resetTilt`).
 */

/** Maximum rotation at the far edge of the stack, in degrees. */
const MAX_ROTATE_Y = 10;
const MAX_ROTATE_X = 8;
/** How far the layers separate along Z, multiplied by layer index. */
const LAYER_DEPTH = 14;

export interface StackHoverHandle {
	/**
	 * Snaps the tilt back to flat, immediately and synchronously.
	 *
	 * GSAP's Flip plugin does not support 3D transforms, so a stack captured
	 * mid-tilt produces wrong geometry — the photos fly in from a skewed
	 * position. The click handler calls this before measuring, which is why the
	 * tilt lives on a different element from the one Flip measures.
	 */
	resetTilt(): void;
	destroy(): void;
}

const handles = new WeakMap<HTMLElement, StackHoverHandle>();

/** Returns the handle for a stack element, if one is attached. */
export function getStackHandle(el: HTMLElement | null): StackHoverHandle | undefined {
	return el ? handles.get(el) : undefined;
}

export function stackHover(node: HTMLElement) {
	// Neither branch is worth wiring up on a touch device or under reduced
	// motion; the CSS hover state alone is the right amount of feedback.
	if (!canHover() || prefersReducedMotion()) {
		return { destroy() {} };
	}

	const layers = Array.from(node.querySelectorAll<HTMLElement>('.layer'));
	if (layers.length === 0) return { destroy() {} };

	/**
	 * `quickTo` builds one reusable tween per property instead of allocating a
	 * new tween on every mousemove. At pointer event rates that difference is the
	 * gap between a smooth tilt and visible stutter.
	 */
	const rotateY = gsap.quickTo(node, 'rotationY', { duration: MOTION.hover, ease: MOTION.ease });
	const rotateX = gsap.quickTo(node, 'rotationX', { duration: MOTION.hover, ease: MOTION.ease });

	// Each layer lifts a little further off the page than the one above it, so
	// the tilt reveals depth rather than rotating a flat sheet.
	const layerZ = layers.map((layer) =>
		gsap.quickTo(layer, 'z', { duration: MOTION.hover, ease: MOTION.ease, overwrite: 'auto' })
	);

	gsap.set(node, { transformPerspective: 900, transformStyle: 'preserve-3d' });

	function onMove(event: PointerEvent) {
		const rect = node.getBoundingClientRect();
		// -0.5 … 0.5 relative to the centre of the stack.
		const px = (event.clientX - rect.left) / rect.width - 0.5;
		const py = (event.clientY - rect.top) / rect.height - 0.5;

		rotateY(px * MAX_ROTATE_Y * 2);
		// Inverted: pushing the pointer up should tip the top of the stack away.
		rotateX(-py * MAX_ROTATE_X * 2);
	}

	function onEnter() {
		layerZ.forEach((to, i) => to(i * LAYER_DEPTH));
	}

	function onLeave() {
		rotateY(0);
		rotateX(0);
		layerZ.forEach((to) => to(0));
	}

	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerenter', onEnter);
	node.addEventListener('pointerleave', onLeave);

	const handle: StackHoverHandle = {
		resetTilt() {
			// `set`, not a tween: the measurement happens on the next line and must
			// see the flat geometry, not an in-flight interpolation.
			gsap.set(node, { rotationX: 0, rotationY: 0 });
			gsap.set(layers, { z: 0 });
		},
		destroy() {
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerenter', onEnter);
			node.removeEventListener('pointerleave', onLeave);
			gsap.killTweensOf([node, ...layers]);
			handles.delete(node);
		}
	};

	handles.set(node, handle);
	return handle;
}
