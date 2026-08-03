<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let creating = $state(false);

	const visibilityLabel = {
		public: 'Public',
		unlisted: 'Unlisted',
		private: 'Private'
	} as const;
</script>

<svelte:head>
	<title>Collections · Vitrine</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<header class="head">
	<h1>Collections</h1>

	<form
		method="POST"
		action="?/create"
		use:enhance={() => {
			creating = true;
			return async ({ update }) => {
				await update();
				creating = false;
			};
		}}
	>
		<input name="title" placeholder="New collection title" required maxlength="200" />
		<button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create'}</button>
	</form>
</header>

{#if form?.message}
	<p class="error" role="alert">{form.message}</p>
{/if}

{#if data.collections.length === 0}
	<p class="empty">No collections yet. Create one above to start uploading photos.</p>
{:else}
	<ul>
		{#each data.collections as collection (collection.id)}
			<li>
				<a href={resolve('/admin/collections/[id]', { id: collection.id })}>
					<span class="title">{collection.title}</span>
					<span class="slug">/c/{collection.slug}</span>
				</a>

				<div class="meta">
					{#if collection.pendingCount > 0}
						<span class="badge processing">{collection.pendingCount} processing</span>
					{/if}
					<span class="count">
						{collection.photoCount}
						{collection.photoCount === 1 ? 'photo' : 'photos'}
					</span>
					{#if collection.hasPassword}
						<span class="badge">Password</span>
					{/if}
					<span class="badge visibility-{collection.visibility}">
						{visibilityLabel[collection.visibility]}
					</span>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 2rem;
	}

	h1 {
		margin: 0;
		font-size: 1.35rem;
		font-weight: 600;
		letter-spacing: -0.015em;
	}

	.head form {
		display: flex;
		gap: 0.5rem;
	}

	input {
		padding: 0.45rem 0.65rem;
		width: 15rem;
		font: inherit;
		font-size: 0.875rem;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-hairline);
		border-radius: 6px;
	}

	button {
		padding: 0.45rem 0.9rem;
		font: inherit;
		font-size: 0.875rem;
		color: var(--color-surface-raised);
		background: var(--color-ink);
		border: 0;
		border-radius: 6px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-hairline);
		border-radius: 8px;
		overflow: hidden;
		background: var(--color-surface-raised);
	}

	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1rem;
	}

	li + li {
		border-top: 1px solid var(--color-hairline);
	}

	li a {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	.title {
		font-size: 0.95rem;
		font-weight: 500;
	}

	li a:hover .title {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.slug {
		font-size: 0.75rem;
		color: var(--color-ink-subtle);
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.count {
		font-size: 0.8rem;
		color: var(--color-ink-muted);
	}

	.badge {
		padding: 0.1rem 0.45rem;
		font-size: 0.7rem;
		border-radius: 99px;
		border: 1px solid var(--color-hairline);
		color: var(--color-ink-muted);
		white-space: nowrap;
	}

	.visibility-public {
		border-color: #b7dfc4;
		background: #eef8f1;
		color: #1c6b39;
	}

	.visibility-unlisted {
		border-color: #e5d5ab;
		background: #fbf6e8;
		color: #7a5c14;
	}

	.processing {
		border-color: #cdd9ef;
		background: #eef2fb;
		color: #2c4a80;
	}

	.empty,
	.error {
		font-size: 0.9rem;
		color: var(--color-ink-muted);
	}

	.error {
		color: #b3261e;
	}
</style>
