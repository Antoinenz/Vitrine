<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.title}</title>
</svelte:head>

<article>
	<a class="back" href={resolve('/')}>← Back</a>
	<h1>{data.title}</h1>

	{#each data.blocks as block, i (i)}
		{#if block.type === 'heading'}
			<h2>{block.text}</h2>
		{:else}
			<p>{block.text}</p>
		{/if}
	{/each}

	<p class="updated">
		Last updated {data.updatedAt.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		})}
	</p>
</article>

<style>
	/* Shares the site's measure so the text starts on the same left edge as the
	   galleries, rather than floating in a centred column of its own. */
	article {
		max-width: 78rem;
		margin: 0 auto;
		padding: 3rem 1.5rem 8rem;
	}

	/* Prose still keeps a readable line length within that wider container. */
	h1,
	h2,
	p {
		max-width: 40rem;
	}

	.back {
		font-size: 0.85rem;
		color: var(--color-ink-subtle);
		text-decoration: none;
	}

	.back:hover {
		color: var(--color-ink);
	}

	h1 {
		margin: 2rem 0 0;
		font-size: 1.6rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	h2 {
		margin: 2.5rem 0 0;
		font-size: 1rem;
		font-weight: 600;
	}

	p {
		margin: 0.9rem 0 0;
		font-size: 0.95rem;
		line-height: 1.7;
		color: var(--color-ink-muted);
		text-wrap: pretty;
	}

	.updated {
		margin-top: 3rem;
		font-size: 0.8rem;
		color: var(--color-ink-subtle);
	}
</style>
