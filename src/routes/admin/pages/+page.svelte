<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Editable copies, re-seeded whenever the server sends a new version.
	let drafts = $derived(Object.fromEntries(data.pages.map((p) => [p.slug, p.content])));
</script>

<svelte:head>
	<title>Pages · Vitrine</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<h1>Pages</h1>
<p class="lede">
	Terms and privacy, linked from the footer. A page stays hidden until you write something in it.
</p>

<p class="warning">
	The starter text is a template, not legal advice. What these pages need to say depends on where
	you are and what you collect — read them, edit them, and if anything matters to you, have someone
	qualified check them.
</p>

{#each data.pages as page (page.slug)}
	<section>
		<header>
			<h2>{page.title}</h2>
			{#if page.published}
				<a
					href={resolve('/(legal)/[legalSlug]', { legalSlug: page.slug })}
					target="_blank"
					rel="noopener"
				>
					View ↗
				</a>
			{:else}
				<span class="hidden-tag">Not published</span>
			{/if}
		</header>

		<form method="POST" action="?/save" use:enhance>
			<input type="hidden" name="slug" value={page.slug} />

			<label for="title-{page.slug}">Title</label>
			<input id="title-{page.slug}" name="title" value={page.title} maxlength="120" />

			<label for="content-{page.slug}">Content</label>
			<textarea id="content-{page.slug}" name="content" rows="14" bind:value={drafts[page.slug]}
			></textarea>
			<p class="hint">
				Start a line with <code>#</code> for a heading. Leave a blank line between paragraphs.
			</p>

			<div class="actions">
				<button type="submit" class="primary">Save</button>
				<button
					type="button"
					onclick={() => (drafts[page.slug] = page.template)}
					disabled={drafts[page.slug]?.trim().length > 0}
				>
					Insert starter text
				</button>
				{#if form?.saved === page.slug}<span class="saved">Saved</span>{/if}
			</div>
		</form>
	</section>
{/each}

<style>
	h1 {
		margin: 0 0 0.35rem;
		font-size: 1.35rem;
		font-weight: 600;
		letter-spacing: -0.015em;
	}

	.lede {
		margin: 0 0 1rem;
		font-size: 0.875rem;
		color: var(--color-ink-muted);
	}

	.warning {
		max-width: 42rem;
		margin: 0 0 2.5rem;
		padding: 0.7rem 0.9rem;
		font-size: 0.8rem;
		line-height: 1.6;
		color: #7a5c14;
		background: #fbf6e8;
		border: 1px solid #e5d5ab;
		border-radius: 6px;
	}

	section {
		max-width: 42rem;
		margin-bottom: 3rem;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	h2 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}

	header a,
	.hidden-tag {
		font-size: 0.75rem;
		color: var(--color-ink-subtle);
		text-decoration: none;
	}

	form {
		display: grid;
		gap: 0.35rem;
	}

	label {
		font-size: 0.8rem;
		color: var(--color-ink-muted);
	}

	input,
	textarea {
		padding: 0.5rem 0.65rem;
		font: inherit;
		font-size: 0.9rem;
		color: var(--color-ink);
		background: var(--color-surface-raised);
		border: 1px solid var(--color-hairline);
		border-radius: 6px;
		width: 100%;
	}

	textarea {
		resize: vertical;
		line-height: 1.6;
		font-size: 0.85rem;
	}

	.hint {
		margin: 0;
		font-size: 0.72rem;
		color: var(--color-ink-subtle);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	button {
		padding: 0.5rem 0.9rem;
		font: inherit;
		font-size: 0.85rem;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-hairline);
		border-radius: 6px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.primary {
		color: var(--color-surface-raised);
		background: var(--color-ink);
		border-color: var(--color-ink);
	}

	.saved {
		font-size: 0.8rem;
		color: #1c6b39;
	}

	code {
		padding: 0.05em 0.25em;
		background: var(--color-surface-sunken);
		border-radius: 3px;
	}
</style>
