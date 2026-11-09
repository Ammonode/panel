#!/bin/sh
# Migrate and seed (both idempotent), then start the panel.
set -e
if [ -z "$APP_KEY" ]; then
  echo "APP_KEY is not set. Generate one with: docker run --rm ghcr.io/ammonode/panel bun apps/server/src/cli.ts key:generate" >&2
  exit 1
fi
bun apps/server/src/cli.ts migrate
bun apps/server/src/cli.ts seed
exec "$@"
