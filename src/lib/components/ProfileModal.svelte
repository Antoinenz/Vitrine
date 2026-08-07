<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from './Modal.svelte';
	import type { ProfileView, AvatarCandidate } from '$lib/server/actions/profile';

	/**
	 * Editing the artist's introduction, from the page it appears on.
	 *
	 * Only what the top of the artist page shows, plus the one site-wide choice
	 * that governs the collections beneath it. The footer's note, links and
	 * licence live on the settings page instead — they are not part of this
	 * header, and a form that posted them together would have to render every
	 * field or silently blank the ones it omitted.
	 */
	let {
		open,
		onClose,
		profile,
		candidates,
		message = null,
		saved = false
	}: {
		open: boolean;
		onClose: () => void;
		profile: ProfileView;
		candidates: AvatarCandidate[];
		message?: string | null;
		saved?: boolean;
	} = $props();

	/**
	 * A writable `$derived`: reassignable like `$state`, but re-seeded whenever
	 * the server sends a new profile — after a save the response is the
	 * authoritative list, with blank rows dropped and URLs normalised.
	 */
	let links = $derived([...profile.socialLinks, { label: '', url: '' }]);

	let busy = $state(false);

	function addLink() {
		if (links.length < 8) links.push({ label: '', url: '' });
	}

	function removeLink(index: number) {
		links.splice(index, 1);
		if (links.length === 0) links.push({ label: '', url: '' });
	}
</script>

<Modal {open} {onClose} title="Edit profile">
	<form
		method="POST"
		action="/?/profile"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
	>
		{#if message}
			<p class="error" role="alert">{message}</p>
		{:else if saved}
			<p class="ok" role="status">Saved.</p>
		{/if}

		<div class="row">
			<label for="displayName">Display name</label>
			<input id="displayName" name="displayName" value={profile.displayName} maxlength="120" />
		</div>

		<div class="row">
			<label for="bio">About</label>
			<textarea id="bio" name="bio" rows="4" maxlength="2000">{profile.bio}</textarea>
			<p class="hint">A short introduction. Two or three sentences works well.</p>
		</div>

		<div class="row">
			<label for="avatarPhotoId">Portrait</label>
			<div class="avatar-row">
				{#if profile.avatarPhotoId}
					<!-- The modal is built once and kept in the DOM, so this must not
						     fetch until it is actually opened. -->
					<img
						class="avatar"
						src="/i/{profile.avatarPhotoId}/320.webp"
						alt=""
						loading="lazy"
						decoding="async"
					/>
				{/if}
				<select id="avatarPhotoId" name="avatarPhotoId" value={profile.avatarPhotoId ?? ''}>
					<option value="">None</option>
					{#each candidates as photo (photo.id)}
						<option value={photo.id}>{photo.collection} — {photo.originalName}</option>
					{/each}
				</select>
			</div>
			<!--
				Says why the list may look short. The portrait is served through the
				image route, which enforces collection access, so one taken from a
				private collection would be a broken image for every visitor — and
				never for the artist, who is always granted access.
			-->
			<p class="hint">Chosen from a photograph in a public collection.</p>
		</div>

		<div class="row">
			<label for="accentColor">Accent colour</label>
			<input
				id="accentColor"
				name="accentColor"
				type="color"
				value={profile.accentColor}
				class="colour"
			/>
			<p class="hint">Used for links and focus outlines.</p>
		</div>

		<fieldset class="row">
			<legend>Collection order</legend>
			<label class="choice">
				<input
					type="radio"
					name="collectionOrder"
					value="date"
					checked={profile.collectionOrder === 'date'}
				/>
				<span>
					By date, newest first
					<span class="hint">Uses the date you give each collection.</span>
				</span>
			</label>
			<label class="choice">
				<input
					type="radio"
					name="collectionOrder"
					value="custom"
					checked={profile.collectionOrder === 'custom'}
				/>
				<span>
					Custom
					<!--
						Honest about what this currently does. Collections have never had a
						drag-to-arrange editor — `sortKey` is only ever written at creation
						— so "custom" today means the order they were made in. The editor
						arrives with the per-photo editing pass.
					-->
					<span class="hint">The order you created them in. Rearranging comes later.</span>
				</span>
			</label>
		</fieldset>

		<div class="row">
			<span class="label">Links</span>
			{#each links as link, i (i)}
				<div class="link-row">
					<input name="linkLabel" placeholder="Label" value={link.label} maxlength="40" />
					<input name="linkUrl" placeholder="https://" value={link.url} type="url" />
					<button
						type="button"
						class="remove"
						onclick={() => removeLink(i)}
						aria-label="Remove link">×</button
					>
				</div>
			{/each}
			{#if links.length < 8}
				<button type="button" class="ghost small" onclick={addLink}>Add link</button>
			{/if}
		</div>

		<div class="actions">
			<!--
				"Cancel", not "Close" — it dismisses without saving, so it must not
				imply the edits in the fields were kept. It also can't share a name
				with the × in the header, which is a second control doing the same
				thing and would make "the Close button" ambiguous to a screen reader
				and to a test alike.
			-->
			<button type="button" class="ghost" onclick={onClose}>Cancel</button>
			<button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
		</div>
	</form>
</Modal>

<style>
	.row {
		margin-bottom: 1.1rem;
	}

	label,
	.label,
	legend {
		display: block;
		font-size: 0.8rem;
		color: var(--color-ink-muted);
		margin-bottom: 0.35rem;
		padding: 0;
	}

	fieldset {
		border: 0;
		margin: 0 0 1.1rem;
		padding: 0;
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

	input:focus-visible,
	textarea:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}

	textarea {
		resize: vertical;
	}

	.colour {
		width: 4rem;
		padding: 0.2rem;
		height: 2.2rem;
	}

	.avatar-row {
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

	.choice {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
		font-size: 0.9rem;
		color: var(--color-ink);
	}

	.choice input {
		width: auto;
		margin-top: 0.15rem;
		flex: none;
	}

	.hint {
		display: block;
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: var(--color-ink-subtle);
	}

	.link-row {
		display: grid;
		grid-template-columns: 1fr 1.6fr auto;
		gap: 0.4rem;
		margin-bottom: 0.4rem;
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

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-hairline);
	}

	/* Square corners — a print has edges, not radii. */
	button {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--color-ink);
		background: var(--color-ink);
		color: var(--color-surface-raised);
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: var(--color-ink-muted);
		border-color: var(--color-ink-muted);
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.ghost {
		background: none;
		border-color: var(--color-hairline);
		color: var(--color-ink-muted);
	}

	.ghost:hover:not(:disabled) {
		background: var(--color-surface-sunken);
		color: var(--color-ink);
		border-color: var(--color-hairline);
	}

	.small {
		font-size: 0.78rem;
		padding: 0.3rem 0.6rem;
	}

	.remove {
		padding: 0 0.5rem;
		font-size: 1.1rem;
		line-height: 1;
		background: none;
		border: 1px solid var(--color-hairline);
		color: var(--color-ink-subtle);
	}

	.remove:hover {
		background: var(--color-surface-sunken);
		color: var(--color-ink);
		border-color: var(--color-hairline);
	}
</style>
