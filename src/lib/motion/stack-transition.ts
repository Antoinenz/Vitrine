import { gsap, Flip, prefersReducedMotion, MOTION } from './gsap';
import { getStackHandle } from './stack-hover';

/**
 * The stack ⇄ grid page transition.
 *
 * ## Why ghosts
 *
 * The obvious approach — capture Flip state on one page, navigate, replay on
 * the next — breaks in three separate ways:
 *
 * 1. **The source elements stop existing.** SvelteKit tears down the outgoing
 *    page's DOM, so what Flip recorded is gone by playback.
 * 2. **Scroll resets.** Flip records viewport rectangles; navigation returns the
 *    page to the top, so anything measured while scrolled flies in from the
 *    wrong place.
 * 3. **Flip has no 3D support**, and the stacks are mid-tilt when clicked.
 *
 * Instead the source elements are cloned into a `position: fixed` overlay on
 * `<body>`. The clones outlive the page teardown and live in viewport
 * coordinates, which answers (1) and (2); the tilt is flattened before
 * measuring, which answers (3).
 *
 * The overlay is always removed when the timeline ends, and destination images
 * are awaited with a timeout, so a slow image can never strand ghosts on screen.
 */

const LAYER_ID = 'vitrine-ghost-layer';

/**
 * Attribute marking an element as a transition participant.
 *
 * Deliberately **not** `data-flip-id`: that is GSAP Flip's own identification
 * attribute, and Flip stamps it onto everything it touches, so ghosts would
 * silently tag themselves as targets.
 */
const PHOTO_ATTR = 'data-photo';

/** Ghosts older than this are stale — a slow navigation, or a stray back press. */
const MAX_AGE_MS = 2500;

/**
 * Released even if images never decode, so the page is never stuck.
 *
 * Generous enough to cover a cold decode of several large photographs on a
 * modest machine — the wait is invisible, whereas starting without them and
 * decoding mid-flight is not.
 */
const DECODE_TIMEOUT_MS = 800;

/**
 * Quick enough to feel responsive, and eased without overshoot.
 *
 * `back.out` pushed the photographs past their destination and settled back,
 * which read as a wobble against the grid they were landing in — the target is
 * a fixed rectangle, so anything that overshoots it looks like a mistake rather
 * than momentum.
 */
const DURATION = 0.5;
const ARRIVE_EASE = 'power3.out';

interface Ghost {
	el: HTMLElement;
	/** The photo this clone depicts, used to pair it with its destination. */
	photoId: string;
}

interface PendingTransition {
	collectionId: string;
	ghosts: Ghost[];
	layer: HTMLElement;
	at: number;
}

let pending: PendingTransition | null = null;

/**
 * Removes an unclaimed overlay even if nothing ever comes to collect it.
 *
 * The ghosts are only cleaned up by whoever plays them, which assumes every
 * capture is followed by a matching arrival. It isn't: navigate away again
 * before the destination mounts, click a second collection while the first is
 * still settling, or land on a page that never renders that collection's stack,
 * and nothing claims the layer. It then sits on top of everything at z-index
 * 9999 — a full grid of photographs floating over the gallery — until the next
 * transition happens to clear it.
 *
 * So a capture arms its own expiry. `claim` disarms it.
 */
let expiry: ReturnType<typeof setTimeout> | null = null;

function removeLayer() {
	if (expiry !== null) {
		clearTimeout(expiry);
		expiry = null;
	}
	pending?.layer.remove();
	document.getElementById(LAYER_ID)?.remove();
	pending = null;
}

function createLayer(): HTMLElement {
	const layer = document.createElement('div');
	layer.id = LAYER_ID;
	Object.assign(layer.style, {
		position: 'fixed',
		inset: '0',
		zIndex: '9999',
		pointerEvents: 'none'
	});
	return layer;
}

/**
 * Clones a set of elements into a fixed overlay, pinned exactly where they
 * currently appear.
 *
 * `sources` must carry `data-photo`, so each clone knows which photograph it
 * depicts and can be paired with its destination by identity rather than by
 * position — the stack leads with the collection's cover while the grid runs in
 * sort order, so pairing by index matches the wrong photographs whenever the
 * cover isn't already first.
 */
