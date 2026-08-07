<script lang="ts">
	import { resolve } from '$app/paths';
	import { pushState, replaceState, preloadData, goto, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import PhotoImage from '$lib/components/PhotoImage.svelte';
	import Viewer from '$lib/components/Viewer.svelte';
	import { playIntoGrid, revealGrid, captureGrid } from '$lib/motion/stack-transition';
	import { entrance } from '$lib/motion/entrance';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * Opening a photo pushes its real URL while keeping the grid mounted behind
	 * the overlay, so closing is instant and the browser's back button does the
	 * natural thing. The same URL server-renders as a standalone page when
	 * opened cold — see `[photoId]/+page.server.ts`.
	 */
	const openIndex = $derived(page.state.photo?.index ?? null);

	async function openPhoto(event: MouseEvent, index: number) {
		// Modified clicks and middle-clicks must keep opening a real tab.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
		event.preventDefault();

		const href = resolve('/c/[slug]/[photoId]', {
			slug: data.collection.slug,
			photoId: data.photos[index].id
		});

		// Warm the route's data so a later hard refresh or share is instant. If it
		// fails, fall back to a full navigation rather than showing nothing.
		const result = await preloadData(href);
		if (result.type === 'loaded' && result.status === 200) {
			pushState(href, { photo: { id: data.photos[index].id, index } });
		} else {
			await goto(href);
		}
	}

	function stepPhoto(next: number) {
		// Replaces rather than pushes: stepping through a collection shouldn't
		// require forty back presses to escape.
		replaceState(
			resolve('/c/[slug]/[photoId]', {
				slug: data.collection.slug,
				photoId: data.photos[next].id
			}),
			{
				photo: { id: data.photos[next].id, index: next }
			}
		);
	}

	function closePhoto() {
		// `history.back()` rather than a goto, so the entry pushed on open is
		// consumed instead of leaving a dangling forward step.
		history.back();
	}

	/**
	 * Brings the photo that was being viewed into view on the grid when the
	 * overlay closes. Without this, closing after arrowing deep into a
	 * collection dumps you back at the top with no idea where you were.
	 */
	let lastOpenIndex = $state<number | null>(null);
	$effect(() => {
		if (openIndex !== null) {
			lastOpenIndex = openIndex;
			return;
		}

		const index = lastOpenIndex;
		if (index === null) return;
		lastOpenIndex = null;

		/**
		 * Deferred by two frames rather than scrolling immediately.
		 *
		 * Closing goes through `history.back()`, and SvelteKit restores the scroll
		 * position it recorded for that history entry — which is wherever the grid
		 * was when the photo was opened. Scrolling synchronously here happens
		 * *before* that restoration and is silently overwritten, so the page ends
		 * up back at the top. Waiting until after layout has settled lets our
		 * scroll win.
		 */
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				gridEl
					?.querySelectorAll('[data-photo]')
					[index]?.scrollIntoView({ block: 'center', behavior: 'auto' });
			});
		});
	});

	const c = $derived(data.collection);
	const title = $derived(data.artist.name ? `${c.title} · ${data.artist.name}` : c.title);

	/**
	 * Captures the grid on the way out, so the photographs collapse back into
	 * their stack instead of simply disappearing.
	 *
	 * `beforeNavigate` rather than a click handler on the back link, so the
	 * browser's own Back button and a swipe-back gesture animate too — those are
	 * how most people actually leave a page.
	 */
	beforeNavigate((nav) => {
		if (nav.to?.route.id !== '/') return;
		if (gridEl) captureGrid(gridEl, c.id);
	});

	let gridEl = $state<HTMLElement>();

	/**
	 * Plays the arriving transition, or falls back to a plain reveal.
	 *
	 * `playIntoGrid` returns false whenever there is nothing to continue from — a
	 * shared link opened cold, a reload, a back navigation, or reduced motion —
	 * so the same code path covers every way of reaching this page. The
	 * destination looks identical either way; only the journey differs.
	 */
	/**
	 * Which collection has already been revealed, so it happens once per arrival.
	 *
	 * A plain `let`, not `$state`: it is read and written inside the effect below,
	 * and reactive state would make that a loop.
	 *
	 * The guard exists because the reveal is an *arrival* animation, and the
	 * effect re-runs on every data change, not just on arrival. When an upload
	 * finishes, the queue calls `invalidateAll()`; the load re-runs, `c` is a new
	 * object, and the effect fires again — with nothing pending to continue from,
	 * so `playIntoGrid` returns false and the entire grid fades and rises from
	 * scratch. Every photograph on the page would flash after each batch of
	 * uploads. Photos are visible by default, so newly-arrived ones simply appear
	 * rather than animating, which is the right behaviour anyway: they were added,
	 * not navigated to.
	 */
	/**
	 * Built once, deliberately.
	 *
	 * Svelte destroys and recreates an attachment whenever its expression
	 * changes, and `entrance({ … })` returns a fresh closure on every render — so
	 * inlining it in the markup would replay the header animation on every state
	 * change, including the `invalidateAll()` that fires when an upload finishes.
	 * A stable reference runs it once, on mount.
	 */
	const headEntrance = entrance({ stagger: '.head > *' });

	let revealedFor: string | null = null;

	$effect(() => {
		const el = gridEl;
		if (!el) return;

		const id = c.id;
		if (revealedFor === id) return;
		revealedFor = id;

		let cancelled = false;
		void playIntoGrid(el, id).then((played) => {
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
	<meta property="og:url" content={page.url.href} />
	{#if data.photos.length > 0}
		<!-- Absolute, and in a format every scraper decodes: relative URLs are
		     rejected outright, and several crawlers still can't read AVIF or WebP.
		     `page.url.origin` reflects ORIGIN in production. -->
		<meta property="og:image" content="{page.url.origin}{data.photos[0].socialSrc}" />
		<meta name="twitter:card" content="summary_large_image" />
	{/if}
	<!-- Unlisted collections are reachable by link but shouldn't be indexed;
	     that's the difference the artist chose when picking the state. -->
	{#if c.visibility !== 'public'}
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

<a class="back" href={resolve('/')}>← {data.artist.name || 'Back'}</a>

<!--
	Unlike the artist page's header, this one animates however the visitor
	arrived. There the header was already on screen before they left, so
	re-introducing it on the way back would be a lie; here the title is new
	content every time.

	It runs during the stack→grid flight rather than waiting for it. The two
	don't compete: the photographs are moving through the grid below while this
	settles above them, and holding the title back until the flight finished
	would leave the page headless for the most conspicuous half-second it has.
-->
<header class="head" {@attach headEntrance}>
	<h1>{c.title}</h1>
	{#if data.isOwner}
		<!--
			The way through to what is left of the old panel: the photo workbench,
			where photographs are reordered, captioned and given a cover. That moves
			inline next; until it does, this is how the artist reaches it — and
			without it the workbench would be unreachable except by typing a URL
			containing a collection id that appears nowhere.
		-->
		<p class="owner-link">
			<a href={resolve('/admin/collections/[id]', { id: c.id })}>Manage photos ↗</a>
		</p>
	{/if}
	{#if c.description}
		<p class="description">{c.description}</p>
	{/if}
	<p class="count">
		{data.photos.length}
		{data.photos.length === 1 ? 'photograph' : 'photographs'}
		{#if c.zipEnabled && data.photos.length > 0}
			<span class="sep">·</span>
			<a class="zip" href={resolve('/api/collections/[slug]/download', { slug: c.slug })}>
				Download all
			</a>
		{/if}
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
				<!-- A real link, so it can be opened in a new tab, copied, and
				     followed without JavaScript. The click handler upgrades it to an
				     in-place overlay when it can. -->
				<a
					href={resolve('/c/[slug]/[photoId]', {
						slug: data.collection.slug,
						photoId: photo.id
					})}
					onclick={(e) => openPhoto(e, i)}
				>
					<PhotoImage
						{photo}
						sizes="(max-width: 40rem) 100vw, (max-width: 70rem) 50vw, 33vw"
						loading={i < 6 ? 'eager' : 'lazy'}
						fetchpriority={i < 3 ? 'high' : 'auto'}
					/>
				</a>
				{#if photo.caption}
					<figcaption>{photo.caption}</figcaption>
				{/if}
			</figure>
		{/each}
	</div>
{/if}

{#if openIndex !== null}
	<Viewer
		photos={data.photos}
		index={openIndex}
		collectionTitle={c.title}
		downloadsEnabled={c.downloadsEnabled}
		onIndexChange={stepPhoto}
		onClose={closePhoto}
	/>
{/if}

<style>
	figure a {
		display: block;
		cursor: zoom-in;
	}

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

	.owner-link {
		margin: 0.35rem 0 0;
		font-size: 0.8rem;
	}

	.owner-link a {
		color: var(--color-ink-subtle);
		text-decoration: none;
		border-bottom: 1px solid var(--color-hairline);
	}

	.owner-link a:hover {
		color: var(--color-ink);
	}

	.count {
		margin: 0.75rem 0 0;
		font-size: 0.8rem;
		color: var(--color-ink-subtle);
	}

	.sep {
		margin: 0 0.15rem;
	}

	.zip {
		color: var(--color-accent);
		text-decoration: none;
		border-bottom: 1px solid color-mix(in oklab, var(--color-accent) 30%, transparent);
	}

	.zip:hover {
		border-bottom-color: currentColor;
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
		/*
		 * Photographs in a row sit centred against each other rather than hanging
		 * from the top. Every cell keeps its own aspect ratio, so a landscape frame
		 * beside a portrait one left a ragged top edge and a large void beneath the
		 * short one; centring shares that space and the row reads as one line of
		 * prints.
		 */
		align-items: center;
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
