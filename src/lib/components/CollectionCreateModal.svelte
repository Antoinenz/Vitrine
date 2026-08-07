<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from './Modal.svelte';

	/**
	 * Creating a collection, from the artist page.
	 *
	 * Only a title is asked for. Everything else — description, date, visibility,
	 * the address — is edited on the collection's own page, where the artist can
	 * see what they are describing. Asking for it all up front would be a form
	 * standing between them and the thing they actually want, which is somewhere
	 * to put photographs.
	 */
	let {
		open,
		onClose,
		initialTitle = '',
		message = null
	}: {
		open: boolean;
		onClose: () => void;
		/** Pre-filled from a dropped folder's name, where there was one. */
		initialTitle?: string;
		message?: string | null;
	} = $props();

	/**
	 * Starts empty and is seeded by the effect below, rather than initialised
	 * from the prop: `$state(initialTitle)` would capture only the value at
	 * construction, and the modal is built once and reopened many times.
	 */
	let title = $state('');
	let saving = $state(false);

	/**
	 * Re-seeds the field each time the modal opens, so a folder dropped after a
	 * previous create still pre-fills. Guarded on `open` rather than tracking
	 * `initialTitle` alone, or typing over the suggestion would be undone the
	 * moment anything else re-rendered.
	 */
	$effect(() => {
		if (open) title = initialTitle;
	});
</script>

<Modal {open} {onClose} title="New collection">
	<form
		method="POST"
		action="/?/createCollection"
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update();
				saving = false;
			};
		}}
	>
		{#if message}
			<p class="error" role="alert">{message}</p>
		{/if}

		<label for="collection-title">Title</label>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			id="collection-title"
			name="title"
			bind:value={title}
			required
			maxlength="200"
			autocomplete="off"
			autofocus
		/>
		<p class="hint">You can change this, and the web address, at any time.</p>

		<div class="actions">
			<button type="button" class="ghost" onclick={onClose}>Cancel</button>
			<button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
		</div>
	</form>
</Modal>

<style>
	label {
		display: block;
		font-size: 0.8rem;
		color: var(--color-ink-muted);
		margin-bottom: 0.35rem;
	}

	input {
		width: 100%;
		font: inherit;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--color-hairline);
		background: var(--color-surface);
		color: var(--color-ink);
	}

	input:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}

	.hint {
		margin: 0.4rem 0 0;
		font-size: 0.75rem;
		color: var(--color-ink-subtle);
	}

	.error {
		margin: 0 0 0.75rem;
		font-size: 0.8rem;
		color: #b3261e;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1.25rem;
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
		border-color: var(--color-hairline);
		color: var(--color-ink);
	}
</style>
