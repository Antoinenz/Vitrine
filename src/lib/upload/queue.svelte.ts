import { invalidateAll } from '$app/navigation';

/**
 * The upload queue.
 *
 * Module-level rather than component state, and that is the whole reason this
 * file exists. Uploads used to live inside `Uploader.svelte` on the admin page,
 * where the component and the upload had the same lifetime. Now that photos can
 * be dropped anywhere, the artist can drop sixty files and immediately navigate
 * — to another collection, back to the gallery — and unmounting the component
 * that owned the queue would abort every transfer in flight. State that outlives
 * the page has to live outside the page.
 *
 * One request per file, not a single multipart POST. That buys real per-file
 * progress, a failure that costs one file instead of the batch, and a retry that
 * doesn't re-send everything.
 */

/**
 * Browsers cap connections per origin anyway, and more parallel uploads would
 * only starve the server's encoder of CPU while making each file take longer to
 * land. Three keeps the pipe full without fighting the ingest worker.
 */
const CONCURRENCY = 3;

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';

export type UploadItem = {
	file: File;
	name: string;
	/** Which collection this file is bound for, captured at enqueue time. */
	slug: string;
	progress: number;
	status: UploadStatus;
	error?: string;
};

/**
 * Never reassigned — only mutated — so it can be exported directly. Reassigning
 * an exported `$state` binding is a compile error in Svelte 5, and it would also
 * break every consumer's reference.
 */
export const items = $state<UploadItem[]>([]);

/** Files still going up, or waiting to. */
export function activeCount(): number {
	return items.filter((i) => i.status === 'uploading' || i.status === 'queued').length;
}

export function failedItems(): UploadItem[] {
	return items.filter((i) => i.status === 'error');
}

/**
 * Accepts files for a collection.
 *
 * Non-images are dropped silently rather than queued and rejected by the server:
 * dragging a folder in usually sweeps up a `.DS_Store` or a sidecar file, and
 * showing those as failures would make a clean upload look broken.
 */
export function enqueue(files: Iterable<File>, slug: string): number {
	const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
	if (incoming.length === 0) return 0;

	for (const file of incoming) {
		items.push({ file, name: file.name, slug, progress: 0, status: 'queued' });
	}

	void pump();
	return incoming.length;
}

/** Uploads one file, reporting progress. */
function upload(item: UploadItem): Promise<void> {
	return new Promise((resolve) => {
		const xhr = new XMLHttpRequest();
		// XHR rather than fetch: fetch still has no upload progress event, and
		// progress is the entire point of showing this UI.
		xhr.open(
			'POST',
			`/api/collections/${encodeURIComponent(item.slug)}/upload?name=${encodeURIComponent(item.name)}`
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
	// The endpoint replies 401 rather than redirecting to the login form, so an
	// expired session says so here instead of looking like a successful upload.
	if (xhr.status === 401) return 'Signed out — sign in again to continue';
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
	// Refreshes whatever page is showing — the photo grid, the processing badges,
	// the stack on the artist page — in one round trip.
	await invalidateAll();
}

export function retry(item: UploadItem) {
	item.status = 'queued';
	item.progress = 0;
	item.error = undefined;
	void pump();
}

export function clearFinished() {
	for (let i = items.length - 1; i >= 0; i--) {
		if (items[i].status === 'done') items.splice(i, 1);
	}
}
