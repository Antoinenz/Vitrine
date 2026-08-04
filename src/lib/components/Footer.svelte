<script lang="ts">
	import { resolve } from '$app/paths';

	/**
	 * Site footer.
	 *
	 * Legal links appear only for pages the operator has actually written — an
	 * install that hasn't filled them in shows no dead links rather than linking
	 * to a 404 or to empty boilerplate.
	 */
	let {
		artist,
		legal
	}: {
		artist: string;
		legal: { slug: string; title: string }[];
	} = $props();

	const year = new Date().getFullYear();
</script>

<footer>
	<div class="inner">
		<p class="copyright">
			<!-- Photographs stay the artist's; the notice says so plainly. -->
			© {year}
			{artist || 'All photographs'} · All rights reserved
		</p>

		<nav>
			{#each legal as page (page.slug)}
				<a href={resolve('/(legal)/[legalSlug]', { legalSlug: page.slug })}>{page.title}</a>
			{/each}
			<a class="powered" href="https://github.com/Antoinenz/vitrine" rel="noopener">Vitrine</a>
		</nav>
	</div>
</footer>

<style>
	footer {
		border-top: 1px solid var(--color-hairline);
		margin-top: auto;
	}

	.inner {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.5rem;
		align-items: baseline;
		justify-content: space-between;
		max-width: 78rem;
		margin: 0 auto;
		padding: 1.75rem 1.5rem 2.5rem;
	}

	p {
		margin: 0;
		font-size: 0.78rem;
		color: var(--color-ink-subtle);
	}

	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
	}

	nav a {
		font-size: 0.78rem;
		color: var(--color-ink-subtle);
		text-decoration: none;
	}

	nav a:hover {
		color: var(--color-ink);
	}

	.powered {
		opacity: 0.7;
	}
</style>
