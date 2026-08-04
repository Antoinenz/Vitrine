<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import Footer from '$lib/components/Footer.svelte';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!--
	The artist's accent overrides the token default here rather than in a <style>
	block, so it's part of the server-rendered markup and can't flash a different
	colour before hydration. The value is validated as a hex colour when saved,
	so it can't inject anything into the style attribute.
-->
<!--
	Still suppressed under `/admin`, which is now only the photo workbench —
	the last piece of the old panel, and the last thing left to bring inline.
-->
<div class="root" style:--color-accent={data.accentColor ?? undefined}>
	<div class="page">
		{@render children()}
	</div>

	{#if !page.url.pathname.startsWith('/admin')}
		<Footer
			artist={data.artistName}
			legal={data.legal}
			licence={data.licence}
			note={data.footerNote}
			links={data.footerLinks}
			isOwner={data.isOwner}
		/>
	{/if}
</div>

<style>
	/*
	 * A flex column so the footer sits at the bottom of short pages rather than
	 * floating mid-screen.
	 */
	.root {
		display: flex;
		flex-direction: column;
		min-height: 100svh;
	}

	/*
	 * Page content lives in its own block container rather than being a direct
	 * flex child.
	 *
	 * Every page centres its sections with `max-width` plus `margin: 0 auto`. As
	 * flex items those auto margins apply to the *cross* axis, which makes the
	 * element shrink to its content and centre that instead of filling the width
	 * — so headers collapsed to the width of their text and drifted into the
	 * middle of the page while the grid beneath stayed left-aligned. Inside a
	 * plain block container the same margins behave normally.
	 */
	.page {
		flex: 1;
	}
</style>
