<script lang="ts">
	import { resolve } from '$app/paths';
	import PhotoImage from '$lib/components/PhotoImage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const name = $derived(data.profile?.displayName || 'Vitrine');
</script>

<svelte:head>
	<title>{name}</title>
	{#if data.profile?.bio}
		<meta name="description" content={data.profile.bio.slice(0, 160)} />
	{/if}
	<meta property="og:title" content={name} />
	<meta property="og:type" content="website" />
</svelte:head>

{#if data.profile}
	<header class="intro">
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
			Nothing published yet. <a href={resolve('/admin/collections')}>Add a collection</a> to get started.
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
				>
					<!--
						The stack. Each layer is offset and rotated from CSS custom
						properties keyed off its index, so the arrangement is declarative
						and the animation layer only has to change the variables.

						`data-flip-id` marks the photos the page transition will carry into
						the collection grid.
					-->
					<div class="stack" style:--depth={collection.stack.length}>
						{#each collection.stack as photo, i (photo.id)}
							<div class="layer" style:--i={i} style:z-index={collection.stack.length - i}>
								<PhotoImage
									{photo}
									sizes="(max-width: 40rem) 80vw, 320px"
									loading={i === 0 ? 'eager' : 'lazy'}
									fetchpriority={i === 0 ? 'high' : 'auto'}
								/>
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
	.intro {
		display: flex;
		gap: 1.25rem;
		align-items: flex-start;
		max-width: 42rem;
		margin: 0 auto 5rem;
		padding: 5rem 1.5rem 0;
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
	.stack {
		position: relative;
		perspective: var(--stack-perspective);
		transform-style: preserve-3d;
		/* Room for the fanned layers, so a hovered stack never clips its
		   neighbours or provokes a scrollbar. */
		padding: calc(var(--stack-offset) * var(--depth));
	}

	.layer {
		transition:
			transform var(--duration-hover) var(--ease-out-soft),
			box-shadow var(--duration-hover) var(--ease-out-soft);
		/* Fanned down and to the right, each layer a little further along and a
		   little more rotated than the one above it. */
		transform: translate3d(
				calc(var(--stack-offset) * var(--i)),
				calc(var(--stack-offset) * var(--i)),
				0
			)
			rotate(calc(var(--stack-rotation) * var(--i)));
		box-shadow:
			0 1px 2px rgb(28 25 23 / 0.06),
			0 8px 24px -12px rgb(28 25 23 / 0.25);
		border-radius: 2px;
		overflow: hidden;
		background: var(--color-surface-raised);
	}

	/* Only the top layer is in flow; the rest stack up behind it. */
	.layer:not(:first-child) {
		position: absolute;
		inset: calc(var(--stack-offset) * var(--depth));
	}

	/*
	 * A modest CSS-only spread on hover. The cursor-tracked 3D tilt is layered on
	 * top of this in JS; keeping a static version here means the stacks still
	 * respond without JavaScript, and it collapses to nothing under reduced
	 * motion via the global rule in layout.css.
	 */
	.stack-link:hover .layer,
	.stack-link:focus-visible .layer {
		transform: translate3d(
				calc(var(--stack-offset) * var(--i) * 1.9),
				calc(var(--stack-offset) * var(--i) * 1.35),
				0
			)
			rotate(calc(var(--stack-rotation) * var(--i) * 1.7));
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
		max-width: 42rem;
		margin: 0 auto;
		padding: 0 1.5rem 8rem;
		font-size: 0.95rem;
		color: var(--color-ink-muted);
	}
</style>
