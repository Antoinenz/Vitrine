import { enqueue } from './queue.svelte';

/**
 * Where a dropped file goes.
 *
 * The window-wide drop handler doesn't know what page it's on, and shouldn't:
 * pages claim the drop for as long as they're mounted, and the overlay reads
 * whatever is claimed. Nothing claimed means dropping is inert, which is the
 * right default — a visitor's stray drag, or an owner on a page with no sensible
 * destination, shouldn't raise a veil that leads nowhere.
 */

export type DropTarget =
	/** A collection page: files go straight in. */
	| { kind: 'collection'; slug: string; title: string }
	/**
	 * The artist page: there is no collection yet, so files are held and the
	 * create modal opens. The redirect to the new collection flushes them.
	 */
	| { kind: 'create' };

const store = $state<{ current: DropTarget | null; held: File[] }>({ current: null, held: [] });

export function dropTarget(): DropTarget | null {
	return store.current;
}

/**
 * Claims the drop for a page. Pass `null` on unmount.
 *
 * Claiming a real collection also flushes anything held from an earlier drop, so
 * the drop-then-create round trip finishes itself: files land on the artist
 * page, the collection is created, its page mounts, and they start uploading
 * without the artist choosing them a second time.
 */
export function setDropTarget(target: DropTarget | null) {
	store.current = target;
	if (target?.kind === 'collection' && store.held.length > 0) {
		enqueue(store.held.splice(0, store.held.length), target.slug);
	}
}

/** Files dropped before a collection existed to put them in. */
export function hold(files: Iterable<File>): number {
	const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
	store.held.push(...incoming);
	return incoming.length;
}

export function heldCount(): number {
	return store.held.length;
}

/**
 * The common parent folder of a set of dropped files, if there is one.
 *
 * A folder drag gives every file a `webkitRelativePath`, so the folder name is
 * usually what the artist would have typed as the title anyway. Best-effort:
 * a drag of loose files has no path and this returns null.
 */
export function heldFolderName(): string | null {
	const paths = store.held
		.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '')
		.filter((p) => p.includes('/'));

	if (paths.length === 0) return null;

	const first = paths[0].split('/')[0];
	return paths.every((p) => p.split('/')[0] === first) ? first : null;
}

export function discardHeld() {
	store.held.splice(0, store.held.length);
}
