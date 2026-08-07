<script lang="ts">
	import { resolve } from '$app/paths';
	import { preloadData } from '$app/navigation';
	import { page } from '$app/state';
	import PhotoImage from '$lib/components/PhotoImage.svelte';
	import { stackHover } from '$lib/motion/stack-hover';
	import { captureStack, playIntoStack, hasPending } from '$lib/motion/stack-transition';
	import { entrance } from '$lib/motion/entrance';
	import OwnerBar from '$lib/components/OwnerBar.svelte';
	import CollectionCreateModal from '$lib/components/CollectionCreateModal.svelte';
	import ProfileModal from '$lib/components/ProfileModal.svelte';
	import { setDropTarget, heldFolderName } from '$lib/upload/target.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let creating = $state(false);
	let editingProfile = $state(false);

	/**
	 * A folder dropped on this page has no collection to go into, so the files
	 * are held and the create modal opens with the folder's name already filled
	 * in — which is almost always what the artist would have typed.
	 */
	let suggestedTitle = $state('');

	/**
	 * Claims window-wide drops while the artist page is open.
	 *
	 * `kind: 'create'` rather than a collection: the overlay holds the files and
	 * calls back here, and the redirect into the newly created collection flushes
	 * them. Owner only — a visitor never has the overlay mounted at all.
	 */
	$effect(() => {
		if (!data.isOwner) return;
		setDropTarget({
			kind: 'create',
			onHeld: () => {
				suggestedTitle = heldFolderName() ?? '';
				creating = true;
			}
		});
		return () => setDropTarget(null);
	});

	const name = $derived(data.profile?.displayName || 'Vitrine');

	/**
	 * A stable pseudo-random number in [0, 1) derived from a photo's id.
	 *
	 * Deterministic on purpose: `Math.random()` would produce different values on
	 * the server and the client, so every card would jump to a new angle the
	 * moment the page hydrated. Deriving from the id means the arrangement is
	 * fixed for a given photograph and identical on both sides.
	 */
	function seeded(id: string, salt: number): number {
		let h = (2166136261 ^ salt) >>> 0;
		for (let i = 0; i < id.length; i++) {
			h ^= id.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		return ((h >>> 0) % 100000) / 100000;
	}

	/** Symmetric variation: -1 … 1. */
	const spread = (id: string, salt: number) => seeded(id, salt) * 2 - 1;

	/**
	 * Each print is dropped on the pile at its own angle and slightly off centre,
	 * rather than fanned by index from one corner. Rotation is about the middle
	 * of the card, so the pile splays both ways instead of hinging from a point.
	 */
	function scatter(id: string) {
		return {
			rotate: `${(spread(id, 1) * 7).toFixed(2)}deg`,
			dx: `${(spread(id, 2) * 9).toFixed(1)}px`,
			dy: `${(spread(id, 3) * 7).toFixed(1)}px`,
			// Seconds per drift cycle, and which way it leans first.
			drift: 9 + seeded(id, 4) * 7,
			driftDir: seeded(id, 5) < 0.5 ? -1 : 1
		};
	}

	/**
	 * Warms the destination on hover, so the click has both the page data and the
	 * grid's images already in cache. The stack and the grid request identical
	 * derivative URLs, which is what makes the second half of this work.
	 */
	function warm(collection: (typeof data.collections)[number], href: string) {
		void preloadData(href);
		for (const photo of collection.stack) new Image().src = photo.src;
	}

	/**
	 * Captures the stack just before navigation. The click is not intercepted —
	 * SvelteKit's router still handles the link normally, so the URL changes and
	 * the page is genuinely shareable.
	 */
	function onStackClick(event: MouseEvent, collectionId: string) {
		// Let modified clicks (new tab, download) behave normally.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

		const stack = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('.stack');
		if (stack) captureStack(stack, collectionId);
	}

	/**
	 * Plays the returning grid→stack transition when arriving back from a
	 * collection. Does nothing on a first visit, when nothing was captured.
	 */
	function returnTransition(node: HTMLElement, collectionId: string) {
		if (!hasPending(collectionId)) return;
		void playIntoStack(node, collectionId);
	}

	/**
	 * Settles the header in ahead of the stacks, so the page assembles in reading
	 * order rather than appearing all at once beneath a header that was somehow
	 * already there.
	 *
	 * Skipped entirely when returning from a collection: a photograph is already
	 * flying back into its stack, and a second animation starting at the same
	 * moment would compete with the thing the eye is actually following. The
	 * header was on screen when the visitor left, so re-introducing it would be
	 * wrong anyway.
	 */
	function headerEntrance(node: HTMLElement) {
		if (data.collections.some((c) => hasPending(c.id))) return;
		return entrance({ stagger: '.avatar, .intro-text > *' })(node);
	}
</script>

<svelte:head>
	<title>{name}</title>
	{#if data.profile?.bio}
		<meta name="description" content={data.profile.bio.slice(0, 160)} />
	{/if}
	<meta property="og:title" content={name} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={page.url.href} />
	{#if data.collections[0]?.stack[0]}
		<meta property="og:image" content="{page.url.origin}{data.collections[0].stack[0].socialSrc}" />
		<meta name="twitter:card" content="summary_large_image" />
	{/if}
</svelte:head>

{#if data.isOwner && data.owner}
	<OwnerBar onCreate={() => (creating = true)} onEditProfile={() => (editingProfile = true)} />

	<CollectionCreateModal
		open={creating}
		onClose={() => (creating = false)}
		initialTitle={suggestedTitle}
		message={form?.scope === 'create' ? form.message : null}
	/>

	<ProfileModal
		open={editingProfile}
		onClose={() => (editingProfile = false)}
		profile={data.owner.profile}
		candidates={data.owner.candidates}
		message={form?.scope === 'profile' ? form.message : null}
		saved={form?.scope === 'profile' && !!form.saved}
	/>
{/if}

{#if data.profile}
	<header class="intro" {@attach headerEntrance}>
		{#if data.profile.avatarPhotoId}
			<img
				class="avatar"
				src="/i/{data.profile.avatarPhotoId}/320.webp"
				alt={name}
				width="72"
				height="72"
			/>
		{/if}

		<div class="intro-text">
			<h1>{name}</h1>
			{#if data.profile.bio}
				<p class="bio">{data.profile.bio}</p>
			{/if}

			{#if data.profile.socialLinks.length > 0}
				<ul class="links">
					{#each data.profile.socialLinks as link (link.url)}
						<!-- Artist-supplied external URLs. `resolve()` is for internal route
						     IDs and throws on anything that isn't one, so it can't apply
						     here; the URLs are validated as http(s) when saved. -->
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<li><a href={link.url} target="_blank" rel="noopener me">{link.label}</a></li>
					{/each}
				</ul>
			{/if}
		</div>
	</header>
{/if}

{#if data.collections.length === 0}
	<p class="empty">
		{#if data.isOwner}
			<!-- A button rather than a link now: creating happens in a modal on this
			     page, so there is nowhere to navigate to. -->
			Nothing here yet.
			<button type="button" class="link" onclick={() => (creating = true)}>
				Make your first collection</button
			>, or drop a folder of photographs anywhere on this page.
		{:else}
			Nothing here yet.
		{/if}
	</p>
{:else}
	<ul class="collections">
		{#each data.collections as collection (collection.id)}
			<li>
				<a
					class="stack-link"
					href={resolve('/c/[slug]', { slug: collection.slug })}
					data-collection={collection.id}
					onpointerenter={(e) => warm(collection, e.currentTarget.href)}
					onfocus={(e) => warm(collection, e.currentTarget.href)}
					onclick={(e) => onStackClick(e, collection.id)}
				>
					<!--
						The stack. Each layer is offset and rotated from CSS custom
						properties keyed off its index, so the arrangement is declarative
						and the animation layer only has to change the variables.

						The grid marks its counterparts with `data-photo`, which the
						transition pairs up by index.
					-->
					<div
						class="stack"
						style:--depth={collection.stack.length}
						use:stackHover
						{@attach (node) => returnTransition(node, collection.id)}
					>
						<!--
							Owner-only: a collection with nothing processed yet.

							Deliberately not a `.layer` / `.card` / `[data-photo]` element.
							Those three are the transition's and the hover's vocabulary; a
							placeholder answering to them would be cloned into the ghost
							layer and flown at the grid. `stackHover` finds no `.card` here
							and returns without binding, so an empty tile is simply inert.
						-->
						{#if collection.stack.length === 0}
							<div class="placeholder">
								{#if collection.failedCount > 0}
									{collection.failedCount} failed
								{:else if collection.pendingCount > 0}
									{collection.pendingCount} processing…
								{:else}
									Empty
								{/if}
							</div>
						{/if}

						{#each collection.stack as photo, i (photo.id)}
							{@const s = scatter(photo.id)}
							<div
								class="layer"
								data-photo={photo.id}
								style:--i={i}
								style:--rot={s.rotate}
								style:--dx={s.dx}
								style:--dy={s.dy}
								style:--drift="{s.drift}s"
								style:--drift-dir={s.driftDir}
								style:z-index={collection.stack.length - i}
							>
								<div class="card" style:--ratio="{photo.width} / {photo.height}">
									<PhotoImage
										{photo}
										sizes="(max-width: 40rem) 80vw, 320px"
										loading={i === 0 ? 'eager' : 'lazy'}
										fetchpriority={i === 0 ? 'high' : 'auto'}
									/>
								</div>
							</div>
						{/each}
					</div>

					<div class="caption">
						<h2>{collection.title}</h2>
						<p class="count">
							{collection.photoCount}
							{collection.photoCount === 1 ? 'photograph' : 'photographs'}
							{#if data.isOwner && collection.visibility !== 'public'}
								<span class="tag">{collection.visibility}</span>
							{/if}
							{#if data.isOwner && collection.hasPassword}
								<span class="tag">password</span>
							{/if}
						</p>
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	/*
	 * Shares the collections grid's measure and padding so the bio and the first
	 * stack start on the same left edge. Constraining the intro to its own
	 * narrower box would centre it independently and leave the text floating
	 * inward of the photographs.
	 */
	.intro {
		display: flex;
		gap: 1.25rem;
		align-items: flex-start;
		max-width: 78rem;
		margin: 0 auto 5rem;
		padding: 5rem 1.5rem 0;
	}

	/* The text still keeps a readable line length within that wider container. */
	.intro-text {
		max-width: 38rem;
	}

	.avatar {
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}

	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.bio {
		margin: 0;
		font-size: 1rem;
		line-height: 1.65;
		color: var(--color-ink-muted);
		text-wrap: pretty;
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		list-style: none;
		margin: 1rem 0 0;
		padding: 0;
	}

	.links a {
		font-size: 0.85rem;
		color: var(--color-accent);
		text-decoration: none;
		border-bottom: 1px solid color-mix(in oklab, var(--color-accent) 30%, transparent);
		padding-bottom: 1px;
	}

	.links a:hover {
		border-bottom-color: currentColor;
	}

	.collections {
		list-style: none;
		margin: 0 auto;
		padding: 0 1.5rem 8rem;
		max-width: 78rem;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(20rem, 100%), 1fr));
		gap: 4.5rem 3rem;
	}

	.stack-link {
		display: block;
		text-decoration: none;
		color: inherit;
	}

	/*
	 * The stack sits in a perspective container so its layers can rotate in 3D on
	 * hover. The perspective lives here rather than on each layer so they share
	 * one vanishing point — set per-layer, each would rotate about its own centre
	 * and the stack would splay apart instead of tilting as one object.
	 */
	/*
	 * The stack has a fixed footprint, and each print keeps its own shape inside
	 * it.
	 *
	 * Sizing the container from its tallest card would let a portrait behind a
	 * landscape push the caption down — and letting each card drive layout gave
	 * a pile of mismatched rectangles. A constant box with the photographs
	 * *contained* within it keeps every stack the same height on the page while
	 * the prints themselves stay whatever shape they were taken.
	 */
	.stack {
		position: relative;
		aspect-ratio: 4 / 3;
		perspective: var(--stack-perspective);
		transform-style: preserve-3d;
		/* Room for the fan, so a hovered stack never clips its neighbours. */
		padding: calc(var(--stack-offset) * var(--depth));
	}

	/*
	 * CSS owns the fan; GSAP owns the magnet on `.card` inside. Splitting them
	 * across two elements keeps both from writing `transform` on the same node,
	 * which otherwise flickers as the CSS transition and the tween fight.
	 */
	.layer {
		transition: transform var(--duration-hover) var(--ease-out-soft);
		/*
		 * Scattered about the centre rather than fanned from a corner: each card
		 * carries its own angle and a small offset, both derived from its photo id.
		 * `transform-origin` stays at the default centre, so a card rotating left
		 * and one rotating right splay symmetrically instead of hinging from the
		 * same point.
		 */
		transform: translate3d(var(--dx), var(--dy), 0) rotate(var(--rot));
	}

	.card {
		/*
		 * Sized by the photograph's own ratio and contained in the layer, so a
		 * portrait is narrow and tall, a panorama wide and short, and neither
		 * escapes the stack's footprint.
		 */
		aspect-ratio: var(--ratio);
		height: 100%;
		width: auto;
		max-width: 100%;
		/* Square corners — a print has edges, not radii. */
		overflow: hidden;
		background: var(--color-surface-raised);
		box-shadow:
			0 1px 2px rgb(28 25 23 / 0.07),
			0 10px 30px -14px rgb(28 25 23 / 0.32);
		transition: box-shadow var(--duration-hover) var(--ease-out-soft);
	}

	.stack-link:hover .card,
	.stack-link:focus-visible .card {
		box-shadow:
			0 2px 4px rgb(28 25 23 / 0.08),
			0 18px 44px -18px rgb(28 25 23 / 0.4);
	}

	/* Every layer fills the stack's box and centres its card within it. */
	.layer {
		position: absolute;
		inset: calc(var(--stack-offset) * var(--depth));
		display: grid;
		place-items: center;
	}

	/*
	 * A modest CSS-only spread on hover. The cursor-tracked 3D tilt is layered on
	 * top of this in JS; keeping a static version here means the stacks still
	 * respond without JavaScript, and it collapses to nothing under reduced
	 * motion via the global rule in layout.css.
	 */
	/* Hovering pushes the pile further apart along the angles it already has. */
	.stack-link:hover .layer,
	.stack-link:focus-visible .layer {
		transform: translate3d(calc(var(--dx) * 2.4), calc(var(--dy) * 2.4), 0)
			rotate(calc(var(--rot) * 1.5));
	}

	.card :global(.frame) {
		width: 100%;
		height: 100%;
	}

	.caption {
		margin-top: 1.5rem;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 500;
		letter-spacing: -0.01em;
	}

	.stack-link:hover h2 {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.count {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--color-ink-subtle);
	}

	/*
	 * The empty/processing tile. Sits inside `.stack`'s padding so it occupies
	 * exactly the footprint a fanned stack would, and neighbouring collections
	 * don't shift as photographs finish processing and it is replaced.
	 */
	.placeholder {
		position: absolute;
		inset: calc(var(--stack-offset) * var(--depth));
		display: grid;
		place-items: center;
		/* Square, like `.card` — a print has edges, not radii. */
		border: 1px dashed var(--color-hairline);
		color: var(--color-ink-subtle);
		font-size: 0.8rem;
	}

	.tag {
		display: inline-block;
		margin-left: 0.35rem;
		padding: 0.05rem 0.4rem;
		font-size: 0.65rem;
		border: 1px solid var(--color-hairline);
		border-radius: 99px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.empty {
		max-width: 78rem;
		margin: 0 auto;
		padding: 0 1.5rem 8rem;
		font-size: 0.95rem;
		color: var(--color-ink-muted);
	}

	/* A button that opens a modal, styled as the link it replaced. */
	.link {
		font: inherit;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-accent);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
</style>
