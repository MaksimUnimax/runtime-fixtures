# S2-O2 LLM Health notification / noise-control foundation R1

Status: IMPLEMENTED_CANDIDATE for bounded architect review. This document is
not an S2-O1 acceptance and does not define a cross-domain incident model.

## A. Preflight and ancestry

- Work ID: `S2_O2_LLM_HEALTH_NOTIFICATION_NOISE_FOUNDATION_2026-09-19_R1`.
- Starting commit: `7ec0693e7e8149ae8d9c50ad41c237a23a34bd86`.
- Starting tree: `5edd1f5c8ef78e7ae9b18058d610df282897f6fc`.
- Starting parent: `1c36c67e909a4a089256ad58627342e203c2520d`.
- `origin/main` at preflight: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`.
- Integration branch at preflight: `origin/integration/i1-c1-srv5-2026-09-16` at
  `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- PR #9 readback: head `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`; merge ref
  `ccd6fd504f8e1d572e3e2c7eefce33884186e9f2`.
- A1 was not used as a base and no API-watch files were changed.
- Active-worktree audit included the L6, L7, L8, A1, LLM reconciliation,
  Stream-1, and root worktrees. The accepted LLM line was clean in its own
  worktree; the root worktree had unrelated untracked fixture artifacts and
  was preserved.
- Migration audit found `0021_s2_l7_h4_h5_evaluations.sql` as the highest
  migration on the accepted L8 lineage and no `0022` collision in active
  worktrees. The unrelated dirty root contains `0017`/`0018`; those were not
  copied into this ancestry.
- Runtime used for validation: Node `v24.21.0` from the installed Node 24
  toolchain, pnpm `10.34.5`, and PostgreSQL `18.0` in the repository's
  disposable PostgreSQL container. The default shell `node` was `v12.22.9`
  and had no pnpm; validation therefore used the repository-compatible Node 24
  binary explicitly.

## B. S2-O1 dependency boundary

S2-O1 remains `BLOCKED_BY_DEPENDENCY`: LLM Health incidents are mature, but
S2-A1 is still partial and API snapshot/diff/incident authority from S2-A2–A8
is not accepted. This R1 uses an LLM Health adapter only. It creates no
generic incident v2, no API-watch incident semantics, and no cross-domain
unification.

## C. Existing-authority audit

The repository had no dedicated notification package, monitoring outbox,
delivery lease, cooldown, alert grouping, or routing authority. Observability
provided safe pino logging/redaction only. P9 is planned and names diagnostics,
notifications, operational visibility, and grouping/noise control as future
authority. The existing OTP email job/provider is authentication delivery
authority, not monitoring delivery; it was kept separate because its payload
and security lifecycle are incompatible with Health incidents.

The accepted Health incident repository remains the source of truth. Its
durable episode, status, run references, maintenance transition, recovery run,
and ordering checks are reused. Notification state is additive operational
state and never rewrites Health truth.

## D. Event, severity, and identity model

The stable R1 taxonomy is:

- `INCIDENT_OPENED` — one per Health episode;
- `INCIDENT_ESCALATED` — one per materially stronger severity in an episode;
- `INCIDENT_RECOVERED` — one for durable resolution;
- `MAINTENANCE_ENTERED` and `MAINTENANCE_EXITED` — bounded informational
  lifecycle events.

Repeated Health observations do not create events. Severity is deterministic:
`DRIFT`/`DEGRADED` map to `WARNING`, `BROKEN` maps to `CRITICAL`, and
recovery/maintenance lifecycle events map to `INFO`. `UNKNOWN`, `HEALTHY`,
and a first `MAINTENANCE` observation do not produce a product-break event.
The cooldown policy is explicit, finite, and injectable; the reversible default
is 15 minutes.

The dedup key is deterministic and episode-bound:
`llm-health:v1:<incident-id>:<event-kind>`, with `:<severity>` appended only
for escalation. It excludes timestamps, worker IDs, retries, and random
evidence IDs. A replay, restart, transaction retry, or duplicate transition
therefore resolves to the same logical intent.

The structured payload contains only source domain, incident/run references,
provider, surface, Health level/state, deterministic severity, root contour,
route key, and bounded timestamps. It contains no rendered body, raw error,
DOM, screenshot, session, cookie, credential, token, or conversation content.

## E. Persistence and delivery state

Migration `0022_s2_o2_llm_health_notification_intents.sql` adds:

- `health_notification_intents`;
- event, severity, and delivery-state PostgreSQL enums;
- unique `dedup_key`;
- restricted FKs to `health_incidents` and `health_runs`;
- bounded payload, group counter, first/latest observation, cooldown,
  retry/claim, provider-result, suppression, retention-class, and timestamp
  metadata;
- due and incident indexes.

States are `PENDING`, `CLAIMED`, `DELIVERED`, `FAILED_RETRYABLE`,
`FAILED_TERMINAL`, and `SUPPRESSED`. Claim rows require owner/token/expiry;
delivered rows require a delivered state. Invalid finalization is rejected by
the claim-token predicate. A delivered row cannot be claimed again.

The intent table is additive. Existing Health runs, incidents, evidence, H4,
and H5 records survive unchanged. Existing incidents do not receive copied
evidence or private payload. New notification intents are derived only from
accepted post-migration transitions or an explicit adapter replay.

