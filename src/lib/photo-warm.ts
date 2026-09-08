import { browser } from '$app/environment';
import type { PhotoView } from '$lib/server/photos';

/**
 * Fetches the images another page is about to show, before it shows them.
 *
 * ## Warming the wrong image
 *
 * There was already a warm here, and it downloaded the wrong file. It used
 * `photo.src` — the fallback, which is the *widest* rendition in the *fallback
 * format* — on the stated grounds that "the stack and the grid request identical
 * derivative URLs". They do not, and never did. A stack shows a print about
 * 320px wide and a grid shows one around 640px, so the two resolve to different
 * candidates out of the same `srcset`; measured across a collection of nine
 * photographs, the overlap was zero of nine.
 *
 * What that warm actually did, on every hover, was fetch a 1280px JPEG of
 * 100–460 kB in place of the 640px WebP of 16–116 kB the grid would display —
 * several times the bytes, of a file nothing would ever paint — and then call
 * `decode()` on it, spending main-thread time turning a picture nobody would see
 * into pixels nobody would use. On the first opening of a collection that decode
 * landed squarely on the transition it was meant to smooth.
 *
 * ## Letting the browser choose
 *
 * Rather than reconstruct which candidate the destination will pick — the rule
 * involves `sizes`, viewport width, device pixel ratio and format support, and
 * getting it wrong is exactly the bug above — this builds a real `<picture>`
 * with the destination's `sizes` and lets the browser's own selection run.
 * Format negotiation is preserved, `sizes` resolves against the viewport rather
 * than the element so a collapsed warmer picks what a full-sized one would, and
 * precisely one image per photograph is fetched: the one that will be displayed.
 */

const HOLDER_ID = 'vitrine-warm';

/**
 * One holder, reused.
 *
 * Hovering across a row of collections would otherwise leave a warmer behind for
 * each, and every one of them holds a decoded bitmap. Only the last hover is
 * worth keeping warm.
 */
function holder(): HTMLElement {
	const existing = document.getElementById(HOLDER_ID);
	if (existing) {
		existing.replaceChildren();
		return existing;
	}

	const el = document.createElement('div');
	el.id = HOLDER_ID;
	el.setAttribute('aria-hidden', 'true');
	/**
	 * Collapsed rather than `display: none`.
	 *
	 * A `display: none` image is still fetched, but zero-sized-and-clipped is the
	 * weaker claim of the two and does not depend on that staying true.
	 */
	Object.assign(el.style, {
		position: 'fixed',
		top: '0',
		left: '0',
		width: '0',
		height: '0',
		overflow: 'hidden',
		opacity: '0',
		pointerEvents: 'none'
	});
	document.body.appendChild(el);
	return el;
}

/**
 * Fetches — and decodes — each photograph at the size `sizes` describes.
 *
 * Decoded rather than merely fetched, which the previous warm had right even as
 * it warmed the wrong file: assigning `src` gets the bytes, it does not turn
 * them into pixels, and an image that has never been painted still owes a decode
 * that the browser will take on the main thread at the first frame that shows
 * it. Doing it here means it happens on hover, with nothing else going on,
 * instead of during the flight.
 */
export function warmPhotos(photos: readonly PhotoView[], sizes: string): void {
	if (!browser || photos.length === 0) return;

	const into = holder();

	for (const photo of photos) {
		const picture = document.createElement('picture');

		for (const source of photo.sources) {
			const el = document.createElement('source');
			el.type = source.type;
			el.srcset = source.srcset;
			el.sizes = sizes;
			picture.appendChild(el);
		}

		const img = document.createElement('img');
		// Reached only by a browser that matched no <source> — which is the same
		// browser that would fall back to it on the destination page.
		img.src = photo.src;
		img.alt = '';
		img.decoding = 'async';
		img.fetchPriority = 'high';
		picture.appendChild(img);

		into.appendChild(picture);
		// Nothing depends on it finishing; a failure just means no head start.
		void img.decode().catch(() => undefined);
	}
}
