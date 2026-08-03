<script lang="ts">
	import { resolve } from '$app/paths';
	import PhotoImage from '$lib/components/PhotoImage.svelte';
	import { playIntoGrid, revealGrid } from '$lib/motion/stack-transition';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const c = $derived(data.collection);
	const title = $derived(data.artist.name ? `${c.title} · ${data.artist.name}` : c.title);

	let gridEl = $state<HTMLElement>();

	/**
	 * Plays the arriving transition, or falls back to a plain reveal.
	 *
	 * `playIntoGrid` returns false whenever there is nothing to continue from — a
	 * shared link opened cold, a reload, a back navigation, or reduced motion —
	 * so the same code path covers every way of reaching this page. The
	 * destination looks identical either way; only the journey differs.
	 */
	$effect(() => {
		const el = gridEl;
		if (!el) return;

		let cancelled = false;
		void playIntoGrid(el, c.id).then((played) => {
			if (!played && !cancelled) revealGrid(el);
		});

		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:head>
	<title>{title}</title>
	{#if c.description}
		<meta name="description" content={c.description.slice(0, 160)} />
	{/if}
	<meta property="og:title" content={c.title} />
	<meta property="og:type" content="article" />
	{#if data.photos.length > 0}
		<meta property="og:image" content="/i/{data.photos[0].id}/1280.jpeg" />
	{/if}
	<!-- Unlisted collections are reachable by link but shouldn't be indexed;
	     that's the difference the artist chose when picking the state. -->
	{#if c.visibility !== 'public'}
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

<a class="back" href={resolve('/')}>← {data.artist.name || 'Back'}</a>

<header class="head">
	<h1>{c.title}</h1>
	{#if c.description}
		<p class="description">{c.description}</p>
	{/if}
	<p class="count">
		{data.photos.length}
		{data.photos.length === 1 ? 'photograph' : 'photographs'}
	</p>
</header>

{#if data.photos.length === 0}
	<p class="empty">This collection is still being prepared.</p>
{:else}
	<!--
		`data-photo` on each figure marks the elements the stack→grid transition
		animates into. The first few match the photos shown in the stack on the
		artist page, in the same order, so they can be paired up by index.
	-->
	<div class="grid" bind:this={gridEl}>
		{#each data.photos as photo, i (photo.id)}
			<figure data-photo={photo.id} data-index={i}>
				<PhotoImage
					{photo}
					sizes="(max-width: 40rem) 100vw, (max-width: 70rem) 50vw, 33vw"
					loading={i < 6 ? 'eager' : 'lazy'}
					fetchpriority={i < 3 ? 'high' : 'auto'}
				/>
				{#if photo.caption}
					<figcaption>{photo.caption}</figcaption>
				{/if}
			</figure>
		{/each}
	</div>
{/if}

<style>
	/* Same measure and padding as the grid, so every element on the page shares
	   one left edge. */
	.back {
		display: block;
		max-width: 78rem;
		margin: 2rem auto 0;
		padding: 0 1.5rem;
		font-size: 0.85rem;
		color: var(--color-ink-subtle);
		text-decoration: none;
	}

	.back:hover {
		color: var(--color-ink);
	}

	.head {
		max-width: 78rem;
		margin: 3rem auto 4rem;
		padding: 0 1.5rem;
	}

	/* Prose keeps a readable line length inside the wider container. */
	.description {
		max-width: 38rem;
	}

	h1 {
		margin: 0;
		font-size: 1.75rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.description {
		margin: 0.75rem 0 0;
		font-size: 1rem;
		line-height: 1.65;
		color: var(--color-ink-muted);
		text-wrap: pretty;
	}

	.count {
		margin: 0.75rem 0 0;
		font-size: 0.8rem;
		color: var(--color-ink-subtle);
	}

	/*
	 * A plain responsive grid rather than a masonry layout: every cell keeps the
	 * photo's own aspect ratio, and the row heights stay predictable. That
	 * predictability matters — the page transition measures these rectangles, and
	 * a masonry reflow between measuring and animating would land photos in the
	 * wrong place.
	 */
	.grid {
		max-width: 78rem;
		margin: 0 auto;
		padding: 0 1.5rem 8rem;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(22rem, 100%), 1fr));
		gap: 2.5rem 2rem;
		align-items: start;
	}

	figure {
		margin: 0;
	}

	figcaption {
		margin-top: 0.6rem;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--color-ink-subtle);
		text-wrap: pretty;
	}

	.empty {
		max-width: 78rem;
		margin: 0 auto;
		padding: 0 1.5rem 8rem;
		font-size: 0.95rem;
		color: var(--color-ink-muted);
	}
</style>
