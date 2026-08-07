<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { gsap, prefersReducedMotion, MOTION } from '$lib/motion/gsap';
	import { detailPanel } from '$lib/motion/entrance';
	import type { PhotoView } from '$lib/server/photos';

	/**
	 * Full-screen photo viewer.
	 *
	 * Rendered both by the standalone `/c/[slug]/[photoId]` route and as an
	 * overlay pushed from the grid, so it takes only data and callbacks — it
	 * never navigates on its own. Which URL is showing, and how, is the caller's
	 * concern.
	 */
	let {
		photos,
		index,
		collectionTitle,
		downloadsEnabled = false,
		onClose,
		onIndexChange
	}: {
		photos: PhotoView[];
		index: number;
		collectionTitle: string;
		downloadsEnabled?: boolean;
		onClose: () => void;
		onIndexChange: (index: number) => void;
	} = $props();

	const photo = $derived(photos[index]);

	let showMetadata = $state(false);
	let containerEl = $state<HTMLElement>();
	let filmstripEl = $state<HTMLElement>();

	// --- zoom / pan ---------------------------------------------------------

	const MAX_ZOOM = 4;
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let dragging = $state(false);
	let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };

	const zoomed = $derived(zoom > 1.001);

	/**
	 * The full-resolution rendition is only requested once someone actually zooms
	 * in. A casual viewer scrolling through a collection never downloads a 4K
	 * file they can't distinguish from the one already on screen.
	 *
	 * Both URLs come from the server, which builds them from the renditions that
	 * actually exist. Assembling one here from a width and a guessed extension is
	 * how the viewer ended up requesting a file that had never been generated.
	 */
	const fullSrc = $derived(zoomed ? photo.zoomSrc : photo.src);

	function resetZoom() {
		zoom = 1;
		panX = 0;
		panY = 0;
	}

	/** Clamps panning so the image can never be dragged off screen entirely. */
	function clampPan() {
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const maxX = (rect.width * (zoom - 1)) / 2;
		const maxY = (rect.height * (zoom - 1)) / 2;
		panX = Math.max(-maxX, Math.min(maxX, panX));
		panY = Math.max(-maxY, Math.min(maxY, panY));
	}

	/**
	 * Zooms toward a point rather than the centre, so the detail under the
	 * cursor stays under the cursor — the behaviour every map and image tool
	 * has trained people to expect.
	 */
	function zoomAt(factor: number, clientX?: number, clientY?: number) {
		const next = Math.max(1, Math.min(MAX_ZOOM, zoom * factor));
		if (next === zoom) return;

		if (containerEl && clientX !== undefined && clientY !== undefined) {
			const rect = containerEl.getBoundingClientRect();
			const offsetX = clientX - rect.left - rect.width / 2;
			const offsetY = clientY - rect.top - rect.height / 2;
			const ratio = next / zoom;
			panX = offsetX - (offsetX - panX) * ratio;
			panY = offsetY - (offsetY - panY) * ratio;
		}

		zoom = next;
		if (zoom === 1) {
			panX = 0;
			panY = 0;
		} else {
			clampPan();
		}
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault();
		zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);
	}

	function onPointerDown(event: PointerEvent) {
		if (!zoomed) return;
		dragging = true;
		dragStart = { x: event.clientX, y: event.clientY, panX, panY };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return;
		panX = dragStart.panX + (event.clientX - dragStart.x);
		panY = dragStart.panY + (event.clientY - dragStart.y);
		clampPan();
	}

	function onPointerUp(event: PointerEvent) {
		dragging = false;
		(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
	}

	// --- navigation ---------------------------------------------------------

	let stageEl = $state<HTMLElement>();
	let imageEl = $state<HTMLImageElement>();

	// --- load state ---------------------------------------------------------

	/**
	 * Whether the photograph currently on screen has decoded, failed, or is
	 * still arriving.
	 *
	 * Keyed by the URL rather than the index, so switching between the preview
	 * and the zoomed rendition is also covered — and so a cached image that
	 * completes before the handler attaches doesn't leave a spinner running
	 * forever.
	 */
	let loadState = $state<'loading' | 'ready' | 'error'>('loading');

	/**
	 * The source actually on screen, which is not always the one wanted.
	 *
	 * Zooming swaps `fullSrc` to a much larger rendition of the *same*
	 * photograph. Binding the element straight to `fullSrc` meant the image was
	 * hidden and a spinner shown while those bytes arrived — so the photograph
	 * vanished at the exact moment the visitor leaned in to look at it, then
	 * reappeared. Now the picture already on screen stays, scaled and soft, and
	 * is replaced only once the sharper file is decoded and can be swapped in the
	 * same frame.
	 *
	 * Seeded with the real source rather than left empty, and `untrack` says so
	 * deliberately: effects don't run on the server, so an empty initial value
	 * would server-render `<img src="">` — and this component *is* server-rendered
	 * for a cold-opened `/c/[slug]/[photoId]` link, which is the one case where
	 * the markup has to carry the photograph on its own.
	 */
	let displaySrc = $state(untrack(() => photo.src));

	/**
	 * Which photograph `displaySrc` belongs to. A plain `let`, not `$state`: the
	 * effect below both reads and writes it, and reactive state there would loop.
	 */
	let shownId = untrack(() => photo.id);

	$effect(() => {
		const wanted = fullSrc;
		const wantedId = photo.id;

		/**
		 * A different photograph. There is nothing valid on screen to keep, so the
		 * spinner is honest here — swap immediately and wait.
		 */
		if (wantedId !== shownId) {
			shownId = wantedId;
			displaySrc = wanted;
			loadState = 'loading';
			// A cached image can already be complete by the time this runs, in
			// which case no load event will ever fire.
			if (imageEl?.complete && imageEl.currentSrc.endsWith(wanted)) {
				loadState = imageEl.naturalWidth > 0 ? 'ready' : 'error';
			}
			return;
		}

		// Same photograph, finer rendition: fetch it out of sight and only then
		// put it on screen.
		if (wanted === untrack(() => displaySrc)) return;

		let cancelled = false;
		const preload = new Image();
		preload.src = wanted;
		void preload
			.decode()
			.then(() => {
				if (!cancelled) displaySrc = wanted;
			})
			// A zoom rendition that fails to load is not worth surfacing: the
			// visitor keeps the photograph they already had.
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	});

	/** Which way the last step went, so the arrival slides in from the far side. */
	let slideFrom = $state(0);

	/**
	 * Steps to another photograph.
	 *
	 * The index changes *immediately* and the animation is played on arrival,
	 * rather than deferring the change until an exit tween finishes. Gating the
	 * state change on the tween silently swallowed rapid presses: each keystroke
	 * read a not-yet-updated index, so holding the arrow key advanced one or two
	 * frames instead of racing through the collection.
	 */
	function go(next: number) {
		if (next < 0 || next >= photos.length) return;
		resetZoom();
		slideFrom = next > index ? 1 : -1;
		onIndexChange(next);
	}

	/** Slides the newly-shown photograph in from the direction of travel. */
	$effect(() => {
		void index;
		const direction = slideFrom;
		if (!direction || prefersReducedMotion() || !imageEl) return;

		gsap.fromTo(
			imageEl,
			{ xPercent: 6 * direction, opacity: 0 },
			{ xPercent: 0, opacity: 1, duration: 0.3, ease: MOTION.ease, overwrite: 'auto' }
		);
	});

	/** Fades the backdrop up and lifts the photograph in on open. */
	$effect(() => {
		if (prefersReducedMotion() || !containerEl) return;
		gsap.fromTo(containerEl, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power2.out' });
		if (imageEl) {
			gsap.fromTo(
				imageEl,
				{ scale: 0.94, opacity: 0 },
				{ scale: 1, opacity: 1, duration: 0.34, ease: 'power3.out' }
			);
		}
	});

	/**
	 * Plays the close animation, then hands back to the caller.
	 *
	 * The overlay is unmounted by the parent when the URL changes, so the
	 * animation has to finish first — calling `onClose` immediately would remove
	 * the element mid-tween.
	 */
	function animateClose() {
		if (prefersReducedMotion() || !containerEl) {
			onClose();
			return;
		}
		gsap.to(imageEl ?? containerEl, { scale: 0.96, opacity: 0, duration: 0.16, ease: 'power2.in' });
		gsap.to(containerEl, {
			opacity: 0,
			duration: 0.2,
			ease: 'power2.in',
			onComplete: onClose
		});
	}

	// --- swipe -------------------------------------------------------------

	/** Distance a finger must travel before it counts as a swipe rather than a tap. */
	const SWIPE_THRESHOLD = 60;
	let swipeStart: { x: number; y: number } | null = null;

	function onSwipeStart(event: PointerEvent) {
		// Only bare touch drags swipe; a zoomed photo is being panned instead.
		if (event.pointerType === 'mouse' || zoomed) return;
		swipeStart = { x: event.clientX, y: event.clientY };
	}

	function onSwipeEnd(event: PointerEvent) {
		if (!swipeStart) return;
		const dx = event.clientX - swipeStart.x;
		const dy = event.clientY - swipeStart.y;
		swipeStart = null;

		// Ignore mostly-vertical drags so a scroll gesture doesn't change photo.
		if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
		go(dx < 0 ? index + 1 : index - 1);
	}

	/**
	 * Warms the neighbours so arrow-key scrubbing doesn't flash a placeholder on
	 * every press. Only ±1: prefetching further ahead would spend a visitor's
	 * bandwidth on photos they may never reach.
	 */
	$effect(() => {
		for (const i of [index - 1, index + 1]) {
			if (i >= 0 && i < photos.length) new Image().src = photos[i].src;
		}
	});

	/**
	 * How wide the centre marker should be, in rem, for the selected photograph.
	 *
	 * The thumbnails are a fixed height with width following the frame, so the
	 * marker has to match or it would sit loose around a portrait and clip a
	 * panorama. Derived rather than measured: reading the element back would need
	 * a layout pass on every step.
	 */
	const THUMB_HEIGHT_REM = 3.25;
	const markerWidth = $derived(
		Math.min(9, Math.max(1.6, (photo.width / photo.height) * THUMB_HEIGHT_REM))
	);

	/**
	 * Brings the selected thumbnail to the centre of the strip.
	 *
	 * The strip moves and the marker stays put, rather than the other way round —
	 * with a long collection a travelling highlight means hunting for it again
	 * after every step, while a fixed centre gives the eye somewhere to rest.
	 *
	 * The first run jumps rather than glides: on open the strip starts at scroll
	 * zero, and animating from there would drag the whole collection past the
	 * viewer before settling on the photograph already on screen.
	 */
	let strippedOnce = false;

	$effect(() => {
		void index;
		void tick().then(() => {
			const active = filmstripEl?.querySelector('[aria-current="true"]');
			if (!active) return;

			active.scrollIntoView({
				block: 'nearest',
				inline: 'center',
				behavior: strippedOnce && !prefersReducedMotion() ? 'smooth' : 'auto'
			});
			strippedOnce = true;
		});
	});

	/**
	 * Focus moves into the viewer on open so keys work without a click, and so
	 * screen-reader users land on the dialog rather than staying behind it.
	 */
	$effect(() => {
		containerEl?.focus();
	});

	/**
	 * Holds the page still behind the viewer.
	 *
	 * Without this the gallery scrolls under the overlay on a wheel or trackpad
	 * gesture, and its scrollbar stays visible down the side of a full-screen
	 * photograph. The bar's width is replaced with padding so locking doesn't
	 * shift the layout sideways as it disappears.
	 */
	$effect(() => {
		const { style } = document.body;
		const previousOverflow = style.overflow;
		const previousPadding = style.paddingRight;
		const barWidth = window.innerWidth - document.documentElement.clientWidth;

		style.overflow = 'hidden';
		if (barWidth > 0) style.paddingRight = `${barWidth}px`;

		return () => {
			style.overflow = previousOverflow;
			style.paddingRight = previousPadding;
		};
	});

	function onKeyDown(event: KeyboardEvent) {
		switch (event.key) {
			case 'ArrowRight':
				event.preventDefault();
				go(index + 1);
				break;
			case 'ArrowLeft':
				event.preventDefault();
				go(index - 1);
				break;
			case 'Escape':
				event.preventDefault();
				// Zoomed in, Escape steps back out before it closes — otherwise a
				// close feels like it discarded work.
				if (zoomed) resetZoom();
				else animateClose();
				break;
			case '+':
			case '=':
				event.preventDefault();
				zoomAt(1.3);
				break;
			case '-':
				event.preventDefault();
				zoomAt(1 / 1.3);
				break;
			case '0':
				event.preventDefault();
				resetZoom();
				break;
			case 'i':
				showMetadata = !showMetadata;
				break;
			case 'Home':
				event.preventDefault();
				go(0);
				break;
			case 'End':
				event.preventDefault();
				go(photos.length - 1);
				break;
		}
	}

	const METADATA_LABELS: Record<string, string> = {
		camera: 'Camera',
		lens: 'Lens',
		focalLength: 'Focal length',
		aperture: 'Aperture',
		shutterSpeed: 'Shutter',
		iso: 'ISO',
		takenAt: 'Taken',
		location: 'Location'
	};

	const metadataEntries = $derived(
		Object.entries(photo.exif ?? {}).map(([key, value]) => ({
			label: METADATA_LABELS[key] ?? key,
			value:
				key === 'takenAt'
					? new Date(String(value)).toLocaleDateString(undefined, {
							year: 'numeric',
							month: 'long',
							day: 'numeric'
						})
					: key === 'location' && value && typeof value === 'object'
						? `${(value as { lat: number }).lat.toFixed(4)}, ${(value as { lon: number }).lon.toFixed(4)}`
						: String(value)
		}))
	);
</script>

<svelte:window onkeydown={onKeyDown} />

<div
	class="viewer"
	role="dialog"
	aria-modal="true"
	aria-label="{collectionTitle} — photograph {index + 1} of {photos.length}"
	tabindex="-1"
	bind:this={containerEl}
>
	<header>
		<span class="position">{index + 1} / {photos.length}</span>

		<div class="tools">
			{#if metadataEntries.length > 0}
				<button
					type="button"
					aria-pressed={showMetadata}
					onclick={() => (showMetadata = !showMetadata)}
					title="Details (i)"
				>
					Details
				</button>
			{/if}
			{#if downloadsEnabled}
				<a
					href={resolve('/api/photos/[photoId]/download', { photoId: photo.id })}
					download
					title="Download"
				>
					Download
				</a>
			{/if}
			<button type="button" onclick={animateClose} title="Close (Esc)" class="close">Close</button>
		</div>
	</header>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!--
		The dismiss-on-backdrop-click has a keyboard equivalent already: Escape is
		bound on the window and closes the viewer. Adding a key handler to this div
		would put a redundant, focusable element between the photograph and the
		filmstrip for keyboard users.
	-->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="stage"
		class:zoomed
		class:dragging
		bind:this={stageEl}
		onwheel={onWheel}
		onpointerdown={(e) => {
			onPointerDown(e);
			onSwipeStart(e);
		}}
		onpointermove={onPointerMove}
		onpointerup={(e) => {
			onPointerUp(e);
			onSwipeEnd(e);
		}}
		onpointercancel={(e) => {
			onPointerUp(e);
			swipeStart = null;
		}}
		ondblclick={(e) => (zoomed ? resetZoom() : zoomAt(2.5, e.clientX, e.clientY))}
		onclick={(e) => {
			// Clicking the surround dismisses; clicking the photograph itself must
			// not, or zooming would be impossible.
			if (e.target === e.currentTarget && !zoomed) animateClose();
		}}
	>
		<img
			bind:this={imageEl}
			src={displaySrc}
			alt={photo.alt}
			decoding="async"
			style:transform="translate3d({panX}px, {panY}px, 0) scale({zoom})"
			style:visibility={loadState === 'ready' ? 'visible' : 'hidden'}
			draggable="false"
			onload={() => (loadState = 'ready')}
			onerror={() => (loadState = 'error')}
		/>

		{#if loadState === 'loading'}
			<!-- Sits behind the image rather than replacing it, so the swap when it
			     arrives doesn't shift anything. -->
			<div class="status" role="status" aria-label="Loading photograph">
				<span class="spinner"></span>
			</div>
		{:else if loadState === 'error'}
			<div class="status error" role="alert">
				<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
					<path
						d="M12 3.5 1.7 21h20.6L12 3.5Z"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linejoin="round"
					/>
					<path d="M12 10v4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
					<circle cx="12" cy="17.6" r="1.05" fill="currentColor" />
				</svg>
				<p>This photograph couldn’t be loaded.</p>
			</div>
		{/if}
	</div>

	<!--
		Two transitions, because there are two ways this can change shape.

		With no caption — the common case, since most photographs carry EXIF and
		few carry a caption — toggling details mounts and unmounts the whole
		`.info` block, so that is what has to animate. With a caption, `.info` is
		already on screen and only the `dl` comes and goes. Putting the transition
		on just one of them would leave the other case popping.
	-->
	{#if photo.caption || showMetadata}
		<div class="info" transition:detailPanel>
			{#if photo.caption}<p class="caption">{photo.caption}</p>{/if}
			{#if showMetadata && metadataEntries.length > 0}
				<dl transition:detailPanel>
					{#each metadataEntries as entry (entry.label)}
						<div>
							<dt>{entry.label}</dt>
							<dd>{entry.value}</dd>
						</div>
					{/each}
				</dl>
			{/if}
		</div>
	{/if}

	<button
		type="button"
		class="arrow prev"
		onclick={() => go(index - 1)}
		disabled={index === 0}
		aria-label="Previous photograph">‹</button
	>
	<button
		type="button"
		class="arrow next"
		onclick={() => go(index + 1)}
		disabled={index === photos.length - 1}
		aria-label="Next photograph">›</button
	>

	<!--
	The marker's width follows the selected photograph's shape, so it frames a
	portrait chip as snugly as a panorama.
-->
	<div class="filmstrip-window" style:--marker-width="{markerWidth}rem">
		<nav class="filmstrip" bind:this={filmstripEl} aria-label="All photographs">
			{#each photos as p, i (p.id)}
				<button
					type="button"
					aria-current={i === index}
					aria-label="Photograph {i + 1}"
					onclick={() => go(i)}
					style:background-color={p.dominantColor}
					style:aspect-ratio="{p.width} / {p.height}"
				>
					<img src="/i/{p.id}/320.webp" alt="" loading="lazy" decoding="async" />
				</button>
			{/each}
		</nav>
	</div>
</div>

<style>
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		grid-template-rows: auto 1fr auto;
		/*
		 * Translucent rather than solid, and warm rather than pure black — the page
		 * stays faintly visible behind the photograph, so the viewer reads as a
		 * layer over the gallery instead of a separate screen. The blur keeps the
		 * grid from competing with the image through the backdrop.
		 */
		background-color: rgb(28 25 23 / 0.86);
		backdrop-filter: blur(18px) saturate(0.9);
		-webkit-backdrop-filter: blur(18px) saturate(0.9);
		color: #f5f3f0;
		outline: none;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.9rem 1.25rem;
		font-size: 0.8rem;
	}

	.position {
		color: #a5a09b;
		font-variant-numeric: tabular-nums;
	}

	.tools {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.tools button,
	.tools a {
		font: inherit;
		font-size: 0.8rem;
		color: #a5a09b;
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		text-decoration: none;
	}

	.tools button:hover,
	.tools a:hover,
	.tools button[aria-pressed='true'] {
		color: #f5f3f0;
	}

	.stage {
		position: relative;
		display: grid;
		place-items: center;
		overflow: hidden;
		min-height: 0;
		padding: 0 3.5rem;
		touch-action: none;
	}

	.stage.zoomed {
		cursor: grab;
	}

	.stage.dragging {
		cursor: grabbing;
	}

	.stage img {
		/*
		 * The element fills the stage and the photograph is letterboxed inside it
		 * by `object-fit: contain`, rather than the element being sized from the
		 * photograph's own dimensions.
		 *
		 * Sizing it the other way — `width/height: auto` with `max-*: 100%` — let
		 * the width constraint win and then derived the height from the aspect
		 * ratio, so a tall photograph computed a height taller than the stage and
		 * was clipped by its overflow. Filling a known box takes percentage
		 * resolution out of the picture: whatever size the stage is, the
		 * photograph fits within it.
		 */
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		user-select: none;
		/* No transition while dragging — panning must track the pointer exactly. */
		transition: transform 180ms var(--ease-out-soft);
	}

	.stage.dragging img {
		transition: none;
	}

	/* Centred in the stage, beneath the image so nothing moves on arrival. */
	.status {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 0.85rem;
		pointer-events: none;
		color: #8b8681;
	}

	.status p {
		margin: 0;
		font-size: 0.85rem;
	}

	.status.error {
		color: #d99a94;
	}

	.spinner {
		width: 1.75rem;
		height: 1.75rem;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 700ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/*
	 * A spinning ring is motion, and someone who asked for less of it should get
	 * a static indicator rather than nothing at all — they still need to know the
	 * photograph is on its way.
	 */
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
			border-top-color: currentColor;
			opacity: 0.55;
		}
	}

	.info {
		padding: 0.75rem 1.25rem 0;
		max-width: 42rem;
		margin-inline: auto;
		text-align: center;
	}

	.caption {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		color: #d6d1cb;
	}

	dl {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.35rem 1.25rem;
		margin: 0.6rem 0 0;
		font-size: 0.75rem;
		color: #a5a09b;
	}

	dl div {
		display: flex;
		gap: 0.35rem;
	}

	dt {
		color: #7c7772;
	}

	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}

	.arrow {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		width: 3rem;
		height: 3rem;
		font-size: 1.75rem;
		line-height: 1;
		color: #f5f3f0;
		background: none;
		border: 0;
		cursor: pointer;
		opacity: 0.55;
	}

	.arrow:hover:not(:disabled) {
		opacity: 1;
	}

	.arrow:disabled {
		opacity: 0.15;
		cursor: default;
	}

	.prev {
		left: 0.25rem;
	}
	.next {
		right: 0.25rem;
	}

	.filmstrip {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		/*
		 * Half the strip's width of empty space at each end.
		 *
		 * This is what lets the *strip* move while the selection stays put. Without
		 * it the first and last thumbnails can never reach the middle — there is
		 * nothing to scroll past them — so the highlight had to travel along a
		 * stationary strip instead, and the eye had to hunt for it after every
		 * step. With the padding, every thumbnail can be brought to the centre,
		 * and the marker becomes a fixed point the photographs pass through.
		 */
		padding: 1rem 50%;
		scrollbar-width: thin;
		scrollbar-color: #3a3634 transparent;
	}

	/*
	 * The centre marker: a fixed outline the selected thumbnail sits inside,
	 * rather than an outline that moves with the selection.
	 *
	 * Purely decorative and never hit-testable, so it cannot intercept a click
	 * meant for the thumbnail beneath it.
	 */
	.filmstrip-window {
		position: relative;
	}

	.filmstrip-window::after {
		content: '';
		position: absolute;
		top: 1rem;
		bottom: 1rem;
		left: 50%;
		translate: -50% 0;
		width: var(--marker-width, 4.5rem);
		outline: 2px solid #f5f3f0;
		outline-offset: 2px;
		border-radius: 2px;
		pointer-events: none;
		transition: width 200ms var(--ease-out-soft);
	}

	.filmstrip button {
		flex: none;
		/*
		 * Height is fixed and width follows the photograph, so a portrait frame is
		 * a tall narrow chip and a panorama a wide one. They used to be forced into
		 * one 3:2 box and cropped to fit, which made a strip of portraits
		 * indistinguishable from each other.
		 */
		height: 3.25rem;
		width: auto;
		padding: 0;
		border: 0;
		border-radius: 2px;
		overflow: hidden;
		cursor: pointer;
		opacity: 0.45;
		transition: opacity 200ms;
	}

	.filmstrip button:hover {
		opacity: 0.8;
	}

	.filmstrip button[aria-current='true'] {
		opacity: 1;
	}

	.filmstrip img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	@media (max-width: 40rem) {
		.stage {
			padding: 0 0.5rem;
		}
		.arrow {
			display: none;
		}
	}
</style>
