<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { entrance } from '$lib/motion/entrance';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const headEntrance = entrance({ stagger: '.head > *' });

	/** "3 days" rather than a date: what matters is how long is left. */
	function daysUntil(when: Date | null): string {
		if (!when) return '';
		const days = Math.ceil((when.getTime() - Date.now()) / 86_400_000);
		if (days <= 0) return 'due to be deleted';
		return `deleted in ${days} day${days === 1 ? '' : 's'}`;
	}

	function discardedOn(when: Date | null): string {
		if (!when) return '';
		return when.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
	}
</script>

<svelte:head>
	<title>Trash</title>
	<!-- Nothing here is public, and a discarded collection is the last thing that
	     should be indexed. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="head" {@attach headEntrance}>
	<a class="back" href={resolve('/')}>← Back to the gallery</a>
	<h1>Trash</h1>
	<p class="hint">
		Collections stay here for {data.retentionDays} days, then they and their photographs are deleted for
		good. Until then nothing has been lost.
	</p>
</div>

{#if form?.restored}
	<p class="notice" role="status">
		Restored <strong>{form.restored}</strong>.
		{#if form.renamed}
			Its old address was taken, so it is now at <code>/c/{form.slug}</code>.
		{:else}
			It is back at <code>/c/{form.slug}</code>.
		{/if}
	</p>
{:else if form?.purged}
	<p class="notice" role="status">Deleted for good.</p>
{:else if form?.message}
	<p class="notice error" role="alert">{form.message}</p>
{/if}

{#if data.collections.length === 0}
	<p class="empty">The trash is empty.</p>
{:else}
	<ul class="items">
		{#each data.collections as collection (collection.id)}
			<li>
				<div class="what">
					<h2>{collection.title}</h2>
					<p class="meta">
						{collection.photoCount}
						{collection.photoCount === 1 ? 'photograph' : 'photographs'}
						<span class="sep">·</span>
						discarded {discardedOn(collection.deletedAt)}
						<span class="sep">·</span>
						<span class="countdown">{daysUntil(collection.purgesAt)}</span>
					</p>
				</div>

				<div class="actions">
					<form method="POST" action="?/restore" use:enhance>
						<input type="hidden" name="id" value={collection.id} />
						<button type="submit" class="primary">Restore</button>
					</form>

					<!--
						No confirmation step on this one, deliberately: it is already
						behind the decision to discard the collection in the first place,
						and it is the only button here that destroys anything.
						Reconsidered if it ever bites — but a second dialog inside a page
						called Trash mostly teaches people to click through dialogs.
					-->
					<form method="POST" action="?/purge" use:enhance>
						<input type="hidden" name="id" value={collection.id} />
						<button type="submit" class="danger">Delete for good</button>
					</form>
				</div>
			</li>
		{/each}
	</ul>

	<form class="empty-all" method="POST" action="?/empty" use:enhance>
		<button type="submit" class="danger-solid">Empty the trash</button>
	</form>
{/if}

<style>
	.head,
	.items,
	.empty,
	.notice,
	.empty-all {
		max-width: 78rem;
		margin: 0 auto;
		padding: 0 1.5rem;
	}

	.head {
		padding-top: 2rem;
	}

	.back {
		display: inline-block;
		font-size: 0.85rem;
		color: var(--color-ink-muted);
		text-decoration: none;
		margin-bottom: 1rem;
	}

	.back:hover {
		color: var(--color-ink);
	}

	h1 {
		font-size: 1.6rem;
		margin: 0 0 0.4rem;
	}

	.hint,
	.meta,
	.empty {
		color: var(--color-ink-muted);
		font-size: 0.9rem;
	}

	.hint {
		max-width: 42rem;
		margin: 0 0 2rem;
	}

	.empty {
		padding-top: 2rem;
		padding-bottom: 4rem;
	}

	.notice {
		margin-bottom: 1.5rem;
		font-size: 0.9rem;
	}

	.notice.error {
		color: var(--color-danger, #b42318);
	}

	.items {
		list-style: none;
		margin: 0;
		padding-left: 1.5rem;
		padding-right: 1.5rem;
	}

	.items li {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 0;
		border-top: 1px solid var(--color-hairline);
	}

	.items li:last-child {
		border-bottom: 1px solid var(--color-hairline);
	}

	h2 {
		font-size: 1rem;
		font-weight: 500;
		margin: 0 0 0.2rem;
	}

	.meta {
		margin: 0;
	}

	.sep {
		opacity: 0.5;
		margin: 0 0.35rem;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}

	/* Square corners, matching the rest of the admin controls. */
	button {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--color-hairline);
		background: none;
		color: var(--color-ink-muted);
		cursor: pointer;
	}

	button:hover {
		background: var(--color-surface-sunken);
		color: var(--color-ink);
	}

	.primary {
		border-color: var(--color-ink);
		background: var(--color-ink);
		color: var(--color-surface-raised);
	}

	.danger:hover {
		color: var(--color-danger, #b42318);
		border-color: currentColor;
		background: none;
	}

	.empty-all {
		margin-top: 2rem;
		margin-bottom: 4rem;
	}

	.danger-solid {
		border-color: var(--color-danger, #b42318);
		color: var(--color-danger, #b42318);
	}

	.danger-solid:hover {
		background: var(--color-danger, #b42318);
		color: var(--color-surface-raised);
	}
</style>
