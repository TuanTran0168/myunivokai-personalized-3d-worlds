# Sprint 01 deployment guide — event-driven cutover

> **Document status:** Executable runbook; managed deployment evidence pending
> **Sprint starts:** 2026-07-22
> **Last source review:** 2026-07-22

This guide defines the required production deployment evidence and matches the
Sprint 1 `render.yaml`, local Compose, component Dockerfiles and contracts.
Never paste secrets into this document, issues, logs or screenshots.

## 1. Target inventory

| Component | Production name | Type |
| --- | --- | --- |
| Web | `myunivokai-web` | Vercel/Render web |
| Gateway | `myunivokai-gateway` | Render Web Service |
| DNA | `myunivokai-dna` | Render Background Worker |
| Universe | `myunivokai-universe` | Render Background Worker |
| Nature | `myunivokai-nature` | Render Background Worker |
| NATS | provider-assigned | Managed NATS with JetStream |
| Redis | provider-assigned | Managed Redis-compatible service |
| PostgreSQL | Neon project | Three logical databases |

Background Worker is a Render type; service names intentionally have no
`-worker` suffix. Render does not offer Free instances for Background Workers,
so cost approval is a prerequisite.

## 2. Pre-deploy gate

- [ ] Release commit is on `main` through `staging`; CI is green.
- [ ] Root `docker-compose-local.yaml` include stack passes from empty volumes.
- [ ] Every production deployment references its component-owned two-stage
      `Dockerfile.prod`, never `Dockerfile.local`.
- [ ] Contract fixtures and OpenAPI validation pass.
- [ ] All old public services/database exact names are recorded for rollback,
      but no deletion command is prepared or automated.
- [ ] Managed NATS, Redis, Neon and Render are in compatible regions.
- [ ] A secret store/dashboard, not Git, holds every production credential.
- [ ] Paid always-on compute is approved for the three domain services.

Record evidence header:

```txt
commitSha:
deployedAtUtc:
operator:
webOrigin:
gatewayOrigin:
natsRegion:
redisRegion:
neonRegion:
```

## 3. Provision Neon

Create one project initially and exactly three logical databases:

```txt
myunivokai_dna
myunivokai_universe
myunivokai_nature
```

Create a least-privilege runtime role for each database. Collect:

- pooled `DATABASE_URL` for runtime;
- direct `DATABASE_DIRECT_URL` for migrations;
- `sslmode=require` on every production URL.

Negative checks:

- DNA credentials cannot read Universe/Nature tables.
- Universe credentials cannot read DNA/Nature tables.
- Nature credentials cannot read DNA/Universe tables.

Do not create or reuse ambiguous database name `myunivokai` for the target.

## 4. Provision NATS

