#!/usr/bin/env bash
# Standalone equivalent of `make local-up-detached` (see Makefile), for anyone
# running the stack without `make` on PATH. Keep the two in sync.
set -euo pipefail
cd "$(dirname "$0")"

# --env-file is mandatory, not decorative: Compose only auto-loads a file
# literally named `.env`, so without this flag `.env.local` is ignored and
# every service falls back to the compose file's own defaults.
#
# SERVICE_VERSION mirrors the Makefile's export: nothing else supplies one to
# a bind-mounted local container, so an unstamped stack reports "unknown" for
# every service on the admin Fleet screen.
export SERVICE_VERSION="${SERVICE_VERSION:-$(git describe --always --dirty 2>/dev/null || echo unknown)}"

docker compose --env-file .env.local -f docker-compose-local.yaml up --build --detach --remove-orphans
