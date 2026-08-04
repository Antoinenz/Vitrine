<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/**
	 * Editable copy of the saved links, with one blank row so there's always
	 * somewhere to type without hunting for an "add" button first.
	 *
	 * Re-seeded whenever the server sends a new profile — after a save, the
	 * response is the authoritative list (blank rows dropped, URLs normalised),
	 * and leaving the local copy in place would show the pre-save state.
	 */
	// A writable `$derived`: reassignable like `$state`, but re-seeded whenever
	// the server sends a new profile. `$state` + `$effect` would do the same
	// thing with an extra render pass and a chance of clobbering mid-edit.
	let links = $derived([...data.profile.socialLinks, { label: '', url: '' }]);
	let footerLinks = $derived([...data.profile.footerLinks, { label: '', url: '' }]);

	const chosenLicence = $derived(
		data.licences.find((l) => l.id === data.profile.licence) ?? data.licences[0]
	);

	function addLink() {
		if (links.length < 8) links.push({ label: '', url: '' });
	}

	function addFooterLink() {
		if (footerLinks.length < 8) footerLinks.push({ label: '', url: '' });
	}

	function removeFooterLink(index: number) {
		footerLinks.splice(index, 1);
		if (footerLinks.length === 0) footerLinks.push({ label: '', url: '' });
	}

	function removeLink(index: number) {
		links.splice(index, 1);
		if (links.length === 0) links.push({ label: '', url: '' });
	}
</script>

<svelte:head>
	<title>Profile · Vitrine</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<h1>Profile</h1>
<p class="lede">This appears at the top of your public page.</p>

{#if form?.message}
	<p class="error" role="alert">{form.message}</p>
{/if}

<form method="POST" use:enhance>
	<div class="row">
		<label for="displayName">Display name</label>
		<input id="displayName" name="displayName" value={data.profile.displayName} maxlength="120" />
	</div>

	<div class="row">
		<label for="bio">About</label>
		<textarea id="bio" name="bio" rows="4" maxlength="2000">{data.profile.bio}</textarea>
		<p class="hint">A short introduction. Two or three sentences works well.</p>
	</div>

	<div class="row">
		<label for="avatarPhotoId">Portrait</label>
		{#if data.candidates.length === 0}
			<p class="hint">
				Upload a photo to a collection first — you can then choose one here as your portrait.
			</p>
		{:else}
			<div class="avatar-row">
				{#if data.profile.avatarPhotoId}
					<img
						class="avatar"
						src="/i/{data.profile.avatarPhotoId}/320.webp"
						alt="Current portrait"
					/>
				{/if}
				<select id="avatarPhotoId" name="avatarPhotoId" value={data.profile.avatarPhotoId ?? ''}>
					<option value="">No portrait</option>
					{#each data.candidates as photo (photo.id)}
						<option value={photo.id}>{photo.collection} — {photo.originalName}</option>
					{/each}
				</select>
			</div>
		{/if}
	</div>

	<div class="row">
		<label for="accentColor">Accent colour</label>
		<div class="colour-row">
			<input
				id="accentColor"
				name="accentColor"
				type="color"
				value={data.profile.accentColor}
				class="swatch"
			/>
			<span class="hint">Used for links and focus outlines.</span>
		</div>
	</div>

	<fieldset>
		<legend>Links</legend>
		{#each links as link, i (i)}
			<div class="link-row">
				<input
					name="linkLabel"
					placeholder="Instagram"
					bind:value={link.label}
					maxlength="40"
					aria-label="Link label"
				/>
				<input
					name="linkUrl"
					type="url"
					placeholder="https://instagram.com/you"
					bind:value={link.url}
					aria-label="Link URL"
				/>
				<button type="button" onclick={() => removeLink(i)} aria-label="Remove link">×</button>
			</div>
		{/each}

		{#if links.length < 8}
			<button type="button" class="add" onclick={addLink}>Add another link</button>
		{/if}
	</fieldset>

	<fieldset>
		<legend>Licence</legend>
		<p class="hint">
			Shown in the footer. Anything other than “All rights reserved” links to the licence’s own
			terms, so visitors read the wording that actually applies.
		</p>
		<select name="licence" value={data.profile.licence}>
			{#each data.licences as licence (licence.id)}
				<option value={licence.id}>{licence.label}</option>
			{/each}
		</select>
		<p class="hint">{chosenLicence.summary}</p>
	</fieldset>

	<fieldset>
		<legend>Footer</legend>

		<label for="footerNote">Note</label>
		<input
			id="footerNote"
			name="footerNote"
			value={data.profile.footerNote}
			maxlength="300"
			placeholder="Prints and licensing: hello@example.com"
		/>

		<p class="hint">Extra links, shown beside Terms and Privacy.</p>
		{#each footerLinks as link, i (i)}
			<div class="link-row">
				<input
					name="footerLinkLabel"
					placeholder="Stockists"
					bind:value={link.label}
					maxlength="40"
					aria-label="Footer link label"
				/>
				<input
					name="footerLinkUrl"
					type="url"
					placeholder="https://example.com"
					bind:value={link.url}
					aria-label="Footer link URL"
				/>
				<button type="button" onclick={() => removeFooterLink(i)} aria-label="Remove footer link">
					×
				</button>
			</div>
		{/each}
		{#if footerLinks.length < 8}
			<button type="button" class="add" onclick={addFooterLink}>Add another link</button>
		{/if}
	</fieldset>

	<div class="actions">
		<button type="submit" class="primary">Save profile</button>
		{#if form?.saved}<span class="saved">Saved</span>{/if}
	</div>
</form>

<style>
	h1 {
		margin: 0 0 0.35rem;
		font-size: 1.35rem;
		font-weight: 600;
		letter-spacing: -0.015em;
	}

	.lede {
		margin: 0 0 2rem;
		font-size: 0.875rem;
		color: var(--color-ink-muted);
	}

	form {
		display: grid;
		gap: 1.35rem;
		max-width: 34rem;
	}

	.row {
		display: grid;
		gap: 0.35rem;
	}

	label,
	legend {
		font-size: 0.8rem;
		color: var(--color-ink-muted);
	}

	input,
	textarea,
	select {
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
	}

	.avatar-row,
	.colour-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.avatar {
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}

	.swatch {
		width: 3rem;
		height: 2rem;
		padding: 2px;
	}

	fieldset {
		border: 1px solid var(--color-hairline);
		border-radius: 8px;
		padding: 0.9rem 1rem;
		margin: 0;
		display: grid;
		gap: 0.5rem;
		background: var(--color-surface-raised);
	}

	.link-row {
		display: grid;
		grid-template-columns: 9rem 1fr auto;
		gap: 0.5rem;
		align-items: center;
	}

	.link-row button {
		font: inherit;
		font-size: 1rem;
		line-height: 1;
		color: var(--color-ink-subtle);
		background: none;
		border: 0;
		padding: 0.25rem 0.4rem;
		cursor: pointer;
	}

	.link-row button:hover {
		color: #b3261e;
	}

	.add {
		justify-self: start;
		font: inherit;
		font-size: 0.78rem;
		color: var(--color-ink-muted);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
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
	}

	.primary {
		padding: 0.5rem 1rem;
		font: inherit;
		font-size: 0.875rem;
		color: var(--color-surface-raised);
		background: var(--color-ink);
		border: 0;
		border-radius: 6px;
		cursor: pointer;
	}

	.saved {
		font-size: 0.8rem;
		color: #1c6b39;
	}

	.error {
		font-size: 0.85rem;
		color: #b3261e;
	}
</style>