Retention is represented by `retention_class=OPERATIONAL_DEFAULT` and nullable
`expires_at`. No deletion job or unsupported duration guarantee was invented;
an operational duration remains `PROVISIONAL_OWNER_REVIEW`.

## F. Delivery port and worker boundary

`NotificationDeliveryPort` is provider-neutral and receives the stable dedup
key as its idempotency key. R1 includes only:

- `DeterministicNotificationTestSink`, which stores one logical delivery per
  idempotency key;
- `DisabledNotificationSink`, which returns typed `DISABLED_ROUTE` failure.

No email, Slack, Telegram, SMS, webhook, paid alerting SaaS, credential, or
account action was added. `HealthNotificationRunner` is an independently
operable worker hook; it is not coupled to ordinary Work execution or a Health
heartbeat. The runner claims one due intent, calls the port, and finalizes only
with the same claim token.

Provider success before a worker crash is an at-least-once boundary. A replay
uses the same provider idempotency key; the deterministic sink proves one
logical delivery. Arbitrary future providers must honor this idempotency
contract or accept possible duplicate external delivery. R1 does not claim
exactly-once semantics across arbitrary providers.

Typed failure handling distinguishes `TRANSIENT_PROVIDER_FAILURE`,
`RATE_LIMIT` (with optional bounded retry-after), `CONFIGURATION_ERROR`,
`PERMANENT_PROVIDER_REJECTION`, and `DISABLED_ROUTE`. Retries use bounded
deterministic exponential backoff and five attempts; configuration/permanent
failures become terminal and disabled routes become suppressed. Retry state
never mutates the Health incident.

Routes are abstract keys only: R1 uses `OWNER_MONITORING`. No personal
destination is persisted.

## G. Noise control and maintenance

- Ten repeated observations update a bounded group counter and latest safe run
  metadata; they do not create ten OPEN intents.
- A same-severity observation inside the cooldown is recorded as aggregation
  with `COOLDOWN` suppression metadata.
- A stronger `WARNING` to `CRITICAL` transition bypasses cooldown and creates
  one deterministic escalation intent. Older observations are rejected by the
  existing Health episode ordering before notification derivation.
- Recovery creates one `INCIDENT_RECOVERED` intent. Replayed recovery sees no
  eligible transition and the unique key prevents duplication. A new episode
  after recovery has a different incident ID and therefore a new OPEN key.
- A failure first seen under declared maintenance creates no Health incident
  and no normal alert. An active episode entering maintenance emits bounded
  maintenance metadata and suppresses undelivered product-break intents.
  Exiting maintenance can resume the original OPEN intent without creating a
  duplicate OPEN key; recovery emits bounded exit/recovery events.
- `UNKNOWN` due to login/session, CAPTCHA/security checkpoint, network
  uncertainty, or browser unavailability is not mapped to product-break
  severity and does not open a notification intent.

## H. Concurrency and crash behavior

Concurrent producers race on PostgreSQL's unique dedup key and converge to one
intent. Concurrent delivery workers use `FOR UPDATE SKIP LOCKED`; one gets the
claim and the other sees no due row. An expired claim is reclaimable. A stale
owner cannot finalize after reclaim because its token no longer matches. A
delivered intent cannot be reclaimed. Provider replay after an acknowledgement
loss carries the same deterministic idempotency key.

## I. Validation

Red-first coverage was added before the live acceptance loop, then completed
against the implementation. Results:

- Health package focused/regression suite: `130/130` passed;
- DB unit/migration focused suite: `12/12` passed;
- new PostgreSQL 18 notification/concurrency suite: `5/5` passed;
- accepted Health incident lifecycle regression: `7/7` passed;
- accepted Health persistence regression: `22/22` passed;
- accepted Health scheduler regression: `17/17` passed;
- incident migration safety regression: `2/2` passed;
- Health and DB typechecks passed; worker typecheck passed;
- Prettier checks passed for changed source/test files.

The first combined DB regression invocation was intentionally rerun
sequentially: several pre-existing integration files reset the same PostgreSQL
`public` schema and cannot run concurrently. The sequential reruns passed.
No live LLM calls or external notification sends occurred.

## J. Stream-1 and future API boundary

Changed production/test scope is limited to:

- `packages/server/health/**` notification policy and test sink;
- `packages/server/db/**` additive intent schema, migration, repositories, and
  PostgreSQL tests;
- `apps/worker/src/health-notification-runner.ts` and its explicit Health
  dependency;
- this Stream-2 document.

No `apps/extension/**`, `packages/control-client/**`, `packages/bridge-core/**`,
marketplace, product bootstrap/profile, auth/session, P7 mutation, Work
runtime, provider dispatch/replay, rare-sync, multi-browser, release-flow, or
API-watch path was changed. The existing
`OWNED_BY_PARALLEL_STREAM_1` Health recommendation enforcement remains
unchanged. A future API adapter may target the delivery shell only after
S2-A1/A2–A8 establish accepted API incident semantics; it must not reuse this
LLM Health payload or pretend cross-domain unification exists.

## K. Deferred ledger

- `ENVIRONMENT_DEFERRED`: Stream-2 remote publication/readback;
- `ENVIRONMENT_DEFERRED`: no provisioned technical LLM sessions;
- `ENVIRONMENT_DEFERRED`: S2-A1 provider source access protection;
- `OWNER_EXTERNAL_ACTION_DEFERRED`: selecting/configuring a real notification
  provider and credentials is intentionally outside R1 and is not required for
  the deterministic test sink or acceptance validation.
