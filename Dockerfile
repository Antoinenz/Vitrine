# syntax=docker/dockerfile:1

# Node 24 is required, not merely preferred: the database layer uses the
# built-in `node:sqlite` module rather than a native SQLite package, which is
# what keeps this image free of a C++ toolchain and immune to the glibc
# mismatches that prebuilt native binaries suffer from.
ARG NODE_VERSION=24-bookworm-slim

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Install dependencies against the lockfile first, so this layer is reused
# whenever only source files change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies in place. SvelteKit bundles server code, so the runtime
# needs far less than the build did — notably sharp, which stays because its
# native binaries can't be bundled.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Photo uploads are large, and adapter-node otherwise rejects anything over
# 512kb with an opaque 413. This is the single most common cause of a
# fresh install appearing broken, so it ships correct.
ENV BODY_SIZE_LIMIT=512M

ENV DATA_DIR=/data
ENV PORT=3000

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# Migration SQL is read at startup, so it has to be present at runtime.
COPY --from=build /app/drizzle ./drizzle

# Run unprivileged. The `node` user ships with the base image; /data is chowned
# so the volume is writable without granting root.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME /data
EXPOSE 3000

# Hits a route that exercises the database, so an unhealthy container reflects
# "can't serve pages", not merely "process is alive".
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build/index.js"]
