# Configuration

Every setting Vitrine reads, what it does, and the handful that actually matter.

If you just want a gallery running, the [quick start](../README.md#quick-start) covers it — you need three variables. Everything below is for when you want something specific.

- [The three that matter](#the-three-that-matter)
- [Storage](#storage)
- [Uploads](#uploads)
- [Image processing](#image-processing)
- [Sessions](#sessions)
- [Server](#server)
- [Running behind a proxy or tunnel](#running-behind-a-proxy-or-tunnel)
- [Low-powered hardware](#low-powered-hardware)
- [Backups](#backups)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)

## The three that matter

| Variable         | Default | Notes                                                                                                                                                                                 |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN`         | —       | The URL visitors actually type, scheme and port included. Required in production. Get this wrong and browsing works while signing in fails — see [troubleshooting](#troubleshooting). |
| `ADMIN_EMAIL`    | —       | Read only on first boot, while no account exists. Ignored afterwards.                                                                                                                 |
| `ADMIN_PASSWORD` | —       | Same. Must be 12+ characters in production. You are asked to change it at first sign-in, so it never stays valid.                                                                     |

Once your account exists, `ADMIN_EMAIL` and `ADMIN_PASSWORD` do nothing. Leaving them in `docker-compose.yml` is harmless but pointless; removing them is tidier.

## Storage

| Variable       | Default      | Notes                                                                           |
| -------------- | ------------ | ------------------------------------------------------------------------------- |
| `DATA_DIR`     | `./data`     | Database, original uploads and generated renditions. Your whole backup surface. |
| `DATABASE_URL` | `vitrine.db` | A relative path resolves inside `DATA_DIR`. Absolute paths are used as given.   |

`DATA_DIR` holds three things: `vitrine.db`, `originals/` (your uploads, untouched) and `derivatives/` (the resized, re-encoded versions actually served). There is no external service and no second datastore.

## Uploads

| Variable          | Default | Notes                                                           |
| ----------------- | ------- | --------------------------------------------------------------- |
| `MAX_UPLOAD_MB`   | `100`   | Largest single file accepted. Raise it for large scans or raws. |
| `BODY_SIZE_LIMIT` | `512M`  | The HTTP body ceiling. See below.                               |

**`BODY_SIZE_LIMIT` is a trap worth knowing about.** The underlying server defaults it to 512kb, which rejects every realistic photo upload with an opaque `413` and no explanation. The Docker image already sets it to `512M`, so you only need to think about it if you run outside Docker.

A reverse proxy in front needs its own limit raised to match:

```nginx
client_max_body_size 512m;
```

Caddy has no request body limit by default and needs nothing.

## Image processing

| Variable             | Default     | Notes                                                                         |
| -------------------- | ----------- | ----------------------------------------------------------------------------- |
| `IMAGE_FORMATS`      | `avif,webp` | Rendition formats, most-preferred first. Browsers get the first they support. |
| `WORKER_CONCURRENCY` | `2`         | Photographs encoded in parallel. The main lever on peak memory.               |

Every upload is resized to a fixed ladder of widths — 320, 640, 1280, 2048 and 3840 pixels — in each format you list. That ladder is not configurable; it is chosen to cover a thumbnail through a 4K display without generating renditions nobody requests.

Each worker holds a decoded bitmap plus its encode buffers, so `WORKER_CONCURRENCY` multiplies memory use during a bulk upload. On a machine with 1–2 GB of RAM, leave it at `2` or drop it to `1`.

## Sessions

| Variable           | Default | Notes                           |
| ------------------ | ------- | ------------------------------- |
| `SESSION_TTL_DAYS` | `30`    | How long a sign-in stays valid. |

Sessions slide: using the gallery past the halfway point renews them, so an artist who visits weekly is never signed out. An abandoned session still ages out on schedule.

## Server

| Variable   | Default      | Notes                                                                |
| ---------- | ------------ | -------------------------------------------------------------------- |
| `PORT`     | `3000`       |                                                                      |
| `HOST`     | `0.0.0.0`    | Bind address. Set `127.0.0.1` if only a local proxy should reach it. |
| `NODE_ENV` | `production` | Set by the Docker image. Enforces the 12-character password minimum. |

## Running behind a proxy or tunnel

Cloudflare Tunnel, nginx, Caddy, Traefik — the rule is the same. **`ORIGIN` must be the public URL your browser shows**, not the address the proxy forwards to:

```sh
# The gallery listens on localhost:3000, but visitors arrive at:
ORIGIN=https://gallery.example.com
```

Point it at the internal address and the gallery still browses perfectly — every page, every image — while signing in fails with a bare `403 Forbidden` in the network tab and nothing on the page.

**`ORIGIN` is a single value.** SvelteKit rejects form submissions whose `Origin` header doesn't match it, so browsing works from anywhere but signing in only works at the configured address. If you reach your gallery both over Tailscale and at a public domain, pick the one you'll administer from. SvelteKit's `csrf.trustedOrigins` allow-list would lift that restriction, but it is **build-time** configuration and so can't be set through an environment variable on a prebuilt image.

## Low-powered hardware

On a Raspberry Pi or a 1 vCPU VPS, set:

```sh
IMAGE_FORMATS=webp
WORKER_CONCURRENCY=1
```

AVIF compresses better than WebP but costs seconds of CPU per rendition, which is painful when you drop 200 photographs at once. WebP alone is a large speed-up for a small size penalty.

Nothing is lost by changing your mind later: delete `derivatives/` and restart, and every rendition is generated again from the untouched originals.

## Backups

`DATA_DIR` is the entire backup surface — database, originals and renditions. There is no external service and no second datastore.

The default `docker-compose.yml` stores it in a **named volume**, so there is no `./data` folder on the host to copy. Compose prefixes volume names with the project — usually the folder name — so the volume is `vitrine_vitrine-data`, not `vitrine-data`. Check yours first, because naming the wrong one silently mounts a new empty volume and hands you an empty archive:

```sh
docker volume ls | grep vitrine
```

Then stop the container and archive it:

```sh
docker compose stop
docker run --rm \
  -v vitrine_vitrine-data:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/vitrine-$(date +%F).tar.gz -C /data .
docker compose start
```

Confirm it isn't empty before trusting it:

```sh
tar tzf vitrine-$(date +%F).tar.gz | head
```

If you would rather have the files sitting in a directory you can see and rsync, swap the volume for a bind mount in `docker-compose.yml`:

```yaml
volumes:
  - ./data:/data # instead of  vitrine-data:/data
```

Then a backup is just `tar czf backup.tar.gz data/`, and you can drop the `volumes:` block at the bottom of the file.

Copying while the container runs usually works but can catch the database mid-write; stopping first is a few seconds well spent. If you only have room for one thing, keep `vitrine.db` and `originals/` — `derivatives/` regenerates itself from the originals.

## Upgrading

Pull the new image and restart. Migrations apply automatically at startup.

```sh
docker compose pull
docker compose up -d
```

Take a backup first. Migrations run forward only; there is no down-migration path.

## Troubleshooting

**Signing in returns `403 Forbidden`.** Almost always `ORIGIN` not matching the address in your browser's URL bar. The origin check runs before any code that could explain itself, which is why the page shows nothing. See [running behind a proxy or tunnel](#running-behind-a-proxy-or-tunnel).

**Uploads fail with `413`.** `BODY_SIZE_LIMIT` outside Docker, or a reverse proxy's own body limit. See [uploads](#uploads).

**Signing in appears to do nothing, with no error.** The browser is discarding the session cookie. Two known causes: a `Secure` cookie served over plain HTTP, and a server clock far enough out that the cookie arrives already expired. Both are handled now — the flag follows the request scheme, and lifetime is sent as a duration rather than an absolute date — but if you see it, check `date` on the server.

**Photographs stay pending.** The worker picks up anything stranded at startup, so restart first. If they fail repeatedly, the file may be a format `sharp` can't decode.
