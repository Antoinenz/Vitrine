<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/**
	 * A writable `$derived`: re-seeded whenever the server sends a new profile, so
	 * after a save the authoritative list is shown — blank rows dropped, URLs
	 * normalised — rather than the pre-save state.
	 */
	let footerLinks = $derived([...data.profile.footerLinks, { label: '', url: '' }]);

	/** Which legal page is expanded. Only one at a time; they are long. */
	let openPage = $state<string | null>(null);

	function addFooterLink() {
		if (footerLinks.length < 8) footerLinks.push({ label: '', url: '' });
	}

	function removeFooterLink(index: number) {
		footerLinks.splice(index, 1);
		if (footerLinks.length === 0) footerLinks.push({ label: '', url: '' });
	}
</script>

<svelte:head>
	<title>Site settings</title>
	<!-- Owner-only, and guarded server-side; there is simply no reason for it to
	     turn up in a search result. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap">
	<header class="head">
		<h1>Site settings</h1>
		<p class="lede">
			The footer, and the pages it links to. Your name, portrait and collection order are edited on <a
				href={resolve('/')}>your gallery</a
			>.
		</p>
	</header>

	<section>
		<h2>Footer</h2>

		{#if form?.scope === 'footer' && form.message}
			<p class="error" role="alert">{form.message}</p>
		{:else if form?.scope === 'footer' && form.saved}
			<p class="ok" role="status">Saved.</p>
		{/if}

		<form method="POST" action="?/footer" use:enhance>
			<div class="row">
				<label for="footerNote">Note</label>
				<input
					id="footerNote"
					name="footerNote"
					value={data.profile.footerNote}
					maxlength="300"
					placeholder="Optional line beneath the copyright"
				/>
			</div>

			<div class="row">
				<label for="licence">Licence</label>
				<select id="licence" name="licence" value={data.profile.licence}>
					{#each data.licences as licence (licence.id)}
						<option value={licence.id}>{licence.label}</option>
					{/each}
				</select>
				<p class="hint">
					Shown in the footer, linked to the licensor's own wording rather than a paraphrase.
				</p>
			</div>

			<div class="row">
				<span class="label">Footer links</span>
				{#each footerLinks as link, i (i)}
					<div class="link-row">
						<input name="footerLinkLabel" placeholder="Label" value={link.label} maxlength="40" />
						<input name="footerLinkUrl" placeholder="https://" value={link.url} type="url" />
						<button
							type="button"
							class="remove"
							onclick={() => removeFooterLink(i)}
							aria-label="Remove link">×</button
						>
					</div>
				{/each}
				{#if footerLinks.length < 8}
					<button type="button" class="ghost small" onclick={addFooterLink}>Add link</button>
				{/if}
			</div>

			<button type="submit">Save footer</button>
		</form>
	</section>

	<section>
		<h2>Legal pages</h2>
		<p class="hint">
			<!-- Only pages with content are advertised, so the footer never links to
			     something the operator hasn't written. -->
			A page appears in the footer once it has content. Each comes with a template, offered rather than
			saved — nothing is published until you have read it.
		</p>

		{#if form?.scope === 'page' && form.message}
			<p class="error" role="alert">{form.message}</p>
		{:else if form?.scope === 'page' && form.saved}
			<p class="ok" role="status">Saved.</p>
		{/if}

		{#each data.pages as legal (legal.slug)}
			<div class="page">
				<button
					type="button"
					class="page-head"
					aria-expanded={openPage === legal.slug}
					onclick={() => (openPage = openPage === legal.slug ? null : legal.slug)}
				>
					<span class="page-title">{legal.title}</span>
					<span class="state">{legal.published ? 'Published' : 'Not published'}</span>
				</button>

				{#if openPage === legal.slug}
					<form method="POST" action="?/savePage" use:enhance>
						<input type="hidden" name="slug" value={legal.slug} />

						<div class="row">
							<label for="title-{legal.slug}">Title</label>
							<input id="title-{legal.slug}" name="title" value={legal.title} maxlength="120" />
						</div>

						<div class="row">
							<label for="content-{legal.slug}">Content</label>
							<textarea id="content-{legal.slug}" name="content" rows="16" maxlength="40000"
								>{legal.content || legal.template}</textarea
							>
							{#if !legal.content}
								<p class="hint">
									Pre-filled with the template. Read it through and edit it before saving — it is a
									starting point, not advice.
								</p>
							{/if}
						</div>

						<div class="page-actions">
							{#if legal.published}
								<a href={resolve('/(legal)/[legalSlug]', { legalSlug: legal.slug })} target="_blank"
									>View ↗</a
								>
							{/if}
							<button type="submit">Save page</button>
						</div>
					</form>
				{/if}
			</div>
		{/each}
	</section>
</div>

<style>
	.wrap {
		max-width: 46rem;
		margin: 0 auto;
		padding: 3rem 1.5rem 6rem;
	}

	.head {
		margin-bottom: 2.5rem;
	}

	h1 {
		margin: 0 0 0.4rem;
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	h2 {
		margin: 0 0 1rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.lede {
		margin: 0;
		color: var(--color-ink-muted);
		font-size: 0.9rem;
	}

	section {
		margin-bottom: 3rem;
		padding-top: 1.75rem;
		border-top: 1px solid var(--color-hairline);
	}

	.row {
		margin-bottom: 1.1rem;
	}

	label,
	.label {
		display: block;
		font-size: 0.8rem;
		color: var(--color-ink-muted);
		margin-bottom: 0.35rem;
	}

	input,
	textarea,
	select {
		width: 100%;
		font: inherit;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--color-hairline);
		background: var(--color-surface);
		color: var(--color-ink);
	}

	textarea {
		font-size: 0.85rem;
		line-height: 1.6;
		resize: vertical;
	}

	input:focus-visible,
	textarea:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}

	.link-row {
		display: grid;
		grid-template-columns: 1fr 1.6fr auto;
		gap: 0.4rem;
		margin-bottom: 0.4rem;
	}

	.hint {
		margin: 0.3rem 0 0;
		font-size: 0.75rem;
		color: var(--color-ink-subtle);
		text-wrap: pretty;
	}

	.error,
	.ok {
		margin: 0 0 0.9rem;
		font-size: 0.8rem;
	}

	.error {
		color: #b3261e;
	}

	.ok {
		color: #1c6b39;
	}

	.page {
		border: 1px solid var(--color-hairline);
		margin-bottom: 0.6rem;
	}

	.page-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.75rem 0.9rem;
		font: inherit;
		font-size: 0.9rem;
		background: none;
		border: 0;
		color: var(--color-ink);
		cursor: pointer;
		text-align: left;
	}

	.page-head:hover {
		background: var(--color-surface-sunken);
	}

	.state {
		font-size: 0.75rem;
		color: var(--color-ink-subtle);
	}

	.page form {
		padding: 0 0.9rem 0.9rem;
		border-top: 1px solid var(--color-hairline);
	}

	.page .row {
		margin-top: 1rem;
	}

	.page-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.page-actions a {
		font-size: 0.8rem;
		color: var(--color-ink-muted);
	}

	/* Square corners — a print has edges, not radii. */
	button[type='submit'] {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--color-ink);
		background: var(--color-ink);
		color: var(--color-surface-raised);
		cursor: pointer;
	}

	button[type='submit']:hover {
		background: var(--color-ink-muted);
		border-color: var(--color-ink-muted);
	}

	.ghost {
		font: inherit;
		padding: 0.3rem 0.6rem;
		font-size: 0.78rem;
		background: none;
		border: 1px solid var(--color-hairline);
		color: var(--color-ink-muted);
		cursor: pointer;
	}

	.ghost:hover {
		background: var(--color-surface-sunken);
		color: var(--color-ink);
	}

	.remove {
		padding: 0 0.5rem;
		font-size: 1.1rem;
		line-height: 1;
		background: none;
		border: 1px solid var(--color-hairline);
		color: var(--color-ink-subtle);
		cursor: pointer;
	}

	.remove:hover {
		background: var(--color-surface-sunken);
		color: var(--color-ink);
	}
</style>
