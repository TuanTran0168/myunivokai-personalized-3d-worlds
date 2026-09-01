# Single-container backend deploy — research + build

> **Status:** Built and smoke-tested locally (`docker build` succeeds, image
> is 443 MB; running it with dummy credentials confirms `supervisord.conf`
> parses correctly and all eight processes start, each failing only on its
> own genuinely-missing value — e.g. `auth` reports `AUTH_ACCESS_PRIVATE_KEY
> is required`, `dna` reports `DATABASE_URL is required` — exactly the
> per-service error a real deploy with an incomplete `.env` would see). That
> smoke test is also what found and fixed the bug described below in
> "Why `docker-entrypoint.sh` defaults every optional variable." **Not yet
> deployed as a real Render service** — the deployment steps live in
> `agent-system/skills/render-single-container-deployment-guide.md` and have not been
> run against real Neon/Upstash/Synadia credentials yet. Treat the
> resource-fit section as the first thing to verify there.

## The research: why not leave Render for a new platform at all?

The premise going in was to escape Render entirely — Hugging Face Spaces or
Koyeb, one container, no sleep, no shared monthly instance-hour cap like
Render's 750h/account. As of August 2026, **neither actually works out**,
and the real fix turned out not to need a new platform:

### Hugging Face Spaces — Docker SDK is no longer free

Spaces backed by the **Docker SDK** (what a custom multi-process container
needs — this repo is not a Gradio app) now require a **paid plan**: PRO for
a personal account, Team/Enterprise for an organization. This changed
recently — community reports place it around July 2026, and the forum
thread title says it plainly: *"Docker SDK now marked as Paid when creating
a new Space."* Free accounts can still host Gradio apps and a couple of
ZeroGPU Spaces, but not an arbitrary Dockerfile. **This rules HF Spaces out
as a free option for this repo entirely** — not a resource-fit problem, a
"you cannot create the Space" problem.

### Koyeb — ruled out by its own acquisition, not by its free tier

Koyeb's free tier was never actually "no sleep" to begin with — it slept
too, just after a longer idle window (1h) than Render's (15m), so that part
of the original premise was already wrong. What made it a dead end outright:
Mistral AI acquired Koyeb in February 2026, folding it into "Mistral
Compute," and by August 2026 its dashboard is visibly mid-transition — new
accounts see a chat widget pushing a paid "Starter" plan instead of a
working "Create Service" flow. Building a production dependency on a
platform mid-acquisition, with no confirmed-working free tier, is not worth
more scaffold time.

### The actual answer was already sitting in `render.yaml`

Every one of the 8 existing backend services is already declared with
`runtime: docker`, its own `dockerfilePath`, and `dockerContext: .`
(`render.yaml`'s `myunivokai-gateway` block and the same shape repeated for
the other seven). Render's Docker support isn't a workaround being reached
for here — it's the exact mechanism these services already run on today.
Nothing about this folder's `Dockerfile`/`supervisord.conf` pairing is
platform-specific; it's a generic "one image, one exposed port, eight
processes inside" package that any `runtime: docker` Render service already
knows how to run. The trick was never finding a new host — it's pointing
**one more Render service** at *this* `Dockerfile` instead of running eight
separate ones, each built from its own `Dockerfile.prod`.

Consolidating 8 Render web services into 1 keeps everything else identical
— same account, same dashboard, same Neon/Upstash/Synadia credentials
already sitting in each service's Environment tab — while fixing the actual
problem `agent-system/skills/production-deployment-guide.md` §5.3 and `render.yaml`'s
own comments have been tracking: the shared 750-hour/month pool split
across every free service in the account. Eight containers divide that
budget eight ways; one container divides it by one. It also collapses
"wake one sleeping sibling that might itself need to wake another" into a
single wake, since every process is already running together the moment
that one container is up. See
`agent-system/skills/render-single-container-deployment-guide.md` for the concrete
steps: add the service, reuse the credentials already in the other eight
services' Environment tabs, verify it, and only then decommission the
eight originals.

**The real open question is still resource fit, not policy.** Render Free's
RAM/vCPU allotment for eight processes running at once (api-gateway, dna,
universe, nature, ocean, auth, analytics, telemetry) has not been measured
against this image yet. Go binaries idle small (single-digit to
low-double-digit MB RSS each); the Rust binary should be similar. Per-process
footprint is implicitly already proven, since the account runs all eight as
*separate* free instances today — what's new is eight of them sharing one
instance's CPU at once during a cold boot that opens eight NATS connections
and runs six Postgres migrations back-to-back. Whether that trips Render's
own health-check timeout is a real risk only an actual deploy will answer.
If it doesn't fit: the honest next step is trimming which services run here
(e.g. defer `ocean`/`nature` and keep them as separate Render services a
while longer) or a paid Render instance for just this one consolidated
service (still one bill instead of scaling all eight up), not fighting the
free tier harder.

### Frontends are explicitly out of scope here

`myunivokai-web` already runs on Vercel — `render.yaml`'s own top comment
says so — which has no per-service instance-hour budget to escape in the
first place. `myunivokai-admin` is a second Next.js app with its own
hardcoded cookie paths (`middleware.ts`, `auth-relay.ts`, `login/page.tsx`
all set `Path=/api/admin/auth` or `Path=/`); reverse-proxying it under a
shared path prefix on one port would need those paths rewritten to match,
which is an app-code change this scaffold does not make. Keeping both
frontends where they already work avoids that rabbit hole. **This deploy
covers the eight backend services only** — the actual source of Render's
750h pressure.

## What's in this folder

