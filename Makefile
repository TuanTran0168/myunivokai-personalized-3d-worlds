# --env-file is mandatory, not decorative: Compose only auto-loads a file named
# `.env`, so without this the root `.env.local` is ignored and every service
# silently falls back to the compose-file defaults.
DOCKER_COMPOSE := docker compose --env-file .env.local -f docker-compose-local.yaml
.DEFAULT_GOAL := local-up

# Every service reports SERVICE_VERSION when it announces its own boot, and the
# admin Fleet screen shows it. Nothing supplies one locally: the container has
# no RENDER_GIT_COMMIT, and the Go toolchain's VCS stamp does not survive a
# bind-mounted repo, so an unstamped local stack reports "unknown" for the whole
# fleet. `describe --always --dirty` is used rather than a bare rev-parse
# because an uncommitted tree is not the commit it points at, and a version
# that names the wrong code is worse than one that admits it does not know.
# Compose interpolation reads the shell environment ahead of --env-file, so
# exporting it here overrides .env.local; set SERVICE_VERSION yourself to pin.
SERVICE_VERSION ?= $(shell git describe --always --dirty 2>/dev/null)
export SERVICE_VERSION

.PHONY: local-up local-up-detached local-down local-logs local-status

local-up:
	$(DOCKER_COMPOSE) up --build --remove-orphans

local-up-detached:
	$(DOCKER_COMPOSE) up --build --detach --remove-orphans

local-down:
	$(DOCKER_COMPOSE) down --remove-orphans

local-logs:
	$(DOCKER_COMPOSE) logs --follow

local-status:
	$(DOCKER_COMPOSE) ps