function capture(sources: HTMLElement[], collectionId: string): void {
	removeLayer();

	const layer = createLayer();
	const ghosts: Ghost[] = [];

	for (const source of sources) {
		const photoId = source.getAttribute(PHOTO_ATTR);
		if (!photoId) continue;

		/**
		 * The photograph's own frame, not its wrapper.
		 *
		 * This is what fixes portrait photographs stretching during the flight.
		 * A stack layer is a fixed, roughly 4:3 box that a card sits inside at the
		 * photograph's own ratio; a grid figure is a frame plus its caption.
		 * Fitting either wrapper to the other scales a portrait by different
		 * amounts horizontally and vertically, which squeezes the picture — and
		 * the distortion only disappeared at the end, when the ghost faded out and
		 * the correctly-shaped original showed through.
		 *
		 * Both sides carry a `.frame` of the photograph's true proportions, so
		 * fitting one to the other is a uniform scale and nothing distorts.
		 */
		const visual = source.querySelector<HTMLElement>('.frame') ?? source;

		const rect = visual.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) continue;
		// Entirely off screen — animating it would just fly in from nowhere.
		if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

		/**
		 * Rotation has to survive onto the clone.
		 *
		 * `getBoundingClientRect` returns the *axis-aligned box* of a rotated
		 * element, which is larger than the element itself. Positioning a clone
		 * with that box and no rotation makes it visibly bigger and square-on
		 * compared to the tilted card it replaces — an obvious jump at the moment
		 * of the click, and worse the more the cards are angled.
		 *
		 * So the clone is given the source's untransformed size, centred on the
		 * same point, and re-rotated by the angle extracted from the computed
		 * matrix. Flip then straightens it out as it lands in the grid.
		 */
		/**
		 * Read from the source rather than the frame: the tilt lives on the layer,
		 * and a child of a rotated parent reports no rotation of its own.
		 */
		const matrix = new DOMMatrixReadOnly(getComputedStyle(source).transform);
		const angle = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
		const width = visual.offsetWidth || rect.width;
		const height = visual.offsetHeight || rect.height;

		const clone = visual.cloneNode(true) as HTMLElement;
		Object.assign(clone.style, {
			position: 'fixed',
			left: `${rect.left + rect.width / 2 - width / 2}px`,
			top: `${rect.top + rect.height / 2 - height / 2}px`,
			width: `${width}px`,
			height: `${height}px`,
			margin: '0',
			transform: angle ? `rotate(${angle}deg)` : 'none',
			transition: 'none',
			/**
			 * The stack's own order, kept for the whole flight.
			 *
			 * Overlap only exists while the photographs are piled up, so that is the
			 * only arrangement whose order can be seen — and the pile reads
			 * first-on-top. The grid figures carry no z-index at all, so the
			 * returning flight used to assemble the pile in document order and then
			 * visibly correct itself once the real stack took over. Spread out in
			 * the grid the order cannot be seen, which is exactly where a change to
			 * it belongs.
			 */
			zIndex: String(sources.length - ghosts.length),
			/** Promoted up front, rather than on the first frame of the tween. */
			willChange: 'transform'
		});
		clone.setAttribute('aria-hidden', 'true');
		/**
		 * Strip the marker from the clone and its descendants. The ghost has
		 * already been paired via `photoId`, and leaving the attribute in place
		 * would make any `[data-photo]` query match the overlay as well as the
		 * real content — exactly the confusion `data-flip-id` caused before.
		 */
		clone.removeAttribute(PHOTO_ATTR);
		for (const nested of clone.querySelectorAll(`[${PHOTO_ATTR}]`)) {
			nested.removeAttribute(PHOTO_ATTR);
		}

		layer.appendChild(clone);
		ghosts.push({ el: clone, photoId });
	}

	if (ghosts.length === 0) return;

	document.body.appendChild(layer);
	pending = { collectionId, ghosts, layer, at: Date.now() };

	/**
	 * Comfortably longer than a normal navigation, so it never fires on a
	 * transition that was simply slow — it exists for the ones that never arrive.
	 */
	expiry = setTimeout(removeLayer, MAX_AGE_MS);
}

/**
 * Captures a collection stack. Call from the link's click handler, before
 * navigating.
 */
export function captureStack(stackEl: HTMLElement, collectionId: string): void {
	if (prefersReducedMotion()) return;

	// Flatten tilt and magnet before measuring — see `resetTilt`.
	getStackHandle(stackEl)?.resetTilt();

	capture(Array.from(stackEl.querySelectorAll<HTMLElement>(`.layer[${PHOTO_ATTR}]`)), collectionId);
}

/**
 * Captures the grid on the way back to the artist page, so the photographs
 * collapse into their stack rather than simply vanishing.
 */
export function captureGrid(gridEl: HTMLElement, collectionId: string, limit = 4): void {
	if (prefersReducedMotion()) return;

	capture(
		Array.from(gridEl.querySelectorAll<HTMLElement>(`[${PHOTO_ATTR}]`)).slice(0, limit),
		collectionId
	);
}

/** Resolves once the image has pixels, or when the timeout runs out. */
function whenDecoded(el: HTMLElement, timeoutMs: number): Promise<void> {
	const img = el.querySelector('img');
	if (!img) return Promise.resolve();

	/**
	 * `decode()` even when the image is already `complete`.
	 *
	 * Complete means the bytes arrived, not that they have been turned into
	 * pixels — an image that has never been painted still owes a decode, and the
	 * browser will take it on the main thread at the first frame that shows it.
	 * Several large photographs decoding at once is exactly the stutter that
	 * appeared on the first opening of a collection and not on later ones, when
	 * the decoded frames were still in memory.
	 *
	 * `decode()` on an already-decoded image resolves immediately, so this costs
	 * nothing in the common case.
	 */
	return Promise.race([
		img.decode().catch(() => undefined),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
	]).then(() => undefined);
}