| File | What it does |
| --- | --- |
| `Dockerfile` | Multi-stage build: one builder stage per service (the exact `go build`/`cargo build` command each service's own `Dockerfile.prod` already runs), all copied into one Debian runtime stage |
| `supervisord.conf` | Runs and restarts all eight processes; maps each service's per-database env vars onto the generic `DATABASE_URL`/`PORT` names each binary actually reads |
| `docker-entrypoint.sh` | Writes `NATS_CREDS_CONTENT` to `/app/secrets/nats.creds` before supervisord starts — see why below |
| `.env.example` | Every environment variable to set on the platform, one section per service |

## Why an entrypoint script writes the NATS credentials file

Render already links every one of the 8 existing services to a
`myunivokai-shared-env` group holding `NATS_URL` and a `nats.creds` Secret
File (see `render.yaml`'s comments near the `myunivokai-analytics` and
`myunivokai-telemetry` blocks) — but that linkage is dashboard-only, it has
no representation in `render.yaml` itself, so a newly-created consolidated
service would not inherit it automatically. Rather than assume that manual
step happens correctly on first deploy, this scaffold uses the one
mechanism guaranteed to work the same way regardless: an environment
variable. `NATS_CREDS_CONTENT` holds the full multi-line contents of the
`.creds` file Synadia issues, and `docker-entrypoint.sh` writes it to disk
before any backend process starts. Linking this service to the existing
Secret File group instead is a small follow-up once this deploys
successfully once, not a redesign.

## Why `docker-entrypoint.sh` defaults every optional variable

Found by actually running the built image, not by reading supervisor's
docs: `supervisord`'s `%(ENV_X)s` expansion is all-or-nothing at the
*config-parse* stage, not per-program. Leaving a handful of optional
variables unset entirely (as opposed to set to an empty string) — the first
smoke test skipped `ADMIN_ALLOWED_ORIGIN`, `GEMINI_API_KEY`, and a few
others — made supervisord refuse to start **any** of the eight programs,
with one error naming a variable and a section, not eight independent
failures. A platform dashboard that lets an operator skip an optional field
must not be able to take down the entire backend fleet over it, so
`docker-entrypoint.sh` now exports every name `supervisord.conf` references
with `${VAR:-}` (or a real default, e.g. `AI_PROVIDER` falling back to
`mock`) before handing off to supervisord. This does not make the deploy
work with a required value missing — it changes *how* it fails, from one
opaque config-parse error to eight independent, service-specific ones
(confirmed above: `auth` names its own missing key, `dna` names its own
missing database, and so on) — which is the failure mode this README's
`.env.example` table is written to help diagnose.

## Why every non-gateway process gets an explicit `PORT`

Every `cmd/service/main.go` in this repo binds a bare `/healthz` server on
`$PORT`, defaulting to `:8080` when unset — harmless on Render, where each
service is its own container, fatal here, where all eight share one network
namespace and a second bind to `:8080` crashes on boot.
`supervisord.conf` gives dna/universe/nature/ocean/auth/analytics one fixed
port each (8082-8087) and telemetry 8081; only `api-gateway` binds the
platform's actual public port. None of the other seven ports are reachable
from outside the container — nothing needs them to be, since
`SERVICE_WAKE_PLATFORM=none` here (there is no sleeping sibling to wake;
everything is already running in the same container the whole time it's up).

## Building and deploying

```bash
# From the repository root — every service's go.mod depends on contracts/go
# (and telemetry-service on contracts/rust) at this fixed relative path,
# exactly like render.yaml's own dockerContext: . for every service.
docker build -f deploy/single-container/Dockerfile -t myunivokai-services-single .

# Local smoke test before pushing to a registry — fill in a real .env first,
# copied from .env.example. NATS_CREDS_CONTENT is passed separately with -e
# rather than through --env-file: Docker's --env-file format is line-based
# and cannot hold a real multi-line value, but a shell variable can, and
# docker run -e forwards it whole. Put the raw .creds file contents in
# deploy/single-container/.env.nats-creds (gitignored, matches .env.* in
# .gitignore) and this command reads it at invocation time:
docker run --rm -p 8080:8080 \
  --env-file deploy/single-container/.env \
  -e NATS_CREDS_CONTENT="$(cat deploy/single-container/.env.nats-creds)" \
  myunivokai-services-single
```

On Render: create a new **Web Service** with `runtime: docker`,
`dockerfilePath: ./deploy/single-container/Dockerfile`, and
`dockerContext: .` — the exact same shape every other service in
`render.yaml` already uses, just pointed at this Dockerfile instead of a
service's own `Dockerfile.prod`. Set the port to 8080, and fill in every
variable from `.env.example` under the service's Environment tab (values
for dna/universe/nature/auth/analytics/telemetry/ocean already exist in the
other eight services' own Environment tabs — this is reuse, not new
provisioning). First boot runs six Postgres migrations and eight NATS
connections back-to-back on one shared instance — give the health check a
generous grace period before assuming it's stuck. See
`agent-system/skills/render-single-container-deployment-guide.md` for the full,
step-by-step version of this.

## What's unverified and should be checked on a real account before relying on this

- Whether eight processes actually fit in one Render Free instance's
  RAM/vCPU under real load, not just at idle.
- Whether a cold boot completes before Render's own health-check deadline
  when it's one shared instance instead of eight separate ones.
- Whether linking this service to the existing `myunivokai-shared-env`
  Secret File group (see above) works cleanly, letting
  `docker-entrypoint.sh`'s `NATS_CREDS_CONTENT` step be replaced with a
  direct file mount.
