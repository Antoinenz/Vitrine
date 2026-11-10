#!/usr/bin/env bash
# Builds here and publishes to production: container 114 (`web`) on akl-104.
#
# The container has no route of its own from this machine, so everything goes
# through the Proxmox host: `ssh akl-104`, then `pct exec 114`. Override with
# DEPLOY_HOST / DEPLOY_CT if it moves again.
#
# The build is staged next to the live one and swapped in with two renames, so
# the running server never sees a half-copied tree. SvelteKit's chunks are
# content-hashed: rebuilding under a running process deletes files it has
# already resolved and it 500s until restarted. The previous build is kept as
# build-prev, and restored automatically if the new one doesn't come up.
#
# Dependencies are reinstalled on the container only when the lockfile differs,
# because `sharp` is native and the container is x86_64 while this may not be.
set -euo pipefail

HOST="${DEPLOY_HOST:-akl-104}"
CT="${DEPLOY_CT:-114}"
APP=/home/vitrine/gallery
PUBLIC=https://gallery.tachyon-studios.com

cd "$(dirname "$0")/.."
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" && nvm use >/dev/null

if [ -n "$(git status --porcelain)" ]; then
	echo "Working tree is dirty; commit first so prod is a known revision." >&2
	exit 1
fi

echo "Building $(git rev-parse --short HEAD)…"
npm run build >/dev/null

# Runs a script inside the container as root.
ct() { ssh -o BatchMode=yes "$HOST" "sudo -n pct exec $CT -- bash -s"; }

echo "Shipping to $HOST/CT $CT…"
tar -c --owner=0 --group=0 build drizzle package.json package-lock.json \
	| ssh -o BatchMode=yes "$HOST" "sudo -n pct exec $CT -- bash -c '
		set -e
		rm -rf /tmp/vitrine-stage && mkdir /tmp/vitrine-stage
		tar -x -C /tmp/vitrine-stage --no-same-owner
		chown -R vitrine:vitrine /tmp/vitrine-stage'"

ct <<EOF
set -euo pipefail
cd $APP
S=/tmp/vitrine-stage
as() { runuser -u vitrine -- "\$@"; }

if ! cmp -s \$S/package-lock.json package-lock.json; then
	echo "Lockfile changed; reinstalling production dependencies…"
	as cp \$S/package.json \$S/package-lock.json .
	as env PATH=/opt/node-24/bin:\$PATH npm ci --omit=dev --no-audit --no-fund >/dev/null
fi

rm -rf drizzle.new build-new
as cp -r \$S/drizzle drizzle.new
as cp -r \$S/build build-new
rm -rf drizzle && mv drizzle.new drizzle
rm -rf build-prev && mv build-prod build-prev && mv build-new build-prod

systemctl restart vitrine
for _ in \$(seq 1 30); do
	if curl -sf -o /dev/null http://127.0.0.1:5174/; then echo "Up."; exit 0; fi
	sleep 1
done

echo "New build did not come up; rolling back." >&2
journalctl -u vitrine -n 30 --no-pager >&2
rm -rf build-prod && mv build-prev build-prod
systemctl restart vitrine
exit 1
EOF

code=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC/")
echo "Live: $PUBLIC ($code)"
[ "$code" = 200 ]
