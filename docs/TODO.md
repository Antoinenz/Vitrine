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

- [ ] **The page-swap stutter.** The largest remaining piece of the transition
      problem. See [motion and performance](#motion-and-performance).
- [ ] **Uploading needs failure handling** before anyone else can be told to run
      this. It is the weakest part of the app and the one most likely to lose
      someone's work.

## Motion and performance

Recently done, for context on what is left:

- [x] Ambient sway stops when the tab is hidden, and waits for the page to be
      repainted before resuming
- [x] The grid holds back everything but the photographs in flight until the
      arrival lands, on a collection's first opening
- [x] The hover warm fetches the image the destination will actually show

Still open:

- [ ] **Frames are still dropped while the destination page is built.** Roughly
      13 frames over 25ms, worst around 133ms, on a 4×-throttled CPU. A CPU
      profile over the whole opening is **70% idle and 15% "(program)"**, with no
      JavaScript function above 0.7% — so this is layout, paint, raster and
      decode, not scripting. Optimising JavaScript here will do nothing; the
      question is how much rendering work the destination page asks for in its
      first frame.

- [ ] **Idle compositor cost on the artist page.** Every visible card runs an
      infinite GSAP `rotation` tween, which is a main-thread write plus a
      composite for every card on every frame — a few percent of GPU while the
      page sits there doing nothing, and part of why Chrome may treat the tab as
      expensive. Worth trying: move the sway to a CSS `@keyframes` animation on
      the independent `rotate` property, which runs on the compositor and needs
      no main thread at all. `rotate` is a separate property from `transform`,
      so it would not collide with GSAP's magnet — but `resetTilt` would need to
      neutralise it before the transition measures anything, which is exactly
      the kind of detail that breaks the flight if it is got wrong.

- [ ] **Consider `content-visibility: auto` on off-screen collections.** Would
      cut layout and raster work on a long artist page, and reduce what has to
      be rebuilt when a backgrounded tab returns. Note that it implies paint
      containment, which may clip the hover fan — check before adopting.

- [ ] **The flight still waits on `decode()` with an 800ms cap.** Much less
      often now that the right image is warmed, but a cold, slow connection
      still parks the ghosts. Consider starting the flight immediately and
      gating only the hand-off on the destination being ready.

## Uploading and management

- [ ] Failure handling on upload: what happens on a dropped connection, a file
      `sharp` cannot decode, a full disk
- [ ] Progress and recovery that survive a page reload mid-upload
- [ ] Collection and photo management is thin and awkward in places
- [ ] No interface for reordering collections. `collections.sort_key` exists and
      is written once at creation and never again, so "Custom order" currently
      orders by creation

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

- [ ] `docs/screenshots` is about 13 MB of full-resolution PNGs displayed at
      380px. Downscaling to ~1200px would make cloning the repository markedly
      cheaper
- [ ] The e2e sign-in occasionally fails and passes on a re-run. Worth finding
      rather than tolerating — a flaky auth test is the one you least want to
      learn to ignore
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
