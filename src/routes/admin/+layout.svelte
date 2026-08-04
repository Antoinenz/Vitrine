<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// The login and forced-password screens stand alone, without the shell.
	let bare = $derived(!data.user);

	// Resolved through `resolve()` so the router can verify these route IDs exist
	// at build time — a typo becomes a compile error rather than a dead link.
	const nav = [
		{ href: resolve('/admin/collections'), label: 'Collections' },
		{ href: resolve('/admin/profile'), label: 'Profile' },
		{ href: resolve('/admin/pages'), label: 'Pages' }
	];

	const home = resolve('/');
</script>

{#if bare}
	{@render children()}
{:else}
	<div class="shell">
		<header>
			<a class="brand" href={home}>Vitrine</a>

			<nav>
				{#each nav as item (item.href)}
					<a
						href={item.href}
						aria-current={page.url.pathname.startsWith(item.href) ? 'page' : undefined}
					>
						{item.label}
					</a>
				{/each}
			</nav>

			<div class="account">
				<a class="view-site" href={home} target="_blank" rel="noopener">View site ↗</a>
				<form method="POST" action="/admin/logout">
					<button type="submit">Sign out</button>
				</form>
			</div>
		</header>

		<main>
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.shell {
		min-height: 100svh;
	}

	header {
		display: flex;
		align-items: center;
		gap: 2rem;
		padding: 0 1.5rem;
		height: 3.5rem;
		background: var(--color-surface-raised);
		border-bottom: 1px solid var(--color-hairline);
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.brand {
		font-weight: 600;
		font-size: 0.95rem;
		letter-spacing: -0.01em;
		text-decoration: none;
		color: var(--color-ink);
	}

	nav {
		display: flex;
		gap: 1.25rem;
		margin-right: auto;
	}

	nav a {
		font-size: 0.875rem;
		text-decoration: none;
		color: var(--color-ink-muted);
		padding-block: 0.25rem;
		border-bottom: 1.5px solid transparent;
	}

	nav a:hover {
		color: var(--color-ink);
	}

	nav a[aria-current='page'] {
		color: var(--color-ink);
		border-bottom-color: var(--color-ink);
	}

	.account {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.view-site {
		font-size: 0.8rem;
		color: var(--color-ink-subtle);
		text-decoration: none;
	}

	.view-site:hover {
		color: var(--color-ink);
	}

	.account button {
		font: inherit;
		font-size: 0.8rem;
		color: var(--color-ink-subtle);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
	}

	.account button:hover {
		color: var(--color-ink);
	}

	main {
		max-width: 62rem;
		margin-inline: auto;
		padding: 2.5rem 1.5rem 6rem;
	}
</style>
