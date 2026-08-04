<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Uploader from '$lib/components/Uploader.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let confirmingDelete = $state(false);
	let editingPhoto = $state<string | null>(null);

	// --- reordering ---------------------------------------------------------

	let dragId = $state<string | null>(null);
	let dropBeforeId = $state<string | null>(null);
	let reorderForm = $state<HTMLFormElement>();
	let moveFields = $state({ photoId: '', beforeId: '', afterId: '' });

	/**
	 * Submits a move through a hidden form rather than `fetch`.
	 *
	 * Reusing the same `use:enhance` path as every other action means the page
	 * data is reloaded and the grid re-sorts itself from the server's answer, so
	 * the displayed order is always the stored order rather than an optimistic
	 * guess that could drift from it.
	 */
	function commitMove(photoId: string, toIndex: number) {
		const others = data.photos.filter((p) => p.id !== photoId);
		const clamped = Math.max(0, Math.min(others.length, toIndex));

		moveFields = {
			photoId,
			beforeId: others[clamped - 1]?.id ?? '',
			afterId: others[clamped]?.id ?? ''
		};
		// Wait for the hidden inputs to render with the new values.
		tick().then(() => reorderForm?.requestSubmit());
	}

	/** Index a photo would land at if dropped on `targetId`. */
	function dropIndex(draggedId: string, targetId: string): number {
		const others = data.photos.filter((p) => p.id !== draggedId);
		const target = others.findIndex((p) => p.id === targetId);
		return target === -1 ? others.length : target;
	}

	function moveBy(photoId: string, delta: number) {
		const from = data.photos.findIndex((p) => p.id === photoId);
		if (from === -1) return;
		const to = from + delta;
		if (to < 0 || to >= data.photos.length) return;

		/**
		 * `commitMove` indexes into the list with this photograph *removed*, and
		 * that removal already shifts everything after it down by one — so
		 * `from + delta` is the right destination in both directions, with no
		 * separate adjustment for moving right.
		 */
		commitMove(photoId, to);
	}

	const c = $derived(data.collection);

	const FIELD_LABELS: Record<string, string> = {
		camera: 'Camera',
		lens: 'Lens',
		focalLength: 'Focal length',
		aperture: 'Aperture',
		shutterSpeed: 'Shutter speed',
		iso: 'ISO',
		takenAt: 'Date taken',
		location: 'Location'
	};

	function humanSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<svelte:head>
	<title>{c.title} · Vitrine</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<nav class="crumbs">
	<a href={resolve('/admin/collections')}>Collections</a> <span>/</span>
	{c.title}
</nav>

<header class="head">
	<h1>{c.title}</h1>
	<a class="preview" href={resolve('/c/[slug]', { slug: c.slug })} target="_blank" rel="noopener">
		/c/{c.slug} ↗
	</a>
</header>

