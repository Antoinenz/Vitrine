<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from './Modal.svelte';
	import { VISIBILITY_OPTIONS } from '$lib/visibility';
	import type { Visibility } from '$lib/server/db/schema';

	/**
	 * Choosing who can see a collection.
	 *
	 * Radio buttons rather than a `<select>`, despite the shape of the request.
	 * There are three options, each needing a sentence to explain it, and the
	 * consequence of the wrong one is publishing work that was not meant to be
	 * published — which is the case for showing all three and what they mean at
	 * once, instead of one at a time behind a click.
	 */
	let {
		open,
		collection,
		onClose
	}: {
		open: boolean;
		collection: { id: string; title: string; visibility: Visibility } | null;
		onClose: () => void;
	} = $props();

	let chosen = $state<Visibility>('private');

	// Re-seeded each time it opens: one dialog is reused for every collection.
	$effect(() => {
		if (open && collection) chosen = collection.visibility;
	});
</script>

<Modal {open} {onClose} title="Who can see this?">
	{#if collection}
		<form
			method="POST"
			action="?/setVisibility"
			use:enhance={() =>
				async ({ update }) => {
					await update({ reset: false });
					onClose();
				}}
		>
			<input type="hidden" name="id" value={collection.id} />

			<p class="what">{collection.title}</p>

			<ul class="options">
				{#each VISIBILITY_OPTIONS as option (option.value)}
					<li>
						<label>
							<input
								type="radio"
								name="visibility"
								value={option.value}
								checked={chosen === option.value}
								onchange={() => (chosen = option.value)}
							/>
							<span class="label">{option.label}</span>
							<span class="hint">{option.hint}</span>
						</label>
					</li>
				{/each}
			</ul>

			<div class="actions">
				<button type="button" onclick={onClose}>Cancel</button>
				<button type="submit" class="primary">Save</button>
			</div>
		</form>
	{/if}
</Modal>

<style>
	.what {
		margin: 0 0 1rem;
		font-weight: 500;
	}

	.options {
		list-style: none;
		margin: 0 0 1.5rem;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}

	label {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0 0.6rem;
		align-items: baseline;
		cursor: pointer;
	}

	.label {
		font-weight: 500;
	}

	.hint {
		grid-column: 2;
		font-size: 0.85rem;
		color: var(--color-ink-muted);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	button {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.4rem 0.9rem;
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
</style>
