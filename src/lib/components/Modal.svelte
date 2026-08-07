<script lang="ts">
	/**
	 * A modal dialog, built on the native `<dialog>` element.
	 *
	 * Native rather than a positioned `<div>`, for two reasons — one ordinary and
	 * one specific to this site.
	 *
	 * The ordinary one: `showModal()` gives a focus trap, Esc-to-close, inert
	 * background and `aria-modal` semantics for free, all of which are tedious to
	 * reimplement and easy to get subtly wrong.
	 *
	 * The specific one: an open `<dialog>` is promoted to the browser's **top
	 * layer**, which escapes every ancestor stacking context. The artist page's
	 * stacks establish their own with `perspective` and `transform-style:
	 * preserve-3d`, and a `position: fixed` div inside one is positioned and
	 * clipped relative to *that*, not the viewport. A hand-rolled modal opened
	 * from a control near a stack would be cropped or land in the wrong place.
	 */
	let {
		open,
		title,
		onClose,
		children
	}: {
		open: boolean;
		title: string;
		onClose: () => void;
		children: import('svelte').Snippet;
	} = $props();

	let dialogEl = $state<HTMLDialogElement>();

	/**
	 * `showModal()` and `close()` are imperative, so the declarative `open` prop
	 * is mirrored onto the element rather than bound to its `open` attribute —
	 * setting that attribute directly opens a *non-modal* dialog, with none of
	 * the top-layer or focus-trap behaviour that is the entire reason for using
	 * one.
	 */
	$effect(() => {
		const el = dialogEl;
		if (!el) return;

		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	});
</script>

<dialog
	bind:this={dialogEl}
	aria-label={title}
	onclose={() => {
		// Fires for Esc and for the close button alike, so the parent's state stays
		// in step however the dialog was dismissed.
		if (open) onClose();
	}}
	onclick={(event) => {
		// A click on the backdrop reports the dialog itself as the target, since
		// the backdrop is a pseudo-element and not separately hittable. Anything
		// inside reports a descendant.
		if (event.target === dialogEl) onClose();
	}}
>
	<!-- eslint-disable-next-line svelte/no-static-element-interactions -->
	<div class="sheet">
		<header>
			<h2>{title}</h2>
			<button type="button" class="close" onclick={onClose} aria-label="Close">×</button>
		</header>

		<div class="body">
			{@render children()}
		</div>
	</div>
</dialog>

<style>
	dialog {
		padding: 0;
		border: 1px solid var(--color-hairline);
		background: var(--color-surface-raised);
		color: var(--color-ink);
		width: min(36rem, calc(100vw - 2rem));
		max-height: calc(100svh - 4rem);
		overflow: hidden;
	}

	dialog::backdrop {
		background: rgb(28 25 23 / 0.4);
	}

	.sheet {
		display: flex;
		flex-direction: column;
		max-height: calc(100svh - 4rem);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-hairline);
	}

	h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.close {
		font: inherit;
		font-size: 1.4rem;
		line-height: 1;
		padding: 0 0.25rem;
		border: 0;
		background: none;
		color: var(--color-ink-subtle);
		cursor: pointer;
	}

	.close:hover {
		color: var(--color-ink);
	}

	/* The body scrolls, not the page behind it. */
	.body {
		padding: 1.25rem;
		overflow-y: auto;
	}
</style>