function claim(collectionId: string): PendingTransition | null {
	const state = pending;
	if (!state || state.collectionId !== collectionId || Date.now() - state.at > MAX_AGE_MS) {
		removeLayer();
		return null;
	}

	// Claimed: the caller owns the layer now and removes it when the flight ends,
	// so the unclaimed-expiry timer must not fire underneath it.
	if (expiry !== null) {
		clearTimeout(expiry);
		expiry = null;
	}
	pending = null;
	return state;
}

/**
 * Flies the ghosts onto their counterparts and hands over.
 *
 * Returns `false` when there was nothing to continue from — a direct link, a
 * reload, or reduced motion — so the caller can fall back to a plain reveal.
 */
async function play(
	container: HTMLElement,
	collectionId: string,
	options: { fadeRest: boolean }
): Promise<boolean> {
	const state = claim(collectionId);
	if (!state) return false;

	// Paired by photo id, so the two pages may legitimately order their
	// photographs differently.
	const targets = new Map<string, HTMLElement>();
	for (const el of container.querySelectorAll<HTMLElement>(`[${PHOTO_ATTR}]`)) {
		const id = el.getAttribute(PHOTO_ATTR);
		if (id && !targets.has(id)) targets.set(id, el);
	}

	const pairs = state.ghosts
		.map((ghost) => ({ ghost, target: targets.get(ghost.photoId) }))
		.filter((p): p is { ghost: Ghost; target: HTMLElement } => !!p.target);

	if (pairs.length === 0) {
		state.layer.remove();
		return false;
	}

	const matched = pairs.map((p) => p.target);
	const rest = options.fadeRest
		? Array.from(container.querySelectorAll<HTMLElement>(`[${PHOTO_ATTR}]`)).filter(
				(el) => !matched.includes(el)
			)
		: [];

	// The destinations stay invisible until the ghosts land, otherwise both
	// copies are on screen at once and it reads as duplication, not movement.
	gsap.set(matched, { opacity: 0 });
	if (rest.length) gsap.set(rest, { opacity: 0 });

	// Wait for the destination images so ghosts don't land on empty boxes. Both
	// pages request identical derivative URLs, so this is usually already cached.
	await Promise.all(pairs.map(({ target }) => whenDecoded(target, DECODE_TIMEOUT_MS)));

	const timeline = gsap.timeline({ onComplete: () => state.layer.remove() });

	for (const { ghost, target } of pairs) {
		/**
		 * Fitted to the destination's frame for the same reason the ghost was cut
		 * from one: wrapper-to-wrapper is not a uniform scale when the two
		 * wrappers have different proportions.
		 */
		const destination = target.querySelector<HTMLElement>('.frame') ?? target;
		const tween = Flip.fit(ghost.el, destination, {
			duration: DURATION,
			ease: ARRIVE_EASE,
			scale: true,
			absolute: true
		});
		if (tween) timeline.add(tween as gsap.core.Tween, 0);
	}

	// The real photograph appears just before its ghost dissolves, so there is
	// never a frame showing neither.
	timeline.to(matched, { opacity: 1, duration: 0.18 }, DURATION * 0.6);
	timeline.to(
		state.ghosts.map((g) => g.el),
		{ opacity: 0, duration: 0.16 },
		DURATION * 0.72
	);
	if (rest.length) {
		timeline.to(rest, { opacity: 1, duration: 0.3, stagger: 0.025 }, DURATION * 0.5);
	}

	await timeline.then();
	return true;
}

/** Plays an arriving stack→grid transition on the collection page. */
export function playIntoGrid(gridEl: HTMLElement, collectionId: string): Promise<boolean> {
	return play(gridEl, collectionId, { fadeRest: true });
}

/**
 * Plays the returning grid→stack transition on the artist page.
 *
 * Only the stack's own photographs are involved, so neighbouring collections
 * are left alone rather than flashing.
 */
export function playIntoStack(stackEl: HTMLElement, collectionId: string): Promise<boolean> {
	return play(stackEl, collectionId, { fadeRest: false });
}

/** Reveals a grid that arrived without a transition — a direct link or reload. */
export function revealGrid(gridEl: HTMLElement): void {
	const figures = Array.from(gridEl.querySelectorAll<HTMLElement>(`[${PHOTO_ATTR}]`));
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

/** True when a transition is waiting to be played for this collection. */
export function hasPending(collectionId: string): boolean {
	return (
		!!pending && pending.collectionId === collectionId && Date.now() - pending.at <= MAX_AGE_MS
	);
}

/** Drops any captured state, e.g. when a navigation is cancelled. */
export function cancelTransition(): void {
	removeLayer();
}
