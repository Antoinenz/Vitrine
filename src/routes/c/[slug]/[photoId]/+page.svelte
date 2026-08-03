<script lang="ts">
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Viewer from '$lib/components/Viewer.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * The viewer opened directly — a shared link, a reload, or a crawler.
	 *
	 * Stepping between photos here uses `replaceState` rather than a navigation:
	 * arrowing through forty photographs shouldn't bury the collection page
	 * under forty history entries, and the URL still updates so any photo can be
	 * copied from the address bar.
	 */
	// Writable `$derived`: steps locally as you arrow through, but re-seeds from
	// the server whenever a fresh load arrives (someone pasted a different photo
	// URL, or hit back into this route).
	let index = $derived(data.index);

	function onIndexChange(next: number) {
		index = next;
		replaceState(
			resolve('/c/[slug]/[photoId]', {
				slug: data.collection.slug,
				photoId: data.photos[next].id
			}),
			{}
		);
	}

	function onClose() {
		void goto(resolve('/c/[slug]', { slug: data.collection.slug }));
	}
</script>

<svelte:head>
	<title>{data.collection.title} · {data.artist.name}</title>
	{#if data.collection.visibility !== 'public'}
		<meta name="robots" content="noindex" />
	{/if}
	<meta property="og:image" content="/i/{data.photos[index].id}/1280.jpeg" />
</svelte:head>

<Viewer
	photos={data.photos}
	{index}
	collectionTitle={data.collection.title}
	downloadsEnabled={data.collection.downloadsEnabled}
	{onIndexChange}
	{onClose}
/>
