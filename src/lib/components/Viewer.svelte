<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
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
	 */
	const fullSrc = $derived(zoomed ? `/i/${photo.id}/${photo.maxWidth}.webp` : photo.src);

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

	function go(next: number) {
		if (next < 0 || next >= photos.length) return;
		resetZoom();
		onIndexChange(next);
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

	/** Keeps the active thumbnail in view as the selection moves. */
	$effect(() => {
		void index;
		void tick().then(() => {
			filmstripEl
				?.querySelector('[aria-current="true"]')
				?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
		});
	});

	/**
	 * Focus moves into the viewer on open so keys work without a click, and so
	 * screen-reader users land on the dialog rather than staying behind it.
	 */
	$effect(() => {
		containerEl?.focus();
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
				else onClose();
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
			<button type="button" onclick={onClose} title="Close (Esc)" class="close">Close</button>
		</div>
	</header>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="stage"
		class:zoomed
		class:dragging
		onwheel={onWheel}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		ondblclick={(e) => (zoomed ? resetZoom() : zoomAt(2.5, e.clientX, e.clientY))}
	>
		<img
			src={fullSrc}
			alt={photo.alt}
			style:transform="translate3d({panX}px, {panY}px, 0) scale({zoom})"
			draggable="false"
		/>
	</div>

	{#if photo.caption || showMetadata}
		<div class="info">
			{#if photo.caption}<p class="caption">{photo.caption}</p>{/if}
			{#if showMetadata && metadataEntries.length > 0}
				<dl>
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

	<nav class="filmstrip" bind:this={filmstripEl} aria-label="All photographs">
		{#each photos as p, i (p.id)}
			<button
				type="button"
				aria-current={i === index}
				aria-label="Photograph {i + 1}"
				onclick={() => go(i)}
				style:background-color={p.dominantColor}
			>
				<img src="/i/{p.id}/320.webp" alt="" loading="lazy" decoding="async" />
			</button>
		{/each}
	</nav>
</div>

<style>
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		grid-template-rows: auto 1fr auto;
		/* Near-black rather than pure black: photographs read better against a
		   surface that isn't absolute, and it matches the light theme's warmth. */
		background: #17151400;
		background-color: #171514;
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
		max-width: 100%;
		max-height: 100%;
		width: auto;
		height: auto;
		object-fit: contain;
		user-select: none;
		/* No transition while dragging — panning must track the pointer exactly. */
		transition: transform 180ms var(--ease-out-soft);
	}

	.stage.dragging img {
		transition: none;
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
		padding: 1rem 1.25rem;
		scrollbar-width: thin;
		scrollbar-color: #3a3634 transparent;
	}

	.filmstrip button {
		flex: none;
		width: 4.5rem;
		height: 3rem;
		padding: 0;
		border: 0;
		border-radius: 2px;
		overflow: hidden;
		cursor: pointer;
		opacity: 0.45;
		outline: 2px solid transparent;
		outline-offset: 2px;
		transition:
			opacity 200ms,
			outline-color 200ms;
	}

	.filmstrip button:hover {
		opacity: 0.8;
	}

	.filmstrip button[aria-current='true'] {
		opacity: 1;
		outline-color: #f5f3f0;
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
