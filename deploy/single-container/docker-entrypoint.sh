#!/bin/sh
# Two jobs, both existing because of how supervisord's %(ENV_X)s expansion
# actually behaves — found by running this image, not assumed:
#
# 1. Materialize the one NATS credentials file every process below shares
#    (production is one Synadia user with no per-service allow-list — see
#    notes/ops/production-deployment-guide.md §1) from an environment
#    variable instead of assuming the platform has a "secret file" feature
#    like Render's. Every platform lets you set an env var; not every
#    free-tier platform has been verified here to support a mounted secret
#    file, so this is the one thing that has to work everywhere.
#
# 2. Default every OPTIONAL variable supervisord.conf references via
#    %(ENV_X)s to an empty string if it is not set at all. supervisord's own
#    expansion is all-or-nothing: a variable that is merely unset (as
#    opposed to set-to-empty) makes it refuse to start ANY program, not just
#    the one referencing that variable — confirmed by actually running this
#    image with a handful of optional variables omitted, which took down the
#    whole container instead of leaving one field blank. A platform
#    dashboard that lets an operator skip an optional field (GEMINI_API_KEY,
#    TELEMETRY_OTLP_ENDPOINT, ...) must not be able to fail the entire
#    backend fleet over it.
set -eu

if [ -z "${NATS_CREDS_CONTENT:-}" ]; then
    echo "docker-entrypoint: NATS_CREDS_CONTENT is empty — every backend process needs it to reach NATS. See ../.env.example." >&2
    exit 1
fi

mkdir -p /app/secrets
printf '%s\n' "$NATS_CREDS_CONTENT" > /app/secrets/nats.creds
chown app:app /app/secrets/nats.creds
chmod 600 /app/secrets/nats.creds

# Every name supervisord.conf references as %(ENV_X)s. Required ones
# (NATS_URL, the per-service DATABASE_URL/DATABASE_DIRECT_URL pairs,
# AUTH_ACCESS_PRIVATE_KEY) are listed too: defaulting them to empty does not
# make the deploy work with them missing, it only changes the failure from
# "supervisord won't start anything" to "the process that needed it fails
# its own README-documented way" (auth-service crash-loops with no signing
# key, dna/universe/etc. fail their own migration with no DATABASE_URL) —
# which is the failure mode .env.example's reader is already set up to
# diagnose, one service at a time, instead of a config-parse error naming a
# variable with no file/line to look at.
export PORT="${PORT:-}"
export API_ALLOWED_ORIGINS="${API_ALLOWED_ORIGINS:-}"
export NATS_URL="${NATS_URL:-}"
export REDIS_URL="${REDIS_URL:-}"
export ADMIN_ROUTES_ENABLED="${ADMIN_ROUTES_ENABLED:-false}"
export ADMIN_ALLOWED_ORIGIN="${ADMIN_ALLOWED_ORIGIN:-}"
export ADMIN_ACCESS_PUBLIC_KEYS="${ADMIN_ACCESS_PUBLIC_KEYS:-}"
export TELEMETRY_ENABLED="${TELEMETRY_ENABLED:-false}"
export DNA_DATABASE_URL="${DNA_DATABASE_URL:-}"
export DNA_DATABASE_DIRECT_URL="${DNA_DATABASE_DIRECT_URL:-}"
export AI_PROVIDER="${AI_PROVIDER:-mock}"
export GEMINI_API_KEY="${GEMINI_API_KEY:-}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
export UNIVERSE_DATABASE_URL="${UNIVERSE_DATABASE_URL:-}"
export UNIVERSE_DATABASE_DIRECT_URL="${UNIVERSE_DATABASE_DIRECT_URL:-}"
export NATURE_DATABASE_URL="${NATURE_DATABASE_URL:-}"
export NATURE_DATABASE_DIRECT_URL="${NATURE_DATABASE_DIRECT_URL:-}"
export OCEAN_DATABASE_URL="${OCEAN_DATABASE_URL:-}"
export OCEAN_DATABASE_DIRECT_URL="${OCEAN_DATABASE_DIRECT_URL:-}"
export UNIVERSE_PUBLIC_WEB_URL="${UNIVERSE_PUBLIC_WEB_URL:-}"
export NATURE_PUBLIC_WEB_URL="${NATURE_PUBLIC_WEB_URL:-}"
export OCEAN_PUBLIC_WEB_URL="${OCEAN_PUBLIC_WEB_URL:-}"
export AUTH_DATABASE_URL="${AUTH_DATABASE_URL:-}"
export AUTH_DATABASE_DIRECT_URL="${AUTH_DATABASE_DIRECT_URL:-}"
export AUTH_ACCESS_PRIVATE_KEY="${AUTH_ACCESS_PRIVATE_KEY:-}"
export ANALYTICS_DATABASE_URL="${ANALYTICS_DATABASE_URL:-}"
export ANALYTICS_DATABASE_DIRECT_URL="${ANALYTICS_DATABASE_DIRECT_URL:-}"
export TELEMETRY_DATABASE_URL="${TELEMETRY_DATABASE_URL:-}"
export TELEMETRY_DATABASE_DIRECT_URL="${TELEMETRY_DATABASE_DIRECT_URL:-}"
export TELEMETRY_OTLP_ENDPOINT="${TELEMETRY_OTLP_ENDPOINT:-}"
export TELEMETRY_DASHBOARD_URL="${TELEMETRY_DASHBOARD_URL:-}"

exec "$@"
