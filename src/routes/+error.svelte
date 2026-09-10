<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import EmptyState from '$lib/components/EmptyState.svelte';

	/**
	 * Every error the gallery shows.
	 *
	 * SvelteKit renders this for anything that reaches `error()` or falls through
	 * as a 404, so it stands in for what would otherwise be a bare status line on
	 * a white page — which reads as the site being broken rather than the address
	 * being wrong.
	 *
	 * ## Why a 404 says so little
	 *
	 * A private or unlisted collection answers 404 rather than 403, deliberately,
	 * so that probing addresses cannot tell "this exists but you may not see it"
	 * from "this does not exist". This page has to hold that line: it can say the
	 * address led nowhere, and it must not speculate about what might have been
	 * there, however helpful that would feel.
	 */
	const status = $derived(page.status);

	const title = $derived(
		status === 404
			? 'There is nothing at this address'
			: status === 403
				? 'That is not yours to see'
				: status >= 500
					? 'Something went wrong at our end'
					: 'That did not work'
	);

	const message = $derived(
		status === 404
			? 'The page may have moved, or the link may have been mistyped. It is also what a private collection looks like from the outside.'
			: status >= 500
				? 'The gallery is still here; this particular request is not. Trying again often works.'
				: (page.error?.message ?? 'No further detail was given.')
	);
</script>

<svelte:head>
	<title>{status} · {title}</title>
	<!-- An error page is never worth indexing, whatever led here. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<EmptyState icon="lost" {title} {message}>
	<div class="actions">
		<a class="primary" href={resolve('/')}>Back to the gallery</a>
		{#if status >= 500}
			<button type="button" onclick={() => location.reload()}>Try again</button>
		{/if}
	</div>

	<p class="status">Error {status}</p>
</EmptyState>

<style>
	.actions {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
	}

	/* Square corners, like every other control here. */
	a,
	button {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--color-hairline);
		background: none;
		color: var(--color-ink-muted);
		text-decoration: none;
		cursor: pointer;
	}

	a:hover,
	button:hover {
		background: var(--color-surface-sunken);
		color: var(--color-ink);
	}

	.primary {
		border-color: var(--color-ink);
		background: var(--color-ink);
		color: var(--color-surface-raised);
	}

	.primary:hover {
		background: var(--color-ink);
		color: var(--color-surface-raised);
	}

	/*
	 * The number last and quiet. It matters to whoever is debugging and to nobody
	 * else, and leading with it makes an ordinary mistyped URL feel like a fault.
	 */
	.status {
		margin: 1.5rem 0 0;
		font-size: 0.78rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ink-subtle, var(--color-ink-muted));
	}
</style>
