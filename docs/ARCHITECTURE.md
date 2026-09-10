# Architecture notes

Decisions that aren't obvious from reading the code, and the reasoning behind them.

## No native SQLite dependency

The database layer runs on Node's built-in `node:sqlite` rather than `better-sqlite3`.

The native package's prebuilt binaries need a newer glibc than Debian 12 or `node:24-bookworm` ship, and falling back to a source build requires a C++ toolchain — unreasonable friction for an app whose whole premise is that you can install it yourself. A small shim (`src/lib/server/db/sqlite-shim.ts`) adapts the built-in module to the interface Drizzle's synchronous driver expects, keeping transactions and savepoints with zero native dependencies.

This is why `npm install` needs no compiler.

## The processing queue lives in the database

`photos.status` _is_ the queue. A crash mid-encode doesn't lose work: anything left `processing` is picked up again at startup.

Requiring Redis to resize images would be the heaviest operational cost in an app meant to run on a cheap VPS — a second service to install, monitor and back up, for a job that one process can do.

## Ordering uses fractional keys

Dragging a photograph to a new position rewrites one row rather than renumbering the collection. Keys are strings ordered lexically, and a new key is generated _between_ its neighbours.

## Collections are dated by their photographs

A collection's position on the artist page comes from the latest capture date among its photographs, not from when it was uploaded — otherwise a series shot in 2019 and scanned last week outranks this year's work.

Three levels, in order of trust: an explicit date the artist set, the newest EXIF capture date in the collection, then the creation date for photographs carrying no EXIF at all.

The subtlety is that `takenAt` is an ISO string inside a JSON column while the other two are integers, so it must be converted to epoch milliseconds before they can share a `coalesce`. Comparing a string to an integer would not error — SQLite sorts every integer below every string, so the gallery would quietly split into two blocks. That conversion is why the ordering lives in its own module with a test against a real database.

## The collections table has one reader

Every read of `collections` lives in `lib/server/collections.ts`, and a test
fails the build if the table is queried anywhere else. The rule exists because a
trashed collection has to vanish from nine read paths written at nine different
times, and the cost of missing one is not a stale listing — it is work the
artist believes they deleted, still served at a URL a client may already hold.

The first version of the rule banned `from(collections)` and missed three
queries that reached the table sideways, through `innerJoin`, to check access
while selecting something else. Those served every rendition and every original
of a trashed collection to anyone holding a photograph id, which the page
publishes in `data-photo`.

Queries like that cannot move into the module — the collection is not what they
select — so they follow a second rule instead: join it if you must, but say
`notTrashed` while you do, and the same test enforces that.

## Metadata is an allow-list

A field is published only by being named, so adding a newly extracted EXIF tag can't leak it by default. Location is withheld unless deliberately enabled.

Served renditions are re-encoded and carry no metadata at all, whatever the display settings say — the displayed fields come from the database, not from the file the visitor downloads.

## Session lifetime is sent as a duration

The cookie carries `Max-Age`, not an absolute `Expires`.

`Expires` is a date written by the server and judged against the _browser's_ clock. When the two disagree by more than the session lifetime, the browser is handed a cookie already in its own past and discards it on arrival — and sign-in then fails silently, because from the server's side the login succeeded and there is nothing to log.

`Max-Age` is counted by the browser from the moment the response lands, so a constant offset between the clocks cancels out. The database keeps the absolute expiry; server-side validation is judged against the clock that wrote it.

## The `Secure` flag follows the request scheme

Set unconditionally in production, it breaks sign-in over plain HTTP — which is how a self-hosted install is usually first reached, on a LAN or a Tailscale address. The browser discards the cookie and the login form simply reappears.

Following the request scheme keeps the flag on wherever it can do its job and off where it would only break sign-in. Behind a TLS-terminating proxy this resolves itself: production requires `ORIGIN`, and the scheme is read from it, so setting `ORIGIN=https://…` is already enough. `PROTOCOL_HEADER=x-forwarded-proto` only matters if you run without `ORIGIN` — and note that a request arriving _without_ that header is then treated as HTTPS, which will reject a plain-HTTP sign-in from a LAN address.

## Transitions capture, then claim

Opening a collection animates its photographs from the stack into the grid across a real navigation, not inside a modal. The stack is captured into a fixed overlay on click; the arriving page claims that overlay and animates it into place.

Every capture must therefore be either claimed or cleaned up. Navigate away before the destination mounts and nobody claims it, so a capture also arms its own expiry, and arriving at a route that cannot play one cancels it. Without both, an unclaimed grid of photographs can be left floating above the gallery.
