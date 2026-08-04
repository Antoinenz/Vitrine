<script lang="ts">
	import { resolve } from '$app/paths';
	import { findLicence, DEFAULT_LICENCE } from '$lib/licences';

	/**
	 * Site footer.
	 *
	 * Legal links appear only for pages the operator has actually written — an
	 * install that hasn't filled them in shows no dead links rather than linking
	 * to a 404 or to empty boilerplate.
	 */
	let {
		artist,
		legal,
		licence,
		note,
		links
	}: {
		artist: string;
		legal: { slug: string; title: string }[];
		licence: string | null;
		note: string;
		links: { label: string; url: string }[];
	} = $props();

	const year = new Date().getFullYear();
	const chosen = $derived(findLicence(licence));
</script>

<footer>
	<div class="inner">
		<div class="left">
			<p class="copyright">
				<!-- Photographs stay the artist's; the notice says so plainly. -->
				© {year}
				{artist || 'All photographs'} ·
				{#if licence && licence !== DEFAULT_LICENCE && chosen.url}
					<!-- Linked to the canonical deed: the wording that governs use is the
					     licensor's own, not a paraphrase kept here. An external URL, so
					     `resolve()` (route IDs only) cannot apply. -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a class="licence" href={chosen.url} rel="license noopener" target="_blank">
						{chosen.label}
					</a>
				{:else}
					{chosen.label}
				{/if}
			</p>
			{#if note}<p class="note">{note}</p>{/if}
		</div>

		<nav>
			{#each links as link (link.url)}
				<!-- Artist-supplied external URLs; `resolve()` handles internal route
				     IDs only and throws on anything else. Validated as http(s) on save. -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={link.url} target="_blank" rel="noopener">{link.label}</a>
			{/each}
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

	.left {
		display: grid;
		gap: 0.3rem;
	}

	p {
		margin: 0;
		font-size: 0.78rem;
		color: var(--color-ink-subtle);
	}

	.note {
		max-width: 34rem;
		text-wrap: pretty;
	}

	.licence {
		color: inherit;
		text-decoration: none;
		border-bottom: 1px solid var(--color-hairline);
	}

	.licence:hover {
		color: var(--color-ink);
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
