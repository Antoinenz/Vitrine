<script lang="ts">
	import {
		items,
		enqueue,
		activeCount,
		failedItems,
		retry,
		clearFinished
	} from '$lib/upload/queue.svelte';
	import { dropTarget, hold } from '$lib/upload/target.svelte';

	/**
	 * Drop photos anywhere in the window.
	 *
	 * Mounted once in the root layout and only for the owner, so a visitor never
	 * gets the listeners and dragging an image around a gallery page behaves
	 * exactly as it always did.
	 *
	 * There is deliberately **one** drop target on the page. Two — a window
	 * handler plus a zone inside it — end up fighting over propagation, and the
	 * bug that produces is maddening to chase: the drop works everywhere except
	 * on the thing that looks most like a drop zone. So `Uploader.svelte` is a
	 * button that opens a file picker, and all dropping happens here.
	 */

	const target = $derived(dropTarget());
	const active = $derived(activeCount());
	const failed = $derived(failedItems());

	/**
	 * `dragleave` fires every time the pointer crosses *any* element boundary, so
	 * a naive boolean flickers off over every child element in the page. Counting
	 * enters against leaves is the standard fix.
	 */
	let depth = $state(0);
	const dragging = $derived(depth > 0 && target !== null);

	/**
	 * Only files raise the veil.
	 *
	 * This isn't tidiness. The deferred photo-reorder pass drags photos with a
	 * `text/plain` payload, and without this guard every attempt to rearrange a
	 * collection would black out the window and offer to upload the photo onto
	 * itself.
	 */
	function isFileDrag(e: DragEvent): boolean {
		return Array.from(e.dataTransfer?.types ?? []).includes('Files');
	}

	function onDragEnter(e: DragEvent) {
		if (!isFileDrag(e)) return;
		depth++;
	}

	function onDragOver(e: DragEvent) {
		if (!isFileDrag(e) || !target) return;
		// Without `preventDefault` here — not just on `drop` — the browser decides
		// the drop is disallowed and navigates away to display the file instead.
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}

	function onDragLeave(e: DragEvent) {
		if (!isFileDrag(e)) return;
		depth = Math.max(0, depth - 1);
	}

	function onDrop(e: DragEvent) {
		if (!isFileDrag(e) || !target) return;
		e.preventDefault();
		depth = 0;

		const files = e.dataTransfer?.files;
		if (!files || files.length === 0) return;

		if (target.kind === 'collection') {
			enqueue(files, target.slug);
		} else {
			// No collection to put them in yet: hold the files and let the page ask
			// for a name. The redirect into the new collection flushes them.
			const held = hold(files);
			if (held > 0) target.onHeld(held);
		}
	}

	/**
	 * A drag that ends outside the window, or one interrupted by tabbing away,
	 * never delivers a matching `dragleave` — the counter would stay above zero
	 * and leave the veil up over a page the artist can no longer interact with.
	 */
	function reset() {
		depth = 0;
	}
</script>

<svelte:window
	ondragenter={onDragEnter}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	ondragend={reset}
	onblur={reset}
/>

{#if dragging && target}
	<div class="veil" aria-hidden="true">
		<div class="message">
			<p class="headline">Drop to upload</p>
			<p class="where">
				{#if target.kind === 'collection'}
					to {target.title}
				{:else}
					as a new collection
				{/if}
			</p>
		</div>
	</div>
{/if}

{#if items.length > 0}
	<!--
		Fixed rather than in the page flow, because the queue outlives the page: it
		has to stay put and keep reporting while the artist navigates.
	-->
	<aside class="panel" aria-live="polite">
		<div class="head">
			<span>
				{#if active > 0}
					Uploading {active} of {items.length}…
				{:else}
					{items.length} file{items.length === 1 ? '' : 's'}
					{failed.length > 0 ? `· ${failed.length} failed` : '· all done'}
				{/if}
			</span>
			{#if active === 0}
				<button type="button" onclick={clearFinished}>Clear</button>
			{/if}
		</div>

		<ul>
			{#each items as item (item.name + item.file.lastModified + item.file.size)}
				<li class:error={item.status === 'error'}>
					<span class="name">{item.name}</span>

					{#if item.status === 'error'}
						<span class="msg">{item.error}</span>
						<button type="button" onclick={() => retry(item)}>Retry</button>
					{:else if item.status === 'done'}
						<span class="msg done">Uploaded</span>
					{:else}
						<span class="bar"><span class="fill" style:width="{item.progress * 100}%"></span></span>
					{/if}
				</li>
			{/each}
		</ul>
	</aside>
{/if}

<style>
	.veil {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--color-surface) 88%, transparent);
		/*
		 * The veil must never eat the drag events it exists to advertise: the
		 * window handlers are what read them, and an element under the pointer
		 * that accepts hits would fire `dragleave` the instant it appears.
		 */
		pointer-events: none;
	}

	.message {
		text-align: center;
		padding: 2.5rem 3.5rem;
		border: 1.5px dashed var(--color-ink-subtle);
		background: var(--color-surface-raised);
	}

	.headline {
		margin: 0;
		font-size: 1.1rem;
		color: var(--color-ink);
	}

	.where {
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
		color: var(--color-ink-muted);
	}

	.panel {
		position: fixed;
		right: 1.25rem;
		bottom: 1.25rem;
		z-index: 80;
		width: min(22rem, calc(100vw - 2.5rem));
		border: 1px solid var(--color-hairline);
		background: var(--color-surface-raised);
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.09);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		font-size: 0.8rem;
		color: var(--color-ink-muted);
		border-bottom: 1px solid var(--color-hairline);
	}

	.head button,
	li button {
		font: inherit;
		font-size: 0.75rem;
		color: var(--color-ink-muted);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 14rem;
		overflow-y: auto;
	}

	li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.4rem 0.75rem;
		font-size: 0.8rem;
	}

	li + li {
		border-top: 1px solid var(--color-hairline);
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bar {
		display: block;
		width: 6rem;
		height: 3px;
		background: var(--color-surface-sunken);
		border-radius: 99px;
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		background: var(--color-ink);
		transition: width 120ms linear;
	}

	.msg {
		color: var(--color-ink-subtle);
		font-size: 0.75rem;
	}

	.done {
		color: #1c6b39;
	}

	li.error .msg {
		color: #b3261e;
	}

	@media (prefers-reduced-motion: reduce) {
		.fill {
			transition: none;
		}
	}
</style>
