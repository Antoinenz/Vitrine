<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	/**
	 * Drag-and-drop uploader.
	 *
	 * Sends one request per file rather than a single multipart POST, which buys
	 * three things that matter for a sixty-photo drop: real per-file progress, a
	 * failure that costs one file instead of the whole batch, and a retry that
	 * doesn't re-send everything.
	 *
	 * Concurrency is capped: browsers cap connections per origin anyway, and
	 * more parallel uploads would only starve the server's encoder of CPU while
	 * making each individual file take longer to land.
	 */
	let { collectionId }: { collectionId: string } = $props();

	const CONCURRENCY = 3;

	type Item = {
		file: File;
		name: string;
		progress: number;
		status: 'queued' | 'uploading' | 'done' | 'error';
		error?: string;
	};

	let items = $state<Item[]>([]);
	let dragging = $state(false);
	let inputEl: HTMLInputElement;

	let active = $derived(
		items.filter((i) => i.status === 'uploading' || i.status === 'queued').length
	);
	let failed = $derived(items.filter((i) => i.status === 'error'));

	function addFiles(files: FileList | File[]) {
		const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
		if (incoming.length === 0) return;

		items = [
			...items,
			...incoming.map((file) => ({
				file,
				name: file.name,
				progress: 0,
				status: 'queued' as const
			}))
		];
		void pump();
	}

	/** Uploads one file, reporting progress. */
	function upload(item: Item): Promise<void> {
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			// XHR rather than fetch: fetch still has no upload progress event, and
			// progress is the entire point of showing this UI.
			xhr.open(
				'POST',
				`/admin/collections/${collectionId}/upload?name=${encodeURIComponent(item.name)}`
			);
			xhr.setRequestHeader('content-type', item.file.type || 'application/octet-stream');

			xhr.upload.addEventListener('progress', (e) => {
				if (e.lengthComputable) item.progress = e.loaded / e.total;
			});

			xhr.addEventListener('load', () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					item.progress = 1;
					item.status = 'done';
				} else {
					item.status = 'error';
					item.error = readError(xhr);
				}
				resolve();
			});

			xhr.addEventListener('error', () => {
				item.status = 'error';
				item.error = 'Network error';
				resolve();
			});

			xhr.send(item.file);
		});
	}

	function readError(xhr: XMLHttpRequest): string {
		try {
			const body = JSON.parse(xhr.responseText);
			return body.message ?? `Upload failed (${xhr.status})`;
		} catch {
			return `Upload failed (${xhr.status})`;
		}
	}

	let pumping = false;

	async function pump() {
		if (pumping) return;
		pumping = true;

		while (items.some((i) => i.status === 'queued')) {
			const batch = items.filter((i) => i.status === 'queued').slice(0, CONCURRENCY);
			for (const item of batch) item.status = 'uploading';
			await Promise.all(batch.map(upload));
		}

		pumping = false;
		// Refreshes the photo grid and the processing badges in one round trip.
		await invalidateAll();
	}

	function retry(item: Item) {
		item.status = 'queued';
		item.progress = 0;
		item.error = undefined;
		void pump();
	}

	function clearFinished() {
		items = items.filter((i) => i.status !== 'done');
	}
</script>

<div
	class="drop"
	class:dragging
	role="button"
	tabindex="0"
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
	}}
	onclick={() => inputEl.click()}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			inputEl.click();
		}
	}}
>
	<p>Drop photos here, or <span class="link">choose files</span></p>
	<p class="hint">JPEG, PNG, WebP, AVIF, TIFF or HEIC</p>

	<input
		bind:this={inputEl}
		type="file"
		accept="image/*"
		multiple
		hidden
		onchange={(e) => {
			const el = e.currentTarget;
			if (el.files) addFiles(el.files);
			// Reset so selecting the same file twice still fires a change event.
			el.value = '';
		}}
	/>
</div>

{#if items.length > 0}
	<div class="queue">
		<div class="queue-head">
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
	</div>
{/if}

<style>
	.drop {
		display: grid;
		place-items: center;
		gap: 0.2rem;
		padding: 2.5rem 1rem;
		text-align: center;
		background: var(--color-surface-raised);
		border: 1.5px dashed var(--color-hairline);
		border-radius: 10px;
		cursor: pointer;
	}

	.drop:hover,
	.dragging {
		border-color: var(--color-ink-subtle);
		background: var(--color-surface-sunken);
	}

	.drop p {
		margin: 0;
		font-size: 0.9rem;
		color: var(--color-ink-muted);
	}

	.link {
		color: var(--color-ink);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.hint {
		font-size: 0.75rem !important;
		color: var(--color-ink-subtle) !important;
	}

	.queue {
		margin-top: 1rem;
		border: 1px solid var(--color-hairline);
		border-radius: 8px;
		background: var(--color-surface-raised);
		overflow: hidden;
	}

	.queue-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		font-size: 0.8rem;
		color: var(--color-ink-muted);
		border-bottom: 1px solid var(--color-hairline);
	}

	.queue-head button,
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
</style>