Enable JetStream and create separate credentials for gateway, DNA, Universe,
Nature, and an operator/bootstrap identity. Apply least-privilege permissions
from [solution architecture](../../architecture/v1-2026-07-22/solution-architecture.md#9-security-boundary-without-user-auth).

Provision idempotently:

```txt
MYUNIVOKAI_COMMANDS
  subjects: myunivokai.commands.>
  retention: WorkQueue
  storage: File
  bounded max age/bytes/messages

MYUNIVOKAI_EVENTS
  subjects: myunivokai.events.>
  retention: Limits
  storage: File
  bounded max age/bytes/messages
```

Create durable pull consumers for DNA generation, Universe composition, Nature
composition and DNA family-result handling. Final `AckWait`, `MaxDeliver`,
backoff and dead-letter values come from reviewed environment/config and must
exceed the measured maximum handler stage without hiding hung jobs.

Verify:

- [ ] each publisher receives a JetStream acknowledgement;
- [ ] unauthorized subjects fail for every service credential;
- [ ] Core NATS query responders can publish only constrained reply subjects;
- [ ] TLS hostname/certificate verification is enabled;
- [ ] monitoring does not expose payloads or credentials publicly.

## 5. Provision Redis

Create the managed Redis instance and obtain a TLS URL. Configure memory and
eviction for cache workloads, bounded connection limits, and monitoring.

Verify:

- [ ] `SET`/`GET`/expiry work over TLS;
- [ ] rate-limit atomic operation/script works;
- [ ] keys use `myunivokai:` prefix;
- [ ] no durable job/world/DNA data depends only on Redis;
- [ ] Redis flush in staging causes cache miss/fallback, not data loss.

## 6. Render environment matrix

Before creating or promoting Render services, run
`npm audit --omit=dev --audit-level=high` in `apps/myunivokai-web`. Production
cutover remains blocked until Sprint story `S1-SECURITY-001` passes; a green
image build alone does not waive a vulnerable runtime dependency.

### `myunivokai-gateway`

```txt
APP_ENV=production
TRUST_PROXY=true
API_ALLOWED_ORIGINS=<exact web origins>
NATS_URL=<TLS URL>
NATS_USERNAME=<gateway credential user>
NATS_PASSWORD=<gateway credential secret>
REDIS_URL=<TLS URL>
RATE_LIMIT_*=<reviewed values>
JOB_CACHE_TTL=<reviewed duration>
WORLD_CACHE_TTL=<reviewed duration>
SHARE_CACHE_TTL=<reviewed duration>
NATS_REQUEST_TIMEOUT=<reviewed duration>
NATS_PUBLISH_TIMEOUT=<reviewed duration>
NATS_CONNECT_TIMEOUT=<reviewed duration>
NATS_RECONNECT_WAIT=<reviewed duration>
```

### `myunivokai-dna`

```txt
APP_ENV=production
DATABASE_URL=<myunivokai_dna pooled URL>
DATABASE_DIRECT_URL=<myunivokai_dna direct URL>
NATS_URL=<TLS URL>
NATS_USERNAME=<DNA credential user>
NATS_PASSWORD=<DNA credential secret>
AI_PROVIDER=<mock|gemini|openai>
AI_FALLBACK_PROVIDER=<reviewed provider>
AI_TIMEOUT=<reviewed duration>
GEMINI_API_KEY=<secret when used>
OPENAI_API_KEY=<secret when used>
NATS_ACK_WAIT=<longer than the maximum AI processing window>
NATS_MAX_DELIVER=<reviewed count>
NATS_FETCH_BATCH_SIZE=1
NATS_FETCH_MAX_WAIT=<reviewed duration>
NATS_RETRY_DELAY=<reviewed duration>
NATS_CONNECT_TIMEOUT=<reviewed duration>
NATS_RECONNECT_WAIT=<reviewed duration>
NATS_PUBLISH_TIMEOUT=<reviewed duration>
NATS_QUERY_TIMEOUT=<less than gateway request timeout>
OUTBOX_*=<reviewed poll interval and batch size>
```

### `myunivokai-universe`

```txt
APP_ENV=production
DATABASE_URL=<myunivokai_universe pooled URL>
DATABASE_DIRECT_URL=<myunivokai_universe direct URL>
NATS_URL=<TLS URL>
NATS_USERNAME=<Universe credential user>
NATS_PASSWORD=<Universe credential secret>
NATS_ACK_WAIT=<reviewed duration>
NATS_MAX_DELIVER=<reviewed count>
NATS_QUERY_TIMEOUT=<less than gateway request timeout>
NATS_FETCH_BATCH_SIZE=1
NATS_FETCH_MAX_WAIT=<reviewed duration>
NATS_RETRY_DELAY=<reviewed duration>
NATS_CONNECT_TIMEOUT=<reviewed duration>
NATS_RECONNECT_WAIT=<reviewed duration>
NATS_PUBLISH_TIMEOUT=<reviewed duration>
OUTBOX_*=<reviewed poll interval and batch size>
```

### `myunivokai-nature`

Use the Universe matrix but point both database URLs and credentials only to
Nature-owned resources.

### `myunivokai-web`

```txt
NEXT_PUBLIC_GATEWAY_BASE_URL=https://<gateway-origin>
```

The web environment must not contain NATS, Redis, database, AI or domain
service credentials.

## 7. Migration and rollout

1. Run DNA, Universe and Nature migrations with direct URLs as explicit
   release/pre-deploy jobs. Prove they succeed from empty databases and are
   safe to re-run.
2. Deploy `myunivokai-dna`, `myunivokai-universe`, and
   `myunivokai-nature` with no public HTTP endpoint.
3. Verify NATS connections, durable consumer presence, database readiness and
   Core NATS query/service availability.
4. Deploy `myunivokai-gateway` without switching the frontend yet.
5. Run synthetic API-to-NATS-to-DNA-to-family flows against the new gateway.
6. Test duplicates, provider failure, NATS redelivery and Redis loss.
7. Deploy/rebuild `myunivokai-web` with the new gateway origin/contract.
8. Run the public smoke matrix below.
9. Observe error rate, job latency, consumer lag/redelivery, outbox age, Redis
   errors/hit ratio and database pools for the approved window.
10. Mark cutover successful only after every mandatory check passes.

## 8. Public smoke matrix

- [ ] Gateway liveness succeeds; readiness reports NATS and Redis distinctly.
- [ ] Invalid input returns the documented 4xx envelope without NATS publish.
- [ ] Universe create returns `202 + jobId` quickly.
- [ ] Universe job transitions queued → processing → completed.
- [ ] Universe get/regenerate/select/publish/share pass.
- [ ] Nature create and complete lifecycle pass identically.
- [ ] Regenerate uses no AI provider call by default.
- [ ] Public share omits raw input and uses Redis cache safely.
- [ ] Cross-instance rate-limit test produces the documented combined 429.
- [ ] Redis cache flush preserves job/world truth through fallback.
- [ ] Re-publishing one test command does not create a duplicate logical world.
- [ ] Unauthorized NATS credential publish/subscribe attempts fail.
- [ ] Browser network shows only the gateway API origin.

## 9. Failure smoke

- [ ] Temporarily make Redis unavailable: cache bypass and conservative local
      limiter activate; jobs continue durably.
- [ ] Restart one family consumer during a job: JetStream redelivery completes
      once or returns an explicit failed state.
- [ ] Make the AI provider fail: DNA job becomes failed with a safe error.
- [ ] Stop one family responder: its query returns stable timeout/unavailable
      without affecting the other family.
- [ ] Restart gateway: persisted jobs remain queryable after recovery.

## 10. Rollback

Rollback triggers include contract-breaking frontend errors, accepted job loss,
unbounded redelivery, wrong database ownership, unauthorized NATS access, or
failure rates above the approved threshold.

Before old fleet retirement:

1. stop new traffic to the new gateway;
2. stop/NAK or deliberately drain in-flight commands;
3. record unresolved job IDs without payloads;
4. restore the last known-good web/gateway deployment;
5. preserve all three new databases, streams and logs for diagnosis;
6. verify the old public lifecycle before declaring rollback complete.

Do not delete new data during rollback.

## 11. Legacy retirement

Retirement is a separate change after the observation window:

- list exact old Render service IDs/names and old database names;
- obtain owner confirmation for those exact targets;
- disable old services first and preserve the documented recovery window;
- remove old secrets/upstream URLs only after traffic confirms zero use;
- delete old databases only in a separately approved operation;
- record what was removed and whether/how it can be recovered.

No recursive, wildcard or environment-derived destructive command belongs in
this runbook.

## 12. Completion record

```txt
contracts: PASS|FAIL
localCompose: PASS|FAIL
databaseMigrations: PASS|FAIL
natsAclAndStreams: PASS|FAIL
redisRateAndCache: PASS|FAIL
universeLifecycle: PASS|FAIL
natureLifecycle: PASS|FAIL
failureRecovery: PASS|FAIL
rollbackTest: PASS|FAIL
observationWindow: PASS|FAIL
cutoverDecision: GO|NO-GO
legacyRetirementApproved: YES|NO
```
