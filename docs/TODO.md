# TODO

A working list. The [roadmap](ROADMAP.md) says where Vitrine is going and why;
this says what to pick up next.

Items carry what is already known about them, so the next person to start one
doesn't have to rediscover it. Anything with a measurement next to it was
measured, not guessed.

- [Next](#next)
- [Motion and performance](#motion-and-performance)
- [Uploading and management](#uploading-and-management)
- [Storage and installation](#storage-and-installation)
- [Protecting work](#protecting-work)
- [Housekeeping](#housekeeping)
- [Decisions waiting on a person](#decisions-waiting-on-a-person)

## Next

- [ ] **Admin UI overhaul** — planned in
      [design/admin-ui.md](design/admin-ui.md). Stages 1 and 2 are done and
      deployed: the trash, and creating and renaming in place. Stage 1 was:
      discard, restore, purge on a thirty-day retention, and one enforced
      reader for the collections table. Next is **stage 2, inline create and
      rename** — the File Explorer text gesture — then the context menu,
      reorder, and photo selection.

- [ ] **Uploading needs failure handling** before anyone else can be told to run
      this. It is the weakest part of the app and the one most likely to lose
      someone's work.

## Motion and performance

**The reported stutter is fixed, and the cause was not in this repository.**

A browser extension that hooks every image's `load` event was running 150–300ms
of JavaScript per photograph. Removing it made the gallery, in the reporter's
words, "smooth as butter". The trace put the six seconds after returning to a
backgrounded tab at 4,659ms of JavaScript, 197 dropped frames and **23ms of
raster** — so every rendering-side theory below was wrong, including two I was
confident about. Documented for other people's browsers in
[configuration → troubleshooting](CONFIGURATION.md#troubleshooting).

Shipped along the way, each justified on its own terms rather than by the
stutter:

- [x] Ambient sway stops when the tab is hidden — no reason to animate what
      nobody is looking at
- [x] The grid holds back everything but the photographs in flight until the
      arrival lands, on a collection's first opening
- [x] The hover warm fetches the image the destination will actually show. It
      had been fetching a 1280px JPEG in place of a 640px WebP, on the strength
      of a comment asserting the two pages requested identical URLs; measured
      overlap was zero of nine. Click to hand-over went from ~1776ms to ~1010ms

Still open, but now known to be small:

- [ ] **Frames dropped while the destination page is built.** Around 13 frames
      over 25ms on a 4×-throttled CPU. Real, but an order of magnitude below
      what the extension was costing, and nobody has complained about it. Do not
      start here.

- [ ] **Idle compositor cost on the artist page.** Every visible card runs an
      infinite GSAP `rotation` tween — a main-thread write and a composite per
      card per frame, a few percent of GPU while the page sits still. Worth
      trying: a CSS `@keyframes` animation on the independent `rotate` property,
      which runs on the compositor with no main thread at all, and does not
      collide with GSAP's `transform`. `resetTilt` would have to neutralise it
      before the transition measures anything.

- [ ] **The flight still waits on `decode()` with an 800ms cap.** Much less
      often now the right image is warmed, but a cold connection still parks the
      ghosts. Consider starting the flight immediately and gating only the
      hand-off.

**Before optimising anything here, take a trace.** `scripts/trace-report.mjs`
streams a saved DevTools profile and attributes JavaScript by owning script. The
first two diagnoses on this problem were reasoned rather than measured, and both
were wrong.

## Uploading and management

- [ ] Failure handling on upload: what happens on a dropped connection, a file
      `sharp` cannot decode, a full disk
- [ ] Progress and recovery that survive a page reload mid-upload
- [ ] Collection and photo management is thin and awkward in places — being
      replaced wholesale, see [design/admin-ui.md](design/admin-ui.md)
- [x] ~~No interface for reordering collections.~~ Drag to reorder, from the
      context menu. The first drag seeds every sort key from the order on screen
      before switching the gallery to custom order

## Storage and installation

- [ ] Make storage an interface rather than a filesystem path, as the
      prerequisite for S3/R2
- [ ] A cloud-hosted install path for photographers with nowhere to run Docker
- [ ] Keep "your work is yours and you can take it with you" true through that
      change — today `DATA_DIR` is the whole backup surface, which is a virtue
      worth not losing

## Protecting work

- [ ] Video, in the same collections as photographs
- [ ] Automatic watermarking at rendition time, so originals stay clean
- [ ] Download protection, with its ceiling stated honestly in the docs: a
      browser cannot display an image the viewer cannot keep

## Housekeeping

- [x] ~~Trashed collections went on serving their photographs.~~ `/i/…` and
      `/api/photos/…/download` joined `collections` to check access but not
      `deleted_at`, so the page 404'd while the images and originals did not.
      The guard test now covers joins as well as direct queries

- [ ] `viewer.e2e.ts` "a modified click still opens a real tab" fails roughly one
      run in three. Pre-existing, and hardened twice already — first for clicking
      through the arrival animation, then for a background tab that stays on
      `about:blank`. What times out now is `context.waitForEvent('page')`, so the
      popup is never created at all. Passes alone every time

- [ ] `docs/screenshots` is about 13 MB of full-resolution PNGs displayed at
      380px. Downscaling to ~1200px would make cloning the repository markedly
      cheaper
- [x] ~~The e2e sign-in occasionally fails and passes on a re-run.~~ Found: the
      login form bound the email with `value`, which Svelte re-applies during
      hydration, discarding anything typed or autofilled before the JavaScript
      arrived. Not a test problem — a password manager would hit it too. Fixed
      with `defaultValue`. Both earlier theories (rate limiting, a slow machine)
      were wrong, and the thing that settled it was the page state captured at
      the moment of failure: email empty, password full, no error shown
- [ ] `npm run lint` currently reports formatting in `README.md` and
      `migrations.spec.ts`

## Decisions waiting on a person

Not blocked on effort — blocked on someone deciding.

- [ ] **Collaborator accounts.** A second login for a trusted person: a small
      group sharing one gallery, or a friend helping with setup. The database
      carries `owner_id` throughout, so this is a permissions and routing
      question rather than a migration. It needs a clear answer to "who can do
      what" before any of it is built.

- [ ] **Signing in from more than one address.** `ORIGIN` is a single value, so
      sign-in works only at the configured address while browsing works from
      anywhere — reaching the gallery over both Tailscale and a public domain
      means picking one to administer from. Lifting it needs
      `csrf.trustedOrigins`, which is build-time configuration, **plus**
      per-request protocol detection. The proxy-header shortcut does not work:
      with `PROTOCOL_HEADER` set, a request arriving without that header is
      treated as HTTPS, which rejects a plain-HTTP sign-in from a LAN address.
