<script lang="ts">
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto, preloadData } from '$app/navigation';
	import { page } from '$app/state';
	import PhotoImage from '$lib/components/PhotoImage.svelte';
	import { GRID_SIZES, STACK_SIZES } from '$lib/photo-sizes';
	import { warmPhotos } from '$lib/photo-warm';
	import { stackHover, suspendStacks } from '$lib/motion/stack-hover';
	import ContextMenu from '$lib/components/ContextMenu.svelte';
	import VisibilityDialog from '$lib/components/VisibilityDialog.svelte';
	import { visibilityLabel } from '$lib/visibility';
	import { captureStack, playIntoStack, hasPending } from '$lib/motion/stack-transition';
	import { entrance } from '$lib/motion/entrance';
	import OwnerBar from '$lib/components/OwnerBar.svelte';

	import ProfileModal from '$lib/components/ProfileModal.svelte';
	import { setDropTarget, heldFolderName } from '$lib/upload/target.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let createForm = $state<HTMLFormElement>();

	/**
	 * True while a create is in flight, so the tile can appear before the server
	 * has answered. Without it the gallery sits still after a click that is meant
	 * to feel immediate.
	 */
	let creatingPlaceholder = $state(false);

	/**
	 * Whether this create came from a drop, and so must navigate when it lands.
	 *
	 * Keyed on the drop itself rather than on whether a folder name was found.
	 * Files held by the overlay are flushed by *arriving* at a collection, so a
	 * create that stays put leaves them held and nothing is ever uploaded — which
	 * is what happened to a loose photograph dropped on the gallery, since only a
	 * folder carries a name.
	 */
	let fromDrop = $state(false);
	let goAfterCreate = $state(false);

	type Tile = (typeof data.collections)[number];

	/** The collection whose menu is open, and where it was asked for. */
	let menuFor = $state<Tile | null>(null);
	let menuAt = $state({ x: 0, y: 0 });

	/** The collection whose visibility is being changed. */
	let visibilityFor = $state<Tile | null>(null);

	let trashForm = $state<HTMLFormElement>();
	let trashId = $state('');

	function openMenu(collection: Tile, x: number, y: number) {
		menuFor = collection;
		menuAt = { x, y };
	}

	/**
	 * Our menu, unless the artist asked for the browser's.
	 *
	 * There is no way to open the browser's own context menu from a page — the
	 * only control a page has is whether to prevent the event — so the escape
	 * hatch cannot be a menu item. Two conventions cover it instead: holding
	 * Shift, which Firefox does natively for pages that override the menu, and
	 * right-clicking a second time, which the open menu's backdrop lets through.
	 */
	function onTileContextMenu(event: MouseEvent, collection: Tile) {
		if (!data.isOwner || event.shiftKey) return;

		event.preventDefault();
		openMenu(collection, event.clientX, event.clientY);
	}

	/**
	 * Each of these takes the collection as an argument rather than reading the
	 * menu's own state.
	 *
	 * `{@const target = menuFor}` compiles to a lazy derived, so a handler that
	 * closed the menu before using `target` read it back as null and did nothing
	 * — the menu shut and no dialog appeared. An argument is evaluated before the
	 * call, while the menu is still open, which removes the ordering hazard
	 * rather than relying on remembering it.
	 */
	function renameFromMenu(collection: Tile) {
		menuFor = null;
		beginRename(collection.id, collection.title);
	}

	function chooseVisibility(collection: Tile) {
		menuFor = null;
		visibilityFor = collection;
	}

	function trashCollection(collection: Tile) {
		trashId = collection.id;
		menuFor = null;
		tick().then(() => trashForm?.requestSubmit());
	}

	// ---------------------------------------------------------------- reorder

	/**
	 * Reorder mode: the tiles jiggle and can be dragged.
	 *
	 * A mode rather than always-on dragging, because these are links first. A
	 * gallery whose collections slide about whenever a click lands slightly wrong
	 * would be worse than one that asks first.
	 */
	let reordering = $state(false);

	/**
	 * The order being dragged into, or null while the server's order stands.
	 *
	 * Held locally so a tile follows the cursor immediately rather than after a
	 * round trip — dragging something that only moves once the server agrees does
	 * not feel like dragging.
	 */
	let localOrder = $state<string[] | null>(null);
	let draggingId = $state<string | null>(null);
	let reorderForm = $state<HTMLFormElement>();
	let reorderFields = $state({ id: '', before: '', after: '' });

	/** Shown once, when the first drag changes how the whole gallery is sorted. */
	let switchedToCustom = $state(false);

	const tiles = $derived(
		localOrder
			? localOrder
					.map((id) => data.collections.find((c) => c.id === id))
					.filter((c): c is Tile => !!c)
			: data.collections
	);

	function startReordering() {
		menuFor = null;
		reordering = true;
		suspendStacks(true);
	}

	function stopReordering() {
		reordering = false;
		localOrder = null;
		draggingId = null;
		suspendStacks(false);
	}

	function onDragStart(event: DragEvent, id: string) {
		draggingId = id;
		localOrder = tiles.map((c) => c.id);
		// Required for a drag to start at all in Firefox.
		event.dataTransfer?.setData('text/plain', id);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	/** Slides the dragged tile into the position under the cursor. */
	function onDragOver(event: DragEvent, overId: string) {
		if (!draggingId || draggingId === overId || !localOrder) return;
		event.preventDefault();

		const next = [...localOrder];
		const from = next.indexOf(draggingId);
		const to = next.indexOf(overId);
		if (from === -1 || to === -1) return;

		next.splice(to, 0, ...next.splice(from, 1));
		localOrder = next;
	}

	/**
	 * Commits the position by naming the neighbours rather than an index.
	 *
	 * The server computes a key between them, so two people — or two tabs —
	 * reordering at once cannot settle on the same position, and nothing has to
	 * agree about what index anything is at.
	 */
	function onDragEnd() {
		const id = draggingId;
		draggingId = null;
		if (!id || !localOrder) return;

		const at = localOrder.indexOf(id);
		reorderFields = {
			id,
			before: at > 0 ? localOrder[at - 1] : '',
			after: at < localOrder.length - 1 ? localOrder[at + 1] : ''
		};
		tick().then(() => reorderForm?.requestSubmit());
	}
	let editingProfile = $state(false);

	/**
	 * Which collection's title is open for editing, and what is in the field.
	 *
	 * The draft is held here rather than bound to the collection, so abandoning a
	 * rename with Escape needs no undo — nothing was written.
	 */
	let renamingId = $state<string | null>(null);
	let draft = $state('');
	let renameForm = $state<HTMLFormElement>();

	/** The title as it was when editing began, to tell a real change from a no-op. */
	let renamingFrom = '';

	function beginRename(id: string, title: string) {
		renamingId = id;
		renamingFrom = title;
		draft = title;
	}

	/**
	 * Commits, unless nothing changed.
	 *
	 * Pressing Enter straight after creating is the common case, and it should
	 * cost nothing: the collection already has the default name the server gave
	 * it, so there is no request worth making.
	 */
	function commitRename() {
		const id = renamingId;
		if (!id) return;

		const next = draft.trim();
		renamingId = null;
		if (!next || next === renamingFrom) return;

		draft = next;
		renameForm?.requestSubmit();
	}

	/** Abandons the edit. Nothing was sent, so there is nothing to undo. */
	function cancelRename() {
		renamingId = null;
	}

	function onTitleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitRename();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancelRename();
		}
	}

	/**
	 * Focuses the field and selects what is in it, so typing replaces the name
	 * and an arrow key keeps it — which is the whole gesture being copied.
	 */
	function selectOnMount(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	/**
	 * A folder dropped on this page has no collection to go into, so one is made
	 * from the folder's own name — which is almost always what the artist would
	 * have typed anyway.
	 *
	 * This path still navigates into the new collection, unlike the button:
	 * dropping a folder is a finished instruction, the held files are flushed by
	 * the arrival, and there is nothing left to name.
	 */
	let suggestedTitle = $state('');

	/**
	 * Claims window-wide drops while the artist page is open.
	 *
	 * `kind: 'create'` rather than a collection: the overlay holds the files and
	 * calls back here, and the redirect into the newly created collection flushes
	 * them. Owner only — a visitor never has the overlay mounted at all.
	 */
	$effect(() => {
		if (!data.isOwner) return;
		setDropTarget({
			kind: 'create',
			onHeld: () => {
				suggestedTitle = heldFolderName() ?? '';
				fromDrop = true;
				createForm?.requestSubmit();
			}
		});
		return () => setDropTarget(null);
	});

	const name = $derived(data.profile?.displayName || 'Vitrine');

	/**
	 * A stable pseudo-random number in [0, 1) derived from a photo's id.
	 *
	 * Deterministic on purpose: `Math.random()` would produce different values on
	 * the server and the client, so every card would jump to a new angle the
	 * moment the page hydrated. Deriving from the id means the arrangement is
	 * fixed for a given photograph and identical on both sides.
	 */
	function seeded(id: string, salt: number): number {
		let h = (2166136261 ^ salt) >>> 0;
		for (let i = 0; i < id.length; i++) {
			h ^= id.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		return ((h >>> 0) % 100000) / 100000;
	}

	/** Symmetric variation: -1 … 1. */
	const spread = (id: string, salt: number) => seeded(id, salt) * 2 - 1;

	/**
	 * Each print is dropped on the pile at its own angle and slightly off centre,
	 * rather than fanned by index from one corner. Rotation is about the middle
	 * of the card, so the pile splays both ways instead of hinging from a point.
	 */
	/**
	 * Blank cards for an empty collection, at assorted shapes.
	 *
	 * Derived from the collection id rather than random, for the same reason the
	 * scatter is: a value that differs between server and client would make every
	 * placeholder jump the moment the page hydrated.
	 */
	const PLACEHOLDER_RATIOS = ['3 / 2', '2 / 3', '4 / 3', '1 / 1', '5 / 4'];

	function placeholders(id: string) {
		return [0, 1, 2].map((i) => {
			const seed = `${id}:${i}`;
			return {
				...scatter(seed),
				ratio: PLACEHOLDER_RATIOS[Math.floor(seeded(seed, 6) * PLACEHOLDER_RATIOS.length)]
			};
		});
	}

	function scatter(id: string) {
		return {
			rotate: `${(spread(id, 1) * 7).toFixed(2)}deg`,
			dx: `${(spread(id, 2) * 9).toFixed(1)}px`,
			dy: `${(spread(id, 3) * 7).toFixed(1)}px`,
			// Seconds per drift cycle, and which way it leans first.
			drift: 9 + seeded(id, 4) * 7,
			driftDir: seeded(id, 5) < 0.5 ? -1 : 1
		};
	}

	/**
	 * Warms the destination on hover, so the click has both the page data and the
	 * grid's images already in cache.
	 *
	 * The image half is `warmPhotos`, which resolves the grid's own `sizes` and so
	 * fetches the file the grid will actually display — see `photo-warm.ts` for
	 * what this used to fetch instead.
	 */
	function warm(collection: (typeof data.collections)[number], href: string) {
		void preloadData(href);
		warmPhotos(collection.stack, GRID_SIZES);
	}

	/**
	 * Captures the stack just before navigation. The click is not intercepted —
	 * SvelteKit's router still handles the link normally, so the URL changes and
	 * the page is genuinely shareable.
	 */
	function onStackClick(event: MouseEvent, collection: (typeof data.collections)[number]) {
		// Let modified clicks (new tab, download) behave normally.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

		/**
		 * Warmed again here, not only on hover.
		 *
		 * A tap has no hover to warm on, and neither does following the link from
		 * the keyboard quickly enough. `warmPhotos` reuses one holder and the
		 * browser deduplicates a fetch already in flight, so doing it twice on a
		 * mouse costs nothing while making the touch path work at all.
		 */
		warmPhotos(collection.stack, GRID_SIZES);

		const stack = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('.stack');
		if (stack) captureStack(stack, collection.id);
	}

	/**
	 * Plays the returning grid→stack transition when arriving back from a
	 * collection. Does nothing on a first visit, when nothing was captured.
	 */
	function returnTransition(node: HTMLElement, collectionId: string) {
		if (!hasPending(collectionId)) return;
		void playIntoStack(node, collectionId);
	}

	/**
	 * Settles the header in ahead of the stacks, so the page assembles in reading
	 * order rather than appearing all at once beneath a header that was somehow
	 * already there.
	 *
	 * Skipped entirely when returning from a collection: a photograph is already
	 * flying back into its stack, and a second animation starting at the same
	 * moment would compete with the thing the eye is actually following. The
	 * header was on screen when the visitor left, so re-introducing it would be
	 * wrong anyway.
	 */
	function headerEntrance(node: HTMLElement) {
		if (data.collections.some((c) => hasPending(c.id))) return;
		return entrance({ stagger: '.avatar, .intro-text > *' })(node);
	}
</script>

<svelte:head>
	<title>{name}</title>
	{#if data.profile?.bio}
		<meta name="description" content={data.profile.bio.slice(0, 160)} />
	{/if}
	<meta property="og:title" content={name} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={page.url.href} />
	{#if data.collections[0]?.stack[0]}
		<meta property="og:image" content="{page.url.origin}{data.collections[0].stack[0].socialSrc}" />
		<meta name="twitter:card" content="summary_large_image" />
	{/if}
</svelte:head>

{#if data.isOwner && data.owner}
	<OwnerBar onEditProfile={() => (editingProfile = true)} />

	<!--
		Real forms, submitted programmatically.

		The button in the owner bar points at this one through its `form`
		attribute, so creating a collection is a plain submit that works with
		JavaScript switched off — the response simply re-renders the page with the
		new collection on it, rather than opening a field nothing can type into.
	-->
	<form
		id="new-collection"
		method="POST"
		action="?/createCollection"
		bind:this={createForm}
		use:enhance={() => {
			creatingPlaceholder = true;
			goAfterCreate = fromDrop;
			fromDrop = false;
			return async ({ result, update }) => {
				await update({ reset: false });
				creatingPlaceholder = false;

				if (result.type !== 'success' || !result.data) return;
				const created = result.data as { id: string; slug: string; title: string };

				if (goAfterCreate) {
					// A dropped folder: the held files flush on arrival.
					suggestedTitle = '';
					await goto(resolve('/c/[slug]', { slug: created.slug }));
					return;
				}

				// Otherwise stay put and open the name for editing.
				await tick();
				beginRename(created.id, created.title);
			};
		}}
	>
		<input type="hidden" name="title" value={suggestedTitle} />
	</form>

	<form
		method="POST"
		action="?/renameCollection"
		bind:this={renameForm}
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
		hidden
	>
		<input type="hidden" name="id" value={renamingId ?? ''} />
		<input type="hidden" name="title" value={draft} />
	</form>

	<form
		method="POST"
		action="?/trashCollection"
		bind:this={trashForm}
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
		hidden
	>
		<input type="hidden" name="id" value={trashId} />
	</form>

	<form
		method="POST"
		action="?/reorderCollection"
		bind:this={reorderForm}
		use:enhance={() =>
			async ({ result, update }) => {
				await update({ reset: false });
				localOrder = null;
				if (
					result.type === 'success' &&
					(result.data as { switchedToCustom?: boolean })?.switchedToCustom
				) {
					switchedToCustom = true;
				}
			}}
		hidden
	>
		<input type="hidden" name="id" value={reorderFields.id} />
		<input type="hidden" name="before" value={reorderFields.before} />
		<input type="hidden" name="after" value={reorderFields.after} />
	</form>

	<ContextMenu
		open={menuFor !== null}
		x={menuAt.x}
		y={menuAt.y}
		label={menuFor ? `Actions for ${menuFor.title}` : 'Actions'}
		onClose={() => (menuFor = null)}
	>
		{#if menuFor}
			{@const target = menuFor}
			<!-- Open and Open in new tab are here because our menu replaces the
			     browser's, and those are the two things it was most used for. -->
			<a href={resolve('/c/[slug]', { slug: target.slug })} onclick={() => (menuFor = null)}>
				Open
			</a>
			<a
				href={resolve('/c/[slug]', { slug: target.slug })}
				target="_blank"
				rel="noopener"
				onclick={() => (menuFor = null)}
			>
				Open in new tab
			</a>
			<hr />
			<button type="button" onclick={() => renameFromMenu(target)}>Rename</button>
			<button type="button" onclick={() => chooseVisibility(target)}>Change visibility…</button>
			<button type="button" onclick={startReordering}>Reorder collections</button>
			<a
				href={resolve('/admin/collections/[id]', { id: target.id })}
				onclick={() => (menuFor = null)}
			>
				Properties…
			</a>
			<hr />
			<button type="button" class="danger" onclick={() => trashCollection(target)}>
				Move to trash
			</button>
		{/if}
	</ContextMenu>

	<VisibilityDialog
		open={visibilityFor !== null}
		collection={visibilityFor}
		onClose={() => (visibilityFor = null)}
	/>

	<ProfileModal
		open={editingProfile}
		onClose={() => (editingProfile = false)}
		profile={data.owner.profile}
		candidates={data.owner.candidates}
		message={form?.scope === 'profile' ? form.message : null}
		saved={form?.scope === 'profile' && !!form.saved}
	/>
{/if}

{#if data.profile}
	<header class="intro" {@attach headerEntrance}>
		{#if data.profile.avatarPhotoId}
			<img
				class="avatar"
				src="/i/{data.profile.avatarPhotoId}/320.webp"
				alt={name}
				width="72"
				height="72"
				decoding="async"
			/>
		{/if}

		<div class="intro-text">
			<h1>{name}</h1>
			{#if data.profile.bio}
				<p class="bio">{data.profile.bio}</p>
			{/if}

			{#if data.profile.socialLinks.length > 0}
				<ul class="links">
					{#each data.profile.socialLinks as link (link.url)}
						<!-- Artist-supplied external URLs. `resolve()` is for internal route
						     IDs and throws on anything that isn't one, so it can't apply
						     here; the URLs are validated as http(s) when saved. -->
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<li><a href={link.url} target="_blank" rel="noopener me">{link.label}</a></li>
					{/each}
				</ul>
			{/if}
		</div>
	</header>
{/if}

{#if data.collections.length === 0}
	<p class="empty">
		{#if data.isOwner}
			<!-- A button rather than a link now: creating happens in a modal on this
			     page, so there is nowhere to navigate to. -->
			Nothing here yet.
			<button type="submit" form="new-collection" class="link"> Make your first collection</button>,
			or drop a folder of photographs anywhere on this page.
		{:else}
			Nothing here yet.
		{/if}
	</p>
{:else}
	{#if reordering}
		<div class="reorder-bar" role="status">
			<span>Drag the collections into the order you want.</span>
			<button type="button" class="primary" onclick={stopReordering}>Done</button>
		</div>
	{/if}

	{#if switchedToCustom}
		<p class="notice" role="status">
			Your gallery is now in a custom order rather than sorted by date. You can put it back under
			<a href={resolve('/settings')}>settings</a>.
			<button type="button" class="dismiss" onclick={() => (switchedToCustom = false)}>
				Dismiss
			</button>
		</p>
	{/if}

	<ul class="collections" class:reordering>
		<!--
			The tile appears on the click, not on the reply.

			Creating is a round trip, and over a tunnel to a small server that is
			long enough to feel like nothing happened. This is the same blank stack
			the collection will have anyway once it exists, so the swap when the
			real one arrives is invisible.

			Not a link, and carrying no `data-photo`: there is nothing to navigate
			to yet and nothing for a transition to pair with.
		-->
		{#if creatingPlaceholder}
			<li aria-hidden="true">
				<div class="stack-link pending">
					<div class="stack" style:--depth="3">
						{#each placeholders('pending') as blank, i (i)}
							<div
								class="layer"
								style:--i={i}
								style:--rot={blank.rotate}
								style:--dx={blank.dx}
								style:--dy={blank.dy}
								style:z-index={3 - i}
							>
								<div class="card blank" style:--ratio={blank.ratio}></div>
							</div>
						{/each}
					</div>
					<!-- Not a heading: the whole tile is hidden from assistive
					     technology, and an empty h2 in the outline is worse than no h2. -->
					<div class="caption"><div class="pending-title">New collection</div></div>
				</div>
			</li>
		{/if}

		{#each tiles as collection (collection.id)}
			<li
				class:dragging={draggingId === collection.id}
				draggable={reordering && data.isOwner}
				oncontextmenu={(e) => onTileContextMenu(e, collection)}
				ondragstart={(e) => onDragStart(e, collection.id)}
				ondragover={(e) => onDragOver(e, collection.id)}
				ondragend={onDragEnd}
				ondrop={(e) => e.preventDefault()}
			>
				<!--
					Labelled explicitly, because the caption is no longer inside it.

					The link wraps only the photographs now, so its accessible name would
					otherwise be whatever the alt text of a few prints happens to say —
					or "Empty" for a new collection. Every link on the page would
					announce as the same thing.
				-->
				<a
					class="stack-link"
					aria-label={collection.title}
					href={resolve('/c/[slug]', { slug: collection.slug })}
					data-collection={collection.id}
					onpointerenter={(e) => warm(collection, e.currentTarget.href)}
					onfocus={(e) => warm(collection, e.currentTarget.href)}
					onclick={(e) => onStackClick(e, collection)}
					onkeydown={(e) => {
						// F2, as everywhere else that renames things in place.
						if (data.isOwner && e.key === 'F2') {
							e.preventDefault();
							beginRename(collection.id, collection.title);
						}
					}}
				>
					<!--
						The stack. Each layer is offset and rotated from CSS custom
						properties keyed off its index, so the arrangement is declarative
						and the animation layer only has to change the variables.

						The grid marks its counterparts with `data-photo`, which the
						transition pairs up by index.
					-->
					<div
						class="stack"
						style:--depth={collection.stack.length}
						use:stackHover
						{@attach (node) => returnTransition(node, collection.id)}
					>
						<!--
							A collection with nothing processed yet, drawn as a stack of blank
							prints so a new one has the shape of the thing it will become
							rather than an empty rectangle.

							They carry `.layer` and `.card`, so they scatter and tilt like
							real prints — but deliberately **no `data-photo`**. That marker is
							the transition's vocabulary: an element answering to it would be
							cloned into the ghost layer and flown at a grid that has nothing
							to receive it.

							The status line stays. Blank cards at a glance look like a stack
							that has not loaded, and an empty collection that looks full is a
							worse lie than an empty one that looks empty.
						-->
						{#if collection.stack.length === 0}
							{#each placeholders(collection.id) as blank, i (i)}
								<div
									class="layer"
									style:--i={i}
									style:--rot={blank.rotate}
									style:--dx={blank.dx}
									style:--dy={blank.dy}
									style:--drift="{blank.drift}s"
									style:--drift-dir={blank.driftDir}
									style:z-index={3 - i}
								>
									<div class="card blank" style:--ratio={blank.ratio}></div>
								</div>
							{/each}

							<div class="placeholder" class:working={collection.pendingCount > 0}>
								{#if collection.failedCount > 0}
									{collection.failedCount} failed
								{:else if collection.pendingCount > 0}
									{collection.pendingCount} processing…
								{:else}
									Empty
								{/if}
							</div>
						{/if}

						{#each collection.stack as photo, i (photo.id)}
							{@const s = scatter(photo.id)}
							<div
								class="layer"
								data-photo={photo.id}
								style:--i={i}
								style:--rot={s.rotate}
								style:--dx={s.dx}
								style:--dy={s.dy}
								style:--drift="{s.drift}s"
								style:--drift-dir={s.driftDir}
								style:z-index={collection.stack.length - i}
							>
								<div class="card" style:--ratio="{photo.width} / {photo.height}">
									<PhotoImage
										{photo}
										sizes={STACK_SIZES}
										loading={i === 0 ? 'eager' : 'lazy'}
										fetchpriority={i === 0 ? 'high' : 'auto'}
									/>
								</div>
							</div>
						{/each}
					</div>
				</a>

				{#if data.isOwner && !reordering}
					<!--
						Anchored to the tile, not to the pile.

						`.stack` is a `preserve-3d` context: anything inside it is laid out
						in the same 3D space as the prints and would tilt, scale and
						z-fight with them under the cursor. The chrome sits outside that,
						over the stack's own box, which is a plain rectangle of fixed
						proportions and therefore in the same place on every collection.
					-->
					<div class="tile-chrome">
						{#if collection.visibility !== 'public'}
							<button
								type="button"
								class="chip"
								aria-label="{visibilityLabel(collection.visibility)} — change who can see this"
								title={visibilityLabel(collection.visibility)}
								onclick={() => (visibilityFor = collection)}
							>
								{#if collection.visibility === 'private'}
									<!-- An eye with a line through it. Drawn rather than a
									     character, so it cannot be a missing glyph on a machine
									     without the font. -->
									<svg viewBox="0 0 20 20" aria-hidden="true">
										<path
											d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"
											fill="none"
											stroke="currentColor"
											stroke-width="1.4"
										/>
										<circle cx="10" cy="10" r="2.2" fill="currentColor" />
										<path d="M4 16 16 4" stroke="currentColor" stroke-width="1.6" />
									</svg>
								{:else}
									<!-- A link, for unlisted: reachable if you have it. -->
									<svg viewBox="0 0 20 20" aria-hidden="true">
										<path
											d="M8 12a3 3 0 0 1 0-4l2-2a3 3 0 0 1 4 4l-1 1M12 8a3 3 0 0 1 0 4l-2 2a3 3 0 0 1-4-4l1-1"
											fill="none"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
										/>
									</svg>
								{/if}
							</button>
						{/if}

						<button
							type="button"
							class="chip dots"
							aria-label="Actions for {collection.title}"
							onclick={(e) => {
								const r = e.currentTarget.getBoundingClientRect();
								openMenu(collection, r.left, r.bottom + 4);
							}}
						>
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<circle cx="5" cy="10" r="1.6" fill="currentColor" />
								<circle cx="10" cy="10" r="1.6" fill="currentColor" />
								<circle cx="15" cy="10" r="1.6" fill="currentColor" />
							</svg>
						</button>
					</div>
				{/if}

				<!--
					The caption sits outside the link, not inside it.

					It has to: for the owner the title is a control, and interactive
					content nested in an anchor is invalid HTML — the browser is free to
					do what it likes with a button inside a link, and assistive
					technology reports it as neither one thing nor the other.

					Keeping it a sibling also makes the split honest. The photographs are
					what you click to open; the name is what you click to change it.
				-->
				<div class="caption">
					{#if renamingId === collection.id}
						<input
							class="rename"
							value={draft}
							maxlength="200"
							aria-label="Collection name"
							{@attach selectOnMount}
							oninput={(e) => (draft = e.currentTarget.value)}
							onkeydown={onTitleKeydown}
							onblur={commitRename}
							onclick={(e) => {
								e.preventDefault();
								e.stopPropagation();
							}}
							ondblclick={(e) => e.stopPropagation()}
						/>
					{:else if data.isOwner}
						<!--
								For the owner the title is a field, and the photographs are the
								thing you click to open. That is the split File Explorer makes
								between a file's name and its icon, and it is what lets renaming
								happen without a timer racing a navigation.
							-->
						<h2>
							<!--
								Named "Rename X" rather than just X. Two buttons both reading
								"New collection" - the one that makes them, and a collection
								actually called that - is ambiguous to anyone listening rather
								than looking, and it is the kind of collision that only appears
								once someone has a collection with an awkward name.
							-->
							<button
								type="button"
								class="title-button"
								aria-label="Rename {collection.title}"
								title="Rename (F2)"
								onclick={() => beginRename(collection.id, collection.title)}
							>
								{collection.title}
							</button>
						</h2>
					{:else}
						<!-- A visitor gets the name as a second way in, which is what it
						     was while the caption lived inside the link. -->
						<h2>
							<a class="title-link" href={resolve('/c/[slug]', { slug: collection.slug })}>
								{collection.title}
							</a>
						</h2>
					{/if}
					<p class="count">
						{collection.photoCount}
						{collection.photoCount === 1 ? 'photograph' : 'photographs'}
						<!-- The visibility badge lives in the tile's top right corner. Saying
						     it twice made the caption busier without saying more. -->
						{#if data.isOwner && collection.hasPassword}
							<span class="tag">password</span>
						{/if}
					</p>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	/*
	 * Shares the collections grid's measure and padding so the bio and the first
	 * stack start on the same left edge. Constraining the intro to its own
	 * narrower box would centre it independently and leave the text floating
	 * inward of the photographs.
	 */
	.intro {
		display: flex;
		gap: 1.25rem;
		align-items: flex-start;
		max-width: 78rem;
		margin: 0 auto 5rem;
		padding: 5rem 1.5rem 0;
	}

	/* The text still keeps a readable line length within that wider container. */
	.intro-text {
		max-width: 38rem;
	}

	.avatar {
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}

	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.bio {
		margin: 0;
		font-size: 1rem;
		line-height: 1.65;
		color: var(--color-ink-muted);
		text-wrap: pretty;
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		list-style: none;
		margin: 1rem 0 0;
		padding: 0;
	}

	.links a {
		font-size: 0.85rem;
		color: var(--color-accent);
		text-decoration: none;
		border-bottom: 1px solid color-mix(in oklab, var(--color-accent) 30%, transparent);
		padding-bottom: 1px;
	}

	.links a:hover {
		border-bottom-color: currentColor;
	}

	.collections {
		list-style: none;
		margin: 0 auto;
		padding: 0 1.5rem 8rem;
		max-width: 78rem;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(20rem, 100%), 1fr));
		gap: 4.5rem 3rem;
	}

	.stack-link {
		display: block;
		text-decoration: none;
		color: inherit;
	}

	/*
	 * The stack sits in a perspective container so its layers can rotate in 3D on
	 * hover. The perspective lives here rather than on each layer so they share
	 * one vanishing point — set per-layer, each would rotate about its own centre
	 * and the stack would splay apart instead of tilting as one object.
	 */
	/*
	 * The stack has a fixed footprint, and each print keeps its own shape inside
	 * it.
	 *
	 * Sizing the container from its tallest card would let a portrait behind a
	 * landscape push the caption down — and letting each card drive layout gave
	 * a pile of mismatched rectangles. A constant box with the photographs
	 * *contained* within it keeps every stack the same height on the page while
	 * the prints themselves stay whatever shape they were taken.
	 */
	.stack {
		position: relative;
		aspect-ratio: 4 / 3;
		perspective: var(--stack-perspective);
		transform-style: preserve-3d;
		/* Room for the fan, so a hovered stack never clips its neighbours. */
		padding: calc(var(--stack-offset) * var(--depth));
	}

	/*
	 * CSS owns the fan; GSAP owns the magnet on `.card` inside. Splitting them
	 * across two elements keeps both from writing `transform` on the same node,
	 * which otherwise flickers as the CSS transition and the tween fight.
	 */
	.layer {
		transition: transform var(--duration-hover) var(--ease-out-soft);
		/*
		 * Scattered about the centre rather than fanned from a corner: each card
		 * carries its own angle and a small offset, both derived from its photo id.
		 * `transform-origin` stays at the default centre, so a card rotating left
		 * and one rotating right splay symmetrically instead of hinging from the
		 * same point.
		 */
		transform: translate3d(var(--dx), var(--dy), 0) rotate(var(--rot));
	}

	/*
	 * A blank print: the shape of a photograph with none in it.
	 *
	 * Flat rather than a shimmer or a spinner. Nothing is loading — the
	 * collection is genuinely empty — and animating it would promise an arrival
	 * that is not coming.
	 */
	/* Matches the heading it stands in for, so nothing shifts on the swap. */
	.pending-title {
		font-size: 1rem;
		font-weight: 500;
	}

	/* Faded, because it is a promise rather than a thing. */
	.pending {
		opacity: 0.55;
	}

	.card.blank {
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-hairline);
	}

	/*
	 * The title as a field, sized and positioned exactly like the heading it
	 * replaces, so committing a rename does not make the caption jump.
	 */
	.caption :global(.rename) {
		font: inherit;
		font-size: 1rem;
		font-weight: 500;
		width: 100%;
		max-width: 100%;
		margin: 0;
		padding: 0;
		border: none;
		border-bottom: 1px solid var(--color-ink);
		border-radius: 0;
		background: none;
		color: var(--color-ink);
	}

	.caption :global(.rename):focus {
		outline: none;
	}

	/* The tile is the positioning context for its chrome. */
	.collections li {
		position: relative;
	}

	.tile-chrome {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		z-index: 5;
		display: flex;
		gap: 0.3rem;
		/*
		 * Quiet until the tile is approached. The gallery is the artist's own
		 * public page, and controls sitting permanently on top of the photographs
		 * would make it look like a dashboard rather than a gallery.
		 */
		opacity: 0;
		transition: opacity var(--duration-hover) var(--ease-out-soft);
	}

	.collections li:hover .tile-chrome,
	.collections li:focus-within .tile-chrome,
	/* A non-public collection always shows its badge: an artist should be able
	   to see what is and is not published without touching anything. */
	.tile-chrome:has(.chip:not(.dots)) {
		opacity: 1;
	}

	.chip {
		display: grid;
		place-items: center;
		width: 1.65rem;
		height: 1.65rem;
		padding: 0;
		border: 1px solid var(--color-hairline);
		border-radius: 50%;
		background: var(--color-surface-raised);
		color: var(--color-ink-muted);
		cursor: pointer;
	}

	.chip:hover {
		color: var(--color-ink);
		border-color: var(--color-ink);
	}

	.chip svg {
		width: 1rem;
		height: 1rem;
	}

	.reorder-bar,
	.notice {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		max-width: 78rem;
		margin: 0 auto 1rem;
		padding: 0.6rem 1.5rem;
		font-size: 0.88rem;
		color: var(--color-ink-muted);
	}

	.reorder-bar {
		justify-content: space-between;
		border-top: 1px solid var(--color-hairline);
		border-bottom: 1px solid var(--color-hairline);
	}

	.reorder-bar button,
	.dismiss {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--color-hairline);
		background: none;
		color: var(--color-ink-muted);
		cursor: pointer;
	}

	.reorder-bar .primary {
		border-color: var(--color-ink);
		background: var(--color-ink);
		color: var(--color-surface-raised);
	}

	/*
	 * The jiggle, on the independent `rotate` property.
	 *
	 * Not inside `transform`. CSS owns `.layer`'s transform and GSAP owns
	 * `.card`'s, and a third writer of the same property is what the split
	 * between them exists to prevent — the two would overwrite each other every
	 * frame and flicker. `rotate` is a separate property that composes with both,
	 * so nothing has to know about anything else. It also runs on the compositor.
	 */
	@keyframes jiggle {
		0%,
		100% {
			rotate: -0.7deg;
		}
		50% {
			rotate: 0.7deg;
		}
	}

	.collections.reordering li {
		animation: jiggle 0.28s ease-in-out infinite;
		cursor: grab;
	}

	/* Each tile out of step with its neighbours, or the row pulses as one object. */
	.collections.reordering li:nth-child(even) {
		animation-delay: -0.14s;
	}

	.collections.reordering li:active {
		cursor: grabbing;
	}

	.collections.reordering li.dragging {
		opacity: 0.4;
		animation: none;
	}

	/* Nothing here is a link while the tiles are being arranged. */
	.collections.reordering a {
		pointer-events: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.collections.reordering li {
			animation: none;
			outline: 1px dashed var(--color-hairline);
			outline-offset: 4px;
		}
	}

	.title-link {
		color: inherit;
		text-decoration: none;
	}

	/* A button that has to read as the heading it sits inside. */
	.title-button {
		font: inherit;
		display: block;
		width: 100%;
		margin: 0;
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		text-align: left;
		cursor: text;
	}

	.title-button:hover {
		text-decoration: underline;
		text-decoration-style: dotted;
		text-underline-offset: 0.25em;
	}

	.card {
		/*
		 * Sized by the photograph's own ratio and contained in the layer, so a
		 * portrait is narrow and tall, a panorama wide and short, and neither
		 * escapes the stack's footprint.
		 */
		aspect-ratio: var(--ratio);
		height: 100%;
		width: auto;
		max-width: 100%;
		/* Square corners — a print has edges, not radii. */
		overflow: hidden;
		background: var(--color-surface-raised);
		box-shadow:
			0 1px 2px rgb(28 25 23 / 0.07),
			0 10px 30px -14px rgb(28 25 23 / 0.32);
		transition: box-shadow var(--duration-hover) var(--ease-out-soft);
	}

	.stack-link:hover .card,
	.stack-link:focus-visible .card {
		box-shadow:
			0 2px 4px rgb(28 25 23 / 0.08),
			0 18px 44px -18px rgb(28 25 23 / 0.4);
	}

	/* Every layer fills the stack's box and centres its card within it. */
	.layer {
		position: absolute;
		inset: calc(var(--stack-offset) * var(--depth));
		display: grid;
		place-items: center;
	}

	/*
	 * A modest CSS-only spread on hover. The cursor-tracked 3D tilt is layered on
	 * top of this in JS; keeping a static version here means the stacks still
	 * respond without JavaScript, and it collapses to nothing under reduced
	 * motion via the global rule in layout.css.
	 */
	/* Hovering pushes the pile further apart along the angles it already has. */
	.stack-link:hover .layer,
	.stack-link:focus-visible .layer {
		transform: translate3d(calc(var(--dx) * 2.4), calc(var(--dy) * 2.4), 0)
			rotate(calc(var(--rot) * 1.5));
	}

	.card :global(.frame) {
		width: 100%;
		height: 100%;
	}

	.caption {
		margin-top: 1.5rem;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 500;
		letter-spacing: -0.01em;
	}

	/* Scoped to the whole tile now that the caption is a sibling of the link. */
	.collections li:hover h2 {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.count {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--color-ink-subtle);
	}

	/*
	 * The empty/processing tile. Sits inside `.stack`'s padding so it occupies
	 * exactly the footprint a fanned stack would, and neighbouring collections
	 * don't shift as photographs finish processing and it is replaced.
	 */
	.placeholder {
		position: absolute;
		inset: calc(var(--stack-offset) * var(--depth));
		display: grid;
		place-items: center;
		/* Square, like `.card` — a print has edges, not radii. */
		border: 1px dashed var(--color-hairline);
		color: var(--color-ink-subtle);
		font-size: 0.8rem;
	}

	/*
	 * Only while photographs are actually being processed — not for an empty
	 * collection, and not for a failed one. A pulse means "still working"; on a
	 * tile that is simply empty it would promise something is coming when nothing
	 * is, and on a failure it would be actively misleading.
	 *
	 * Opacity alone, so it composites without touching layout — this sits inside
	 * `.stack`, whose rectangle the transition measures.
	 */
	.working {
		animation: pulse 1.8s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.working {
			animation: none;
		}
	}

	.tag {
		display: inline-block;
		margin-left: 0.35rem;
		padding: 0.05rem 0.4rem;
		font-size: 0.65rem;
		border: 1px solid var(--color-hairline);
		border-radius: 99px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.empty {
		max-width: 78rem;
		margin: 0 auto;
		padding: 0 1.5rem 8rem;
		font-size: 0.95rem;
		color: var(--color-ink-muted);
	}

	/* A button that opens a modal, styled as the link it replaced. */
	.link {
		font: inherit;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-accent);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
</style>
