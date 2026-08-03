import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { browser } from '$app/environment';

/**
 * Shared GSAP setup.
 *
 * Registering the plugin once here — rather than in each module that animates —
 * avoids the "plugin not registered" failure that appears only after tree
 * shaking in a production build.
 */
if (browser) {
	gsap.registerPlugin(Flip);
}

export { gsap, Flip };

/**
 * True when the visitor has asked for reduced motion.
 *
 * Read at call time rather than cached: the setting can change while the page
 * is open, and someone who turns it on mid-session should get the calm version
 * immediately.
 */
export function prefersReducedMotion(): boolean {
	if (!browser) return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * True for input that can genuinely hover — a mouse or trackpad.
 *
 * Touch devices report a synthetic hover on tap, which would leave a stack
 * stuck mid-tilt after the finger lifts, so pointer-driven effects are gated on
 * this.
 */
export function canHover(): boolean {
	if (!browser) return false;
	return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** Motion timings, mirroring the CSS custom properties in `layout.css`. */
export const MOTION = {
	hover: 0.4,
	transition: 0.62,
	ease: 'power3.out',
	easeInOut: 'power2.inOut'
} as const;
