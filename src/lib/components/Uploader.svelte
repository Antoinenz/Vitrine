<script lang="ts">
	import { enqueue } from '$lib/upload/queue.svelte';

	/**
	 * The button that opens a file picker.
	 *
	 * It used to own a drop zone and the queue as well. Both moved out:
	 * `UploadOverlay` takes drops anywhere in the window, and the queue lives at
	 * module level so it survives navigation. What is left is the affordance for
	 * artists who would rather choose files than drag them, and — in the `centre`
	 * variant — the thing an empty collection is mostly made of.
	 *
	 * It deliberately does **not** accept drops. One drop target per page is a
	 * design constraint, not an oversight: two handlers competing over
	 * propagation produce a drop that works everywhere except on the element that
	 * looks most like a drop zone.
	 */
	let {
		slug,
		variant = 'compact'
	}: {
		slug: string;
		/** `centre` is the empty-collection affordance; `compact` sits in a header. */
		variant?: 'centre' | 'compact';
	} = $props();

	let inputEl: HTMLInputElement;
</script>

<div class="uploader" class:centre={variant === 'centre'}>
	{#if variant === 'centre'}
		<p class="lead">No photographs yet</p>
		<p class="hint">Drop them anywhere on this page, or</p>
	{/if}

	<button type="button" onclick={() => inputEl.click()}>
		{variant === 'centre' ? 'Choose files' : 'Upload photos'}
	</button>

	{#if variant === 'centre'}
		<p class="formats">JPEG, PNG, WebP, AVIF, TIFF or HEIC</p>
	{/if}

	<input
		bind:this={inputEl}
		type="file"
		accept="image/*"
		multiple
		hidden
		onchange={(e) => {
			const el = e.currentTarget;
			if (el.files) enqueue(el.files, slug);
			// Reset, so choosing the same file twice still fires a change event.
			el.value = '';
		}}
	/>
</div>

<style>
	.uploader {
		display: flex;
		align-items: center;
	}

	.centre {
		flex-direction: column;
		justify-content: center;
		gap: 0.35rem;
		padding: 5rem 1.5rem;
		text-align: center;
		border: 1.5px dashed var(--color-hairline);
	}

	p {
		margin: 0;
	}

	.lead {
		font-size: 1rem;
		color: var(--color-ink);
	}

	.hint {
		font-size: 0.85rem;
		color: var(--color-ink-muted);
	}

	.formats {
		margin-top: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-ink-subtle);
	}

	/* Square corners — a print has edges, not radii. */
	button {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.45rem 0.9rem;
		color: var(--color-surface-raised);
		background: var(--color-ink);
		border: 1px solid var(--color-ink);
		cursor: pointer;
	}

	.centre button {
		margin-top: 0.35rem;
	}

	button:hover {
		background: var(--color-ink-muted);
		border-color: var(--color-ink-muted);
	}
</style>
