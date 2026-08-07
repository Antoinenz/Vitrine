<script lang="ts">
	/**
	 * The artist's controls on their own page.
	 *
	 * Top right, above the collections, and deliberately quiet — this is still
	 * the public page, and the point of editing in place is that it looks like
	 * the site rather than like a panel bolted onto it.
	 *
	 * It sits **outside** the collection list by construction. Nothing here may
	 * carry `data-photo` or `data-collection`, or the classes `.stack`, `.layer`
	 * or `.card`: `stackHover` queries `.card`, the transition queries
	 * `[data-photo]` and blanks every unpaired match, and `captureStack` takes
	 * the first four. An admin button inside that vocabulary would be animated as
	 * though it were a photograph.
	 */
	let {
		onCreate,
		onEditProfile
	}: {
		onCreate: () => void;
		onEditProfile: () => void;
	} = $props();
</script>

<div class="owner-bar">
	<button type="button" onclick={onEditProfile}>Edit profile</button>
	<button type="button" class="primary" onclick={onCreate}>New collection</button>
</div>

<style>
	.owner-bar {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		max-width: 78rem;
		margin: 0 auto;
		padding: 1.25rem 1.5rem 0;
	}

	/* Square corners — a print has edges, not radii. */
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

	.primary:hover {
		background: var(--color-ink-muted);
		border-color: var(--color-ink-muted);
		color: var(--color-surface-raised);
	}
</style>
