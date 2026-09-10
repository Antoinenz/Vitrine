<script lang="ts">
	/**
	 * A menu that opens where it was asked for.
	 *
	 * Used from both the three-dots button and a right-click, which is why it
	 * takes a point rather than an anchor element: the two produce different
	 * origins for the same menu, and passing coordinates keeps that decision at
	 * the call site.
	 *
	 * Deliberately not a `<dialog>`. A modal dialog is the wrong shape for
	 * something dismissed by looking away — it traps focus, it dims the page, and
	 * it makes a context menu feel like a decision when it is meant to feel like
	 * a glance.
	 */
	import type { Snippet } from 'svelte';

	let {
		open,
		x,
		y,
		onClose,
		children,
		label = 'Actions'
	}: {
		open: boolean;
		x: number;
		y: number;
		onClose: () => void;
		children: Snippet;
		label?: string;
	} = $props();

	let menuEl = $state<HTMLElement>();

	/**
	 * Kept on screen.
	 *
	 * A menu opened near the right or bottom edge would otherwise hang off it —
	 * most likely on the last collection in a row, which is exactly where someone
	 * reaching for the three dots ends up.
	 */
	let placed = $state({ left: 0, top: 0 });

	$effect(() => {
		if (!open || !menuEl) return;

		const { width, height } = menuEl.getBoundingClientRect();
		const margin = 8;

		placed = {
			left: Math.min(x, window.innerWidth - width - margin),
			top: Math.min(y, window.innerHeight - height - margin)
		};

		// Focus the first item, so the keyboard can drive it from the moment it
		// opens rather than after a Tab that goes somewhere unrelated.
		menuEl.querySelector<HTMLElement>('button, a')?.focus();
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
			return;
		}

		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();

		const items = [...(menuEl?.querySelectorAll<HTMLElement>('button, a') ?? [])];
		if (items.length === 0) return;

		const at = items.indexOf(document.activeElement as HTMLElement);
		const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
		items[(next + items.length) % items.length].focus();
	}
</script>

<svelte:window
	onkeydown={open ? onKeydown : undefined}
	onresize={open ? onClose : undefined}
	onscroll={open ? onClose : undefined}
/>

{#if open}
	<!--
		A backdrop that catches the next click anywhere, so the menu closes the way
		every other context menu does. Transparent rather than dimmed: this is not
		a modal decision.

		A right-click on it closes the menu and is **not** prevented, so the
		browser's own menu opens instead. That is the escape hatch for everything
		ours does not carry — and it is the one people find without being told,
		because the instinct when a menu is not the one you wanted is to try again.
	-->
	<div class="backdrop" role="presentation" onpointerdown={onClose} oncontextmenu={onClose}></div>

	<div
		class="menu"
		role="menu"
		aria-label={label}
		bind:this={menuEl}
		style:left="{placed.left}px"
		style:top="{placed.top}px"
	>
		{@render children()}
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.menu {
		position: fixed;
		z-index: 901;
		min-width: 13rem;
		padding: 0.25rem;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-hairline);
		/* Square corners, like every other control here. */
		box-shadow: 0 12px 32px -12px rgb(28 25 23 / 0.35);
	}

	/*
	 * Styling the items from here with `:global`, because they are passed in as a
	 * snippet by the caller — the menu owns how a menu looks, the caller owns
	 * what is in it.
	 */
	.menu :global(button),
	.menu :global(a) {
		display: block;
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: 0.85rem;
		text-align: left;
		text-decoration: none;
		padding: 0.4rem 0.7rem;
		border: none;
		background: none;
		color: var(--color-ink);
		cursor: pointer;
	}

	.menu :global(button):hover,
	.menu :global(a):hover,
	.menu :global(button):focus-visible,
	.menu :global(a):focus-visible {
		background: var(--color-surface-sunken);
		outline: none;
	}

	.menu :global(.danger) {
		color: var(--color-danger, #b42318);
	}

	.menu :global(hr) {
		margin: 0.25rem 0;
		border: none;
		border-top: 1px solid var(--color-hairline);
	}
</style>
