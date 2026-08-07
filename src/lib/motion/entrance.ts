import { slide } from 'svelte/transition';
import { quartOut } from 'svelte/easing';
import { gsap, prefersReducedMotion, MOTION } from './gsap';

/**
 * Entrance motion for the furniture around the photographs.
 *
 * The photographs already move — they tilt under the cursor, and they fly from
 * stack to grid. Everything else on the page simply exists: the artist's name,
 * the collection title, the panel in the viewer. The result is a page where the
 * important thing arrives and the frame around it was somehow always there,
 * which reads as unfinished rather than calm.
 *
 * This is deliberately smaller than anything in `stack-transition`. It is
 * supporting motion: it should be over before it draws attention to itself, and
 * it must never compete with a photograph in flight.
 */

/** Travel, in pixels. Enough to read as movement, not enough to be a slide. */
const RISE = 10;

export interface EntranceOptions {
	/**
	 * Direct children to stagger, as a selector. Given one, the element's own
	 * children animate in sequence instead of the element moving as a block —
	 * which is what makes a heading and its subtitle feel typeset rather than
	 * pasted on.
	 */
	stagger?: string;
	/** Seconds to wait before starting. */
	delay?: number;
}

/**
 * Fades and lifts an element into place, once.
 *
 * Written as a Svelte attachment (`{@attach entrance()}`) so it runs on mount
 * and cleans itself up, matching how `returnTransition` is applied on the
 * artist page.
 *
 * Reduced motion is honoured by doing nothing at all rather than by playing a
 * shorter version: the element is already in its final position in the markup,
 * so skipping the tween leaves exactly the right page. That also means the
 * content is never hidden by a stylesheet waiting for JavaScript to reveal it —
 * with JS off, or if this module fails to load, the header is simply there.
 */
export function entrance(options: EntranceOptions = {}) {
	return (node: Element) => {
		if (prefersReducedMotion()) return;

		const targets = options.stagger
			? Array.from(node.querySelectorAll<HTMLElement>(options.stagger))
			: [node as HTMLElement];

		if (targets.length === 0) return;

		const tween = gsap.from(targets, {
			opacity: 0,
			y: RISE,
			duration: MOTION.hover,
			ease: MOTION.ease,
			delay: options.delay ?? 0,
			stagger: options.stagger ? 0.05 : 0,
			/**
			 * `gsap.from` leaves an inline transform behind, which would sit on the
			 * element for the life of the page and beat any CSS that tries to
			 * position it later. Clearing on completion hands the element back to
			 * the stylesheet.
			 */
			clearProps: 'opacity,transform'
		});

		return () => {
			// Killing rather than completing: if the element is being removed, its
			// final state no longer matters and finishing the tween would write to a
			// detached node.
			tween.kill();
		};
	};
}

/**
 * The viewer's details panel, opening and closing.
 *
 * This is the one piece of motion here that isn't GSAP, on purpose. Everything
 * else in `src/lib/motion` animates elements that stay in the DOM, which is
 * what GSAP is good at. This panel is *removed* when it closes, and animating
 * something out of existence with GSAP means keeping it mounted by hand and
 * tearing it down in a completion callback — reimplementing, badly, what
 * Svelte's outro already does. So the mechanism is Svelte's and only the timing
 * is ours.
 *
 * `quartOut` is the easing curve GSAP calls `power3.out`, so the panel moves in
 * the same language as the stacks and the grid despite the different engine.
 *
 * It slides rather than fades because the panel takes up room: appearing at
 * full height would shove the photograph upward in a single frame, which is far
 * more distracting than the panel itself.
 */
export function detailPanel(node: Element) {
	// Zero duration rather than no transition at all: Svelte still needs a
	// transition object back, and this keeps the open/close instant.
	if (prefersReducedMotion()) return { duration: 0 };

	return slide(node, { duration: MOTION.hover * 1000, easing: quartOut });
}
