# Development

## Getting set up

Requires **Node 24+**, pinned in `.nvmrc`. No compiler and no system libraries — see [architecture](ARCHITECTURE.md#no-native-sqlite-dependency) for why that's deliberate.

```sh
nvm use
npm install
cp .env.example .env    # then edit ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev
```

The dev server runs on `http://localhost:5173` with hot reload, and creates its account from `.env` on first boot exactly as production does.

## Commands

| Command               |                                                 |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | Dev server with hot reload                      |
| `npm run build`       | Production build                                |
| `npm run preview`     | Serve the production build locally              |
| `npm run check`       | Typecheck                                       |
| `npm run lint`        | Prettier + ESLint                               |
| `npm run format`      | Apply formatting                                |
| `npm run db:generate` | Generate migration SQL after editing the schema |
| `npm run seed`        | Populate a development gallery                  |

## Tests

```sh
npm run test:unit -- --run   # unit tests
npm run test:e2e             # browser tests (builds and serves automatically)
npm test                     # both
```

The unit suite pins `DATA_DIR` to a scratch directory itself, so running it can never touch your development data. The e2e suite builds the app and serves it on port 4173 against a fresh temporary install, seeded over HTTP by `e2e/global-setup.ts`.

Two conventions worth knowing before adding tests:

**Authentication is tested through a browser, never through `request`.** A shipped bug set the session cookie `Secure` unconditionally, so over plain HTTP the browser silently discarded it and sign-in looped back to the form with no error. Every test at the time passed, because an HTTP client that stores the cookie itself is free to ignore `Secure`. Only a real browser enforces it.

**Database behaviour is tested against real SQLite, not a mock.** The ordering and migration suites open actual database files. The questions they ask — does `strftime` parse this string, does a correlated subquery see the outer row, are these two values comparable — are questions about SQLite, and a fake would answer them the way the test author expected.

## Migrations

Migrations are **generated** by drizzle-kit but **applied by the app** at startup, so `db:migrate` isn't part of the normal workflow:

1. Edit `src/lib/server/db/schema.ts`
2. Run `npm run db:generate`
3. Restart — the new migration applies on boot

Files land in `drizzle/` and are discovered by lexical filename sort, so the numeric prefix is what orders them. They run forward only.

A migration that changes data rather than shape deserves a comment saying why it is safe. `0004_dated_at_is_an_override.sql` clears a column outright; it's justified in the file because every value in it had been machine-written and no interface for setting one had ever existed.

## Layout

```
src/
  lib/
    components/     Svelte components
    motion/         GSAP timelines, transitions, reduced-motion handling
    server/
      actions/      Form action handlers shared between routes
      db/           Drizzle schema, migrations runner, node:sqlite shim
      images/       EXIF extraction, rendition pipeline, worker queue
    upload/         Client-side upload queue and drop targets
  routes/           SvelteKit routes
drizzle/            Generated migration SQL
e2e/                Playwright specs
docs/               This documentation
```

Unit tests sit beside what they test (`foo.ts`, `foo.spec.ts`). Browser tests live in `e2e/`.

## Contributing

Issues and pull requests are welcome. Please run `npm run lint` and `npm run check` before opening one, and add tests for behaviour that isn't obvious from reading the code.

Comments here explain _why_, not _what_ — the code already says what it does. A comment earns its place by recording a decision, a constraint, or a trap that cost someone an afternoon.
