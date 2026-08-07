<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import Footer from '$lib/components/Footer.svelte';
	import UploadOverlay from '$lib/components/UploadOverlay.svelte';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<svelte:head>
	<!--
		The artist's portrait, cropped square, when they've chosen one — a gallery's
		icon should be the photographer rather than a framework mark. The bundled
		SVG stays as the fallback for a fresh install with no portrait set.

		`/favicon.png` is a stable path rather than a rendition URL, so it carries a
		short revalidating cache and needs no version query string.
	-->
	{#if data.hasPortrait}
		<link rel="icon" type="image/png" href="/favicon.png" />
	{:else}
		<link rel="icon" href={favicon} />
	{/if}
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

	<!--
		Owner only, so a visitor never gets window-wide drag listeners — and so
		dragging an image out of a gallery keeps behaving normally for them.

		Mounted here rather than per page because the queue outlives any one page:
		drop sixty files, navigate away, and the transfers and their progress panel
		carry on.
	-->
	{#if data.isOwner}
		<UploadOverlay />
	{/if}

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
