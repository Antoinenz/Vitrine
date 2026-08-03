<script lang="ts">
	import type { PhotoView } from '$lib/server/photos';

	/**
	 * Renders one photo as a `<picture>` with responsive sources.
	 *
	 * The wrapper carries the photo's aspect ratio and its dominant colour, so
	 * the layout is final before any image byte arrives — nothing reflows as the
	 * grid loads. That matters twice over here: the stack→grid transition
	 * measures element rectangles, and a box that resizes mid-animation would
	 * land the photos in the wrong place.
	 */
	let {
		photo,
		sizes = '100vw',
		loading = 'lazy',
		fetchpriority = 'auto',
		aspect,
		class: className = ''
	}: {
		photo: PhotoView;
		sizes?: string;
		loading?: 'lazy' | 'eager';
		fetchpriority?: 'high' | 'low' | 'auto';
		/**
		 * Forces a uniform frame shape, e.g. `'4 / 3'`, cropping via object-fit.
		 *
		 * Used by the collection stacks: a pile of prints has to be one card
		 * shape. Letting each photograph keep its own ratio makes the cards
		 * different heights, so the pile reads as broken rather than layered, and
		 * a tall photograph behind a short one overflows the container and
		 * collides with the caption beneath.
		 *
		 * The grid deliberately does *not* set this — there, every photograph
		 * should be seen whole.
		 */
		aspect?: string;
		class?: string;
	} = $props();

	let imgEl = $state<HTMLImageElement>();
	let loaded = $state(false);

	/**
	 * The fade is opt-in rather than the default, so an image is only ever hidden
	 * when there is JavaScript running to reveal it again. Without this the
	 * `opacity: 0` starting state would leave every photo permanently invisible
	 * with JS disabled.
	 *
	 * Checking `complete` covers the other gap: an image served from cache can
	 * finish before hydration attaches the load handler, so the event never
	 * fires and the photo would hang at zero opacity.
	 */
	let fadeEnabled = $state(false);

	$effect(() => {
		fadeEnabled = true;
		if (imgEl?.complete) loaded = true;
	});
</script>

<div
	class="frame {className}"
	style:aspect-ratio={aspect ?? `${photo.width} / ${photo.height}`}
	style:background-color={photo.dominantColor}
>
	<picture>
		{#each photo.sources as source (source.type)}
			<source type={source.type} srcset={source.srcset} {sizes} />
		{/each}
		<img
			bind:this={imgEl}
			src={photo.src}
			alt={photo.alt}
			width={photo.width}
			height={photo.height}
			{loading}
			{fetchpriority}
			decoding="async"
			class:fade={fadeEnabled && !loaded}
			onload={() => (loaded = true)}
		/>
	</picture>
</div>

<style>
	.frame {
		position: relative;
		overflow: hidden;
		width: 100%;
	}

	picture,
	img {
		display: block;
		width: 100%;
		height: 100%;
	}

	img {
		object-fit: cover;
		/* Visible by default; the fade is applied only once JS can undo it. */
		opacity: 1;
		transition: opacity 500ms var(--ease-out-soft);
	}

	/* Faded in over the dominant colour so a slow image resolves gently instead
	   of snapping into place. */
	img.fade {
		opacity: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		img,
		img.fade {
			transition: none;
			opacity: 1;
		}
	}
</style>