{#if form?.message}
	<p class="error" role="alert">{form.message}</p>
{/if}

<section>
	<h2>Photos</h2>
	<Uploader collectionId={c.id} />

	<form method="POST" action="?/reorder" bind:this={reorderForm} use:enhance style="display: none">
		<input type="hidden" name="photoId" value={moveFields.photoId} />
		<input type="hidden" name="beforeId" value={moveFields.beforeId} />
		<input type="hidden" name="afterId" value={moveFields.afterId} />
	</form>

	{#if data.photos.length > 0}
		<p class="reorder-hint">Drag a photograph to reorder, or use ← →.</p>
		<ul class="grid">
			{#each data.photos as photo, i (photo.id)}
				<li
					draggable={photo.status === 'ready'}
					class:dragging={dragId === photo.id}
					class:drop-target={dropBeforeId === photo.id}
					ondragstart={(e) => {
						dragId = photo.id;
						e.dataTransfer?.setData('text/plain', photo.id);
					}}
					ondragover={(e) => {
						if (!dragId || dragId === photo.id) return;
						e.preventDefault();
						dropBeforeId = photo.id;
					}}
					ondragleave={() => {
						if (dropBeforeId === photo.id) dropBeforeId = null;
					}}
					ondrop={(e) => {
						e.preventDefault();
						if (dragId && dragId !== photo.id) commitMove(dragId, dropIndex(dragId, photo.id));
						dragId = null;
						dropBeforeId = null;
					}}
					ondragend={() => {
						dragId = null;
						dropBeforeId = null;
					}}
				>
					<div
						class="thumb"
						style:background-color={photo.dominantColor ?? 'var(--color-surface-image)'}
						style:aspect-ratio={photo.width && photo.height
							? `${photo.width}/${photo.height}`
							: '1'}
					>
						{#if photo.status === 'ready'}
							<img
								src="/i/{photo.id}/320.webp"
								alt={photo.altText || photo.originalName}
								loading="lazy"
							/>
						{:else if photo.status === 'failed'}
							<span class="state failed">Failed</span>
						{:else}
							<span class="state">Processing…</span>
						{/if}

						{#if c.coverPhotoId === photo.id}
							<span class="cover-flag">Cover</span>
						{/if}
					</div>

					<div class="photo-meta">
						<span class="fname" title={photo.originalName}>{photo.originalName}</span>
						<span class="fsize">{humanSize(photo.bytes)}</span>
					</div>

					{#if photo.status === 'failed' && photo.error}
						<p class="photo-error">{photo.error}</p>
					{/if}

					<div class="photo-actions">
						<!-- Dragging is the quick path; these are the accessible one, and
						     the only one that works without a pointer. -->
						<button
							type="button"
							class="move"
							disabled={i === 0}
							aria-label="Move {photo.originalName} earlier"
							onclick={() => moveBy(photo.id, -1)}>←</button
						>
						<button
							type="button"
							class="move"
							disabled={i === data.photos.length - 1}
							aria-label="Move {photo.originalName} later"
							onclick={() => moveBy(photo.id, 1)}>→</button
						>

						<button
							type="button"
							onclick={() => (editingPhoto = editingPhoto === photo.id ? null : photo.id)}
						>
							{editingPhoto === photo.id ? 'Close' : 'Edit'}
						</button>

						{#if photo.status === 'ready' && c.coverPhotoId !== photo.id}
							<form method="POST" action="?/setCover" use:enhance>
								<input type="hidden" name="photoId" value={photo.id} />
								<button type="submit">Cover</button>
							</form>
						{/if}

						{#if photo.status === 'failed'}
							<form method="POST" action="?/retry" use:enhance>
								<input type="hidden" name="photoId" value={photo.id} />
								<button type="submit">Retry</button>
							</form>
						{/if}

						<form method="POST" action="?/deletePhoto" use:enhance>
							<input type="hidden" name="photoId" value={photo.id} />
							<button type="submit" class="danger">Delete</button>
						</form>
					</div>

					{#if editingPhoto === photo.id}
						<form
							class="caption-form"
							method="POST"
							action="?/caption"
							use:enhance={() =>
								async ({ update }) => {
									await update({ reset: false });
									editingPhoto = null;
								}}
						>
							<input type="hidden" name="photoId" value={photo.id} />
							<label for="caption-{photo.id}">Caption</label>
							<input id="caption-{photo.id}" name="caption" value={photo.caption} maxlength="500" />
							<label for="alt-{photo.id}">Alt text</label>
							<input id="alt-{photo.id}" name="altText" value={photo.altText} maxlength="500" />
							<button type="submit">Save</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h2>Settings</h2>
	<form method="POST" action="?/settings" class="settings" use:enhance>
		<div class="row">
			<label for="title">Title</label>
			<input id="title" name="title" value={c.title} required maxlength="200" />
		</div>

		<div class="row">
			<label for="slug">Address</label>
			<div class="slug-input">
				<span>/c/</span><input id="slug" name="slug" value={c.slug} />
			</div>
			<p class="hint">Changing this breaks links you've already shared.</p>
		</div>

		<div class="row">
			<label for="description">Description</label>
			<textarea id="description" name="description" rows="3" maxlength="2000"
				>{c.description}</textarea
			>
		</div>

		<div class="row">
			<label for="visibility">Visibility</label>
			<select id="visibility" name="visibility" value={c.visibility}>
				<option value="private">Private — only you</option>
				<option value="unlisted">Unlisted — anyone with the link</option>
				<option value="public">Public — listed on your page</option>
			</select>
		</div>

		<fieldset>
			<legend>Downloads</legend>
			<label class="check">
				<input type="checkbox" name="downloadsEnabled" checked={c.downloadsEnabled} />
				Allow downloading individual photos
			</label>
			<label class="check">
				<input type="checkbox" name="zipEnabled" checked={c.zipEnabled} />
				Allow downloading the whole collection as a ZIP
			</label>
			<label class="check">
				<input type="checkbox" name="stripExifOnDownload" checked={c.stripExifOnDownload} />
				Remove metadata from downloads
				<span class="hint">Re-encodes the file, so downloads won't be bit-identical originals.</span
				>
			</label>
		</fieldset>

		<fieldset>
			<legend>Visible metadata</legend>
			<p class="hint">
				Anything unchecked is never sent to a visitor's browser, not merely hidden.
			</p>
			{#each data.metadataFields as field (field)}
				<label class="check">
					<input
						type="checkbox"
						name="metadataFields"
						value={field}
						checked={c.metadataFields.includes(field)}
					/>
					{FIELD_LABELS[field] ?? field}
					{#if field === 'location'}
						<span class="hint warn">Reveals where the photo was taken.</span>
					{/if}
				</label>
			{/each}
		</fieldset>

		<button type="submit" class="primary">Save settings</button>
		{#if form?.saved}<span class="saved">Saved</span>{/if}
	</form>
</section>

<section>
	<h2>Share password</h2>
	<p class="hint">
		{#if c.hasPassword}
			This collection is password protected. Changing or clearing the password signs out everyone
			who unlocked it.
		{:else}
			Add a password to send someone a link without giving them an account.
		{/if}
	</p>

	<form method="POST" action="?/password" class="password-form" use:enhance>
		<input
			name="password"
			type="password"
			placeholder="New share password"
			minlength="6"
			autocomplete="off"
		/>
		<button type="submit">{c.hasPassword ? 'Change' : 'Set password'}</button>
		{#if c.hasPassword}
			<label class="check">
				<input type="checkbox" name="clear" />
				Remove password instead
			</label>
		{/if}
	</form>
</section>

<section class="danger-zone">
	<h2>Delete collection</h2>
	{#if confirmingDelete}
		<p class="hint">
			This permanently removes <strong>{c.title}</strong> and its
			{data.photos.length} photo{data.photos.length === 1 ? '' : 's'}. It can't be undone.
		</p>
		<div class="confirm-actions">
			<form method="POST" action="?/delete" use:enhance>
				<button type="submit" class="danger-solid">Delete permanently</button>
			</form>
			<button type="button" onclick={() => (confirmingDelete = false)}>Cancel</button>
		</div>
	{:else}
		<button type="button" class="danger-outline" onclick={() => (confirmingDelete = true)}>
			Delete this collection
		</button>
	{/if}
</section>

<style>
	.crumbs {
		font-size: 0.8rem;
		color: var(--color-ink-subtle);
		margin-bottom: 0.75rem;
	}

	.crumbs a {
		color: var(--color-ink-muted);
		text-decoration: none;
	}

	.crumbs a:hover {
		text-decoration: underline;
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 2.5rem;
	}

	h1 {
		margin: 0;
		font-size: 1.35rem;
		font-weight: 600;
		letter-spacing: -0.015em;
	}

	.preview {
		font-size: 0.8rem;
		color: var(--color-ink-subtle);
		text-decoration: none;
	}

	.preview:hover {
		color: var(--color-ink);
	}

	section {
		margin-bottom: 3rem;
	}

	h2 {
		margin: 0 0 0.9rem;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-ink-subtle);
	}

	.grid {
		list-style: none;
		margin: 1.25rem 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 1.25rem;
	}

	.thumb {
		position: relative;
		display: grid;
		place-items: center;
		border-radius: 6px;
		overflow: hidden;
		background: var(--color-surface-image);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.state {
		font-size: 0.75rem;
		color: var(--color-ink-subtle);
	}

	.state.failed {
		color: #b3261e;
	}

	.cover-flag {
		position: absolute;
		top: 0.4rem;
		left: 0.4rem;
		padding: 0.1rem 0.4rem;
		font-size: 0.65rem;
		border-radius: 99px;
		background: rgb(0 0 0 / 0.6);
		color: #fff;
	}

	.photo-meta {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 0.4rem;
		font-size: 0.72rem;
		color: var(--color-ink-subtle);
	}

	.fname {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.photo-error {
		margin: 0.25rem 0 0;
		font-size: 0.7rem;
		color: #b3261e;
	}

	.photo-actions {
		display: flex;
		gap: 0.6rem;
		margin-top: 0.35rem;
	}

	li[draggable='true'] {
		cursor: grab;
	}

	li.dragging {
		opacity: 0.4;
	}

	/* A rule down the leading edge showing where the photograph will land. */
	li.drop-target {
		box-shadow: -3px 0 0 var(--color-ink);
	}

	.reorder-hint {
		margin: 1.25rem 0 -0.5rem;
		font-size: 0.75rem;
		color: var(--color-ink-subtle);
	}

	.move {
		font-size: 0.85rem !important;
		line-height: 1;
		text-decoration: none !important;
	}

	.move:disabled {
		opacity: 0.25;
		cursor: default;
	}

	.photo-actions button {
		font: inherit;
		font-size: 0.72rem;
		color: var(--color-ink-muted);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
	}

	.photo-actions button:hover {
		color: var(--color-ink);
	}

	.photo-actions .danger:hover {
		color: #b3261e;
	}

	.caption-form {
		display: grid;
		gap: 0.25rem;
		margin-top: 0.5rem;
		padding: 0.6rem;
		background: var(--color-surface-sunken);
		border-radius: 6px;
	}

	.caption-form label {
		font-size: 0.7rem;
		color: var(--color-ink-subtle);
	}

	.settings {
		display: grid;
		gap: 1.25rem;
		max-width: 34rem;
	}

	.row {
		display: grid;
		gap: 0.35rem;
	}

	.row > label,
	fieldset legend {
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

	.slug-input {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.slug-input span {
		font-size: 0.85rem;
		color: var(--color-ink-subtle);
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

	.check {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.85rem;
	}

	.check input {
		width: auto;
	}

	.check .hint {
		grid-column: 2;
	}

	.hint {
		margin: 0;
		font-size: 0.72rem;
		color: var(--color-ink-subtle);
		line-height: 1.5;
	}

	.warn {
		color: #8a5a00;
	}

	button.primary {
		justify-self: start;
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

	.password-form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		max-width: 34rem;
	}

	.password-form input[name='password'] {
		width: 16rem;
	}

	.password-form button {
		padding: 0.5rem 0.9rem;
		font: inherit;
		font-size: 0.85rem;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-hairline);
		border-radius: 6px;
		cursor: pointer;
	}

	.danger-zone {
		border-top: 1px solid var(--color-hairline);
		padding-top: 1.5rem;
	}

	.confirm-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.danger-outline,
	.danger-solid,
	.confirm-actions > button {
		padding: 0.45rem 0.9rem;
		font: inherit;
		font-size: 0.85rem;
		border-radius: 6px;
		cursor: pointer;
	}

	.danger-outline {
		color: #b3261e;
		background: none;
		border: 1px solid #e6c3c0;
	}

	.danger-solid {
		color: #fff;
		background: #b3261e;
		border: 0;
	}

	.confirm-actions > button {
		background: none;
		border: 1px solid var(--color-hairline);
	}

	.error {
		font-size: 0.85rem;
		color: #b3261e;
	}
</style>
