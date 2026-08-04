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
	The footer is suppressed in the admin area, which has its own chrome and is
	not part of the public site.
-->
<div class="root" style:--color-accent={data.accentColor ?? undefined}>
	{@render children()}

	{#if !page.url.pathname.startsWith('/admin')}
		<Footer artist={data.artistName} legal={data.legal} />
	{/if}
</div>

<style>
	/*
	 * A flex column so the footer sits at the bottom of short pages rather than
	 * floating mid-screen. `display: contents` would drop the box entirely and
	 * take the layout with it.
	 */
	.root {
		display: flex;
		flex-direction: column;
		min-height: 100svh;
	}
</style>
