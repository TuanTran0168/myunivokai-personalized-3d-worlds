#!/bin/sh
# Keep this script POSIX-compatible because the PostgreSQL image runs Alpine sh.
set -eu

export PGPASSWORD="${POSTGRES_ADMIN_PASSWORD}"

psql --username "${POSTGRES_ADMIN_USER}" --dbname postgres --set ON_ERROR_STOP=1 \
  --set dna_database="${DNA_DATABASE_NAME}" --set dna_user="${DNA_DATABASE_USER}" --set dna_password="${DNA_DATABASE_PASSWORD}" \
  --set universe_database="${UNIVERSE_DATABASE_NAME}" --set universe_user="${UNIVERSE_DATABASE_USER}" --set universe_password="${UNIVERSE_DATABASE_PASSWORD}" \
  --set nature_database="${NATURE_DATABASE_NAME}" --set nature_user="${NATURE_DATABASE_USER}" --set nature_password="${NATURE_DATABASE_PASSWORD}" \
  --set ocean_database="${OCEAN_DATABASE_NAME}" --set ocean_user="${OCEAN_DATABASE_USER}" --set ocean_password="${OCEAN_DATABASE_PASSWORD}" \
  --set auth_database="${AUTH_DATABASE_NAME}" --set auth_user="${AUTH_DATABASE_USER}" --set auth_password="${AUTH_DATABASE_PASSWORD}" \
  --set analytics_database="${ANALYTICS_DATABASE_NAME}" --set analytics_user="${ANALYTICS_DATABASE_USER}" --set analytics_password="${ANALYTICS_DATABASE_PASSWORD}"   --set telemetry_database="${TELEMETRY_DATABASE_NAME}" --set telemetry_user="${TELEMETRY_DATABASE_USER}" --set telemetry_password="${TELEMETRY_DATABASE_PASSWORD}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'dna_user', :'dna_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'dna_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'dna_user', :'dna_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'dna_database', :'dna_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'dna_database') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'universe_user', :'universe_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'universe_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'universe_user', :'universe_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'universe_database', :'universe_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'universe_database') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'nature_user', :'nature_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'nature_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'nature_user', :'nature_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'nature_database', :'nature_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'nature_database') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'ocean_user', :'ocean_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'ocean_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'ocean_user', :'ocean_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'ocean_database', :'ocean_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'ocean_database') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'auth_user', :'auth_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'auth_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'auth_user', :'auth_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'auth_database', :'auth_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'auth_database') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'analytics_user', :'analytics_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'analytics_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'analytics_user', :'analytics_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'analytics_database', :'analytics_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'analytics_database') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'telemetry_user', :'telemetry_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'telemetry_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'telemetry_user', :'telemetry_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'telemetry_database', :'telemetry_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'telemetry_database') \gexec
SQL
