# Admin UI overhaul

The management surface a photographer sees when signed in. Should feel like a
file manager: familiar, direct, and safe to poke at.

Status: **planned, not started.** Decisions below are settled; the staging is
what to argue with.

## The shape of it

Management is **layered onto the gallery itself** — the same page, the same URL,
the same stacks a visitor sees, with owner controls on top. There is no separate
admin panel and no separate manage view.

That is the harder of the options considered, and it was chosen deliberately:
the scattered, tilting piles are what makes this look like nothing else, and a
uniform grid of management tiles would have quietly replaced the product with a
generic one. The conflicts it creates are listed below with how each is handled,
because they are real and will otherwise be rediscovered mid-build.

## Conflicts, and how they resolve

**Overlay chrome on tilted, overlapping piles.** The three-dots button, the
selection checkbox and the visibility badge anchor to `.stack` — already
`position: relative` with a fixed `4/3` aspect ratio, so it is a stable,
axis-aligned box identical for every collection. The chrome sits **outside** the
`preserve-3d` context; inside it, it would tilt with the pile and z-fight
against the cards. The cards go on tilting underneath.

**A third writer of `transform`.** CSS owns `.layer`, GSAP owns `.card`, and
they are split that way because two writers on one node flicker. The reorder
jiggle therefore uses the independent CSS `rotate` property, which is separate
from `transform` and composes with both without either owner participating. It
also runs on the compositor.

In reorder mode the sway and the hover tilt are suspended outright — three
motions at once is noise, not delight. `stackHover` already carries a
`suspended` flag and `syncDrift()`; reorder becomes a third reason to stop,
alongside off-screen and hidden-tab.

**Rename versus opening.** A single click already opens a collection and starts
the flip transition, so double-click cannot mean rename. File Explorer agrees:
there, double-click _opens_, and rename is `F2`, the context menu, or a second
separate click on the name of an already-selected item. Following Explorer
properly removes the conflict instead of working around it.

**Right-click.** Ours replaces the browser's, which is where "open in new tab"
and "copy link address" live. Owner-only, and the menu carries **Open** and
**Open in new tab** itself, which covers most of what was lost.

Getting the rest back needs care, because **the browser's own context menu
cannot be opened from JavaScript.** There is no API for it; the only control a
page has is whether to call `preventDefault` on the `contextmenu` event. So a
"show the browser menu" item is not implementable as an item. Two conventions
do work, and both are worth having:

- **Shift + right-click** skips the custom menu. Firefox does this natively for
  pages that override the menu, so some people already expect it.
- **Right-click again** while our menu is open lets the second event through.
  This is what Google Docs does, and it is the one people find without being
  told, because the instinct when a menu is not the one you wanted is to try
  again.

## Behaviour

**New collection.** No modal. A collection appears at the top of the grid
immediately, with a few grey placeholder cards at varied aspect ratios so it
reads as a real stack. The title is focused with `New collection` selected:
typing replaces it, `Enter` or blur commits, `Escape` reverts. Exactly the
Explorer gesture.

The placeholder stack stays the empty state after creation, but must remain
legible as _empty_ — an empty collection that looks populated is worse than an
honest blank.

**Context menu**, from the three-dots button or right-click anywhere on the
collection: change visibility, rename, reorder, properties, move to trash.

**Visibility** opens a small dialog with a dropdown — private (the default),
unlisted, public. A badge on the stack shows the current state at a glance: a
crossed-out eye for private, an unlisted mark for unlisted, nothing for public.
Clicking the badge opens the same dialog.

**Reorder** jiggles the collections and allows drag and drop with a grabbing
cursor. `collections.sort_key` already exists and holds fractional keys, so a
drop rewrites one row rather than renumbering.

The trap: collections sort by capture date unless the profile's
`collectionOrder` is `custom`, and nothing writes `sort_key` after creation
today. So the first drag **switches the gallery to custom order automatically**
and says so, with an undo. Dragging must do what it appears to do.

