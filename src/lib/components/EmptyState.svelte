<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The page when there is nothing to show.
	 *
	 * One component for an empty collection and for an error, because they are
	 * the same moment from the visitor's side: they asked for photographs and
	 * there are none. What differs is why, and what to do about it — which is
	 * what the caller supplies.
	 *
	 * A sentence on its own in the corner of a page reads as a fault in the site.
	 * Something centred, with a mark and a way forward, reads as an answer.
	 */
	let {
		icon = 'gallery',
		title,
		message,
		children
	}: {
		/** `gallery` for nothing here; `lost` for an address that leads nowhere. */
		icon?: 'gallery' | 'lost';
		title: string;
		message?: string;
		/** Whatever the visitor should be able to do about it. */
		children?: Snippet;
	} = $props();
</script>

<div class="empty-state">
	<!--
		Drawn rather than a character or an image file: an emoji is a different
		shape in every browser, and a file is a request that might fail on the one
		page whose whole job is explaining that something already has.
	-->
	<svg viewBox="0 0 48 48" aria-hidden="true" class="mark">
		<rect
			x="6"
			y="10"
			width="36"
			height="28"
			rx="1"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
		/>
		{#if icon === 'gallery'}
			<!-- A hill and a sun: a picture, with a line through it. -->
			<path
				d="M6 32l9-9 6 6 7-7 14 14"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<circle cx="17" cy="18" r="2.5" fill="currentColor" />
			<path d="M9 41 39 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
		{:else}
			<!-- An empty frame with a question in it. -->
			<path
				d="M20 20a4 4 0 1 1 5 4c-1 .5-1 1.5-1 2.5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
			/>
			<circle cx="24" cy="31" r="1.4" fill="currentColor" />
		{/if}
	</svg>

	<h2>{title}</h2>
	{#if message}<p class="message">{message}</p>{/if}

	{#if children}
		<div class="action">{@render children()}</div>
	{/if}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.4rem;
		/*
		 * Placed a little above the middle. Optical centre, not geometric: content
		 * pinned to the exact middle of a tall viewport reads as low.
		 */
		min-height: 60svh;
		justify-content: center;
		padding: 3rem 1.5rem 5rem;
		max-width: 30rem;
		margin: 0 auto;
		color: var(--color-ink-muted);
	}

	.mark {
		width: 4.5rem;
		height: 4.5rem;
		margin-bottom: 1rem;
		color: var(--color-ink-subtle, var(--color-hairline));
	}

	h2 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--color-ink);
	}

	.message {
		margin: 0;
		font-size: 0.92rem;
		max-width: 26rem;
	}

	.action {
		margin-top: 1.25rem;
	}
</style>
