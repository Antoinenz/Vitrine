<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
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
<div class="root" style:--color-accent={data.accentColor ?? undefined}>
	{@render children()}
</div>

<style>
	.root {
		display: contents;
	}
</style>