**Properties** reuses the existing dialog for now. Revisiting what belongs in it
is a separate job, once there is something to react to.

**Motion in management.** Cursor-driven motion is damped while signed in — the
tilt and the magnet are presentation, and they are in the way when the job is
managing rather than looking. In reorder mode every cursor-driven animation is
off and the jiggle is the only motion on the page.

**Selection** is built for photographs inside a collection first, not for
collections. That is where bulk actions earn their keep — delete, reorder, set
cover, download several — and where a photographer actually spends time. A
checkbox in the corner of each tile, blue with a white tick when set, and a
ribbon of actions above the grid once anything is selected.

## Trash

Built first, because every other action in that menu becomes safe once undo
exists, and "move to trash" cannot ship without it.

`deleted_at` on `collections` and on `photos`, nullable.

**The column is the easy half.** The risk is a read path that forgets to exclude
trashed rows, and the worst case is specific: a photographer trashes a private
client gallery and it stays reachable at its URL. The paths include the artist
page, the collection page, the photo page, the sitemap, the ZIP endpoint, image
serving, and link previews — enough that "remember to add `isNull(deletedAt)`"
is not a plan.

So: one helper that every read goes through, and a test that fails if a route
queries `collections` directly. The guarantee has to be structural.

**Trashing frees the slug**, by suffixing the trashed row's copy. Slugs are
unique per owner, and Explorer lets you make a new folder with the name of one
you just deleted. Restore takes the slug back if it is still free and suffixes
if not.

**Purge** removes rows, originals and derivatives together, on a retention
period rather than immediately. Files stay on disk until then, which is the
point.

## The motion customiser

A panel docked along the bottom of the screen, like devtools, for tuning how the
cursor, the animations and the clicks feel. Owner-only, and its values are the
gallery's — a visitor sees the result, because this is the operator's design
decision rather than a personal preference.

Two audiences, and they justify it twice over. A self-hoster gets to make the
gallery feel like theirs, which is the "a great deal of control if you want it"
half of the roadmap. And it is how the defaults get found: at the moment tuning
the feel means describing a feeling, waiting for a change, and judging the
result — a slow loop with a person in the middle of it who cannot feel what the
other one feels. A panel with live sliders closes that loop in seconds. An
export that emits the tuned values as the shipped defaults is therefore part of
it, not an extra.

**What it needs from the code.** The values are currently constants captured at
module load: `MOTION` in `gsap.ts`, `MAX_TILT_X/Y`, `MAGNET_STRENGTH` and
`LAYER_DEPTH` in `stack-hover.ts`, `DURATION` and `ARRIVE_EASE` in
`stack-transition.ts`, drift timings derived from CSS custom properties. Live
tuning means reading them at call time instead — and `gsap.quickTo` captures
duration when it is created, so the hover handles have to be rebuilt when
timings change rather than merely re-read. That is the real work in this;
the panel itself is sliders.

Values persist per install alongside the other settings, and ship with the
current constants as their defaults, so an untouched install looks exactly as it
does today.

## Staging

Each stage ships on its own.

1. ~~**Trash** — schema, the single read path and its guard test, a trash view,
   restore, purge, retention.~~ Done.
2. ~~**Inline create and rename** — the Explorer text gesture, plus `F2`.~~
   Done. One thing settled while building it: renaming moves the address only
   while the collection is empty and its slug was generated rather than chosen,
   because the address is what gets sent to a client.
3. **Chrome and context menu** — three-dots, badge, right-click, the visibility
   dialog, properties.
4. **Reorder** — jiggle on `rotate`, drag and drop, the automatic switch to
   custom order.
5. **Photo selection** — checkboxes and the action ribbon, inside a collection.

The **motion customiser** is deliberately unnumbered, because where it belongs
is a real question. It is not part of the manager, but it is the tool for
settling how the manager feels — and its refactor of the motion constants is a
prerequisite for damping motion in management mode at all. Building it before
stage 4 would mean the reorder jiggle is tunable the day it exists rather than
guessed at.
