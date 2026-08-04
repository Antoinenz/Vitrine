#!/usr/bin/env bash
# Publishes the current source to the test service on :5174.
#
# The service runs from its own snapshot of the build rather than sharing
# `build/` with the development server. SvelteKit emits content-hashed chunks,
# so rebuilding under a running process deletes the exact files it has already
# resolved — the server then 500s on every request until restarted, which is a
# worse failure than simply serving something stale.
set -euo pipefail

cd "$(dirname "$0")/.."
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" && nvm use >/dev/null

echo "Building…"
npm run build >/dev/null

echo "Publishing to build-prod/…"
rm -rf build-prod
cp -r build build-prod

echo "Restarting service…"
systemctl --user restart vitrine.service

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null http://localhost:5174/; then
    echo "Live: http://antoinepi.tail7cc527.ts.net:5174"
    exit 0
  fi
  sleep 1
done

echo "Service did not come up; check: journalctl --user -u vitrine -n 30" >&2
exit 1
