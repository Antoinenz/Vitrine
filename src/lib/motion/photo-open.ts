import { gsap, prefersReducedMotion, MOTION } from './gsap';

/**
 * The photograph's journey from the grid into the viewer.
 *
 * Opening used to be a cut: the grid vanished and a full-screen image appeared,
 * with nothing connecting the thumbnail that was clicked to the picture that
 * arrived. This carries the frame across, so the photograph you chose is
 * visibly the one you are now looking at.
 *
 * Only the opening. Closing deliberately has none of this — the page beneath is
 * already smooth-scrolling back to the photograph's place in the grid, and a
 * second animation flying toward a target that is itself still moving would
 * land in the wrong place and fight the scroll for the eye's attention.
 *
 * A captured rectangle rather than a Flip state, because the two elements live
 * in different components with different lifetimes: the grid figure is still
 * mounted, but the viewer's image does not exist until after the navigation.
 */

/** How long the captured rectangle stays usable, in milliseconds. */
const MAX_AGE_MS = 1200;

let origin: { rect: DOMRect; at: number } | null = null;

/**
 * Records where a photograph sits in the grid, just before opening it.
 *
 * The *rendered* rectangle, not the element's: a grid figure's box is its
 * layout slot, and the picture inside may be letterboxed within it.
 */
export function capturePhotoOrigin(el: HTMLElement): void {
	origin = { rect: el.getBoundingClientRect(), at: Date.now() };
}

/**
 * Takes the captured rectangle, if there is a usable one.
 *
 * Consumed on read, so a stale capture can never be replayed — reloading, or
 * opening a photograph from a shared link, must arrive plainly rather than
 * flying in from wherever the last click happened to be.
 */
function takeOrigin(): DOMRect | null {
	const captured = origin;
	origin = null;
	if (!captured) return null;
	return Date.now() - captured.at <= MAX_AGE_MS ? captured.rect : null;
}

/** Drops any capture, e.g. when a navigation is abandoned. */
export function cancelPhotoOrigin(): void {
	origin = null;
}

/**
 * Flies the viewer's image from the grid rectangle to where it has landed.
 *
 * Returns false when there was nothing to continue from, so the caller can let
 * the photograph simply appear.
 */
export function playPhotoOpen(imageEl: HTMLImageElement): boolean {
	const from = takeOrigin();
	if (!from || prefersReducedMotion()) return false;

	/**
	 * Measured against the picture as drawn, not the element.
	 *
	 * The image element fills the stage and `object-fit: contain` centres the
	 * photograph inside it, so animating between the two element boxes would
	 * shear a portrait frame across the letterbox bands rather than tracking the
	 * picture itself.
	 */
	const box = imageEl.getBoundingClientRect();
	const natural = imageEl.naturalWidth / imageEl.naturalHeight;
	if (!Number.isFinite(natural) || natural <= 0) return false;

	const fit = Math.min(box.width / imageEl.naturalWidth, box.height / imageEl.naturalHeight);
	const drawnWidth = imageEl.naturalWidth * fit;
	const drawnHeight = imageEl.naturalHeight * fit;

	const scale = Math.max(from.width / drawnWidth, from.height / drawnHeight);
	const dx = from.left + from.width / 2 - (box.left + box.width / 2);
	const dy = from.top + from.height / 2 - (box.top + box.height / 2);

	/**
	 * Suppresses the stylesheet's `transition: transform` for the duration.
	 *
	 * Without it the transition eases 180ms toward every value GSAP writes, so
	 * what renders lags far behind what is set and the arrival appears to happen
	 * twice. Two things animating one property is always a bug; here the CSS
	 * simply has to stand down while the tween owns it.
	 */
	imageEl.classList.add('flying');

	gsap.fromTo(
		imageEl,
		{ x: dx, y: dy, scale },
		{
			x: 0,
			y: 0,
			scale: 1,
			duration: MOTION.transition * 0.6,
			ease: MOTION.ease,
			/**
			 * Handed back to the stylesheet on arrival. The element's `transform` is
			 * otherwise written by Svelte for zoom and pan, and a leftover inline
			 * transform from GSAP would win over the first zoom the visitor tried.
			 */
			clearProps: 'transform',
			onComplete: () => imageEl.classList.remove('flying')
		}
	);

	return true;
}
