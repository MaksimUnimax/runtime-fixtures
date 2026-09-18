# POST-C3H P3 — Extension-local technical scheduler integration

Work ID: `SA-I1-POST-C3H-P3-EXTENSION-LOCAL-SCHEDULER-INTEGRATION-20260918-01`

Status: `IMPLEMENTED_CANDIDATE` — architect review pending. This document records the bounded P3 candidate only; it does not mark full Early-I1/D2 pre-handoff acceptance complete.

## Base and boundary

The branch is based directly on accepted P2 local HEAD `09b32c88a0d594be8f4cd881b903ae55e8e12029`, tree `3752bf3ca0a2c3bb6d50e4bcc34c767b10a8bdbf`. The accepted ancestry is C3H `804d58b8198aa75fd8ec2830b7b37678dc8444bf` → P1-R1 `1d9f0ca8986205f36911051fb5e4a73455d1202b` → P2 `09b32c88a0d594be8f4cd881b903ae55e8e12029`.

P3 changed only ordinary extension-local technical wake integration. It did not change server contracts, migrations, marketplace providers, or Stream 2 monitoring ownership. `apps/health-runner/**`, `packages/server/health/**`, and `tooling/api-watch/**` remain untouched by tracked P3 changes.

## Wake inventory and disposition

| Producer | Purpose/mechanism | Disposition | Final P3 behavior |
|---|---|---|---|
| C3E sync journal | Durable `PENDING`/`RETRY_WAIT` metadata sync; previously its own named alarm | `INTEGRATE` | Journal remains authoritative; it registers one coordinator task and preserves request IDs/backoff. |
| Provider quota wait | `next_allowed_at`; previously quota alarm plus fallback `setTimeout` and startup scan | `REPLACE` | One durable quota task wakes the existing scan; the queue and C3G decide whether a request is permitted. |
| Work-session restart recovery | Existing recovery scan and named refresh wake | `INTEGRATE` | One safe reconstruction task invokes the existing C3D recovery state machine. No new Work is created. |
| Payload/result cleanup | Repeating five-minute cleanup alarm and startup timer | `REPLACE` | One-shot expiry tasks are created only when durable expiry exists. No idle alarm remains. |
| IDB file-artifact cleanup | Startup `setTimeout` | `INTEGRATE` | Artifact writes register the earliest bounded expiry; cleanup re-arms only for remaining artifacts. |
| Network recovery | Existing C3E notification | `INTEGRATE` | It accelerates one bounded due scan without resetting backoff. |
| Content reconnect / popup open | Existing event-driven local recovery and state refresh | `KEEP` + acceleration hook | A bounded scheduler scan may run; no tab navigation or authority refresh is added. |
| Content-script recovery/identity timers | Surface-local polling and bounded waits | `OUT_OF_SCOPE` | Not worker scheduler authority; unchanged. |
| Popup diagnostics interval | Popup UI refresh | `OUT_OF_SCOPE` | Not technical Work scheduling; unchanged. |
| Tab reload/identity timeout | Bounded C3D operation timeout | `KEEP` | Remains a bounded operation timer, not a recurring scheduler. |

No `chrome.runtime.onStartup`/`onInstalled` scheduler existed as an independent producer. P3 uses those events only as acceleration into the single coordinator.

## Chosen architecture

The current timers were fragmented, so P3 adds the smallest shared boundary: `SellerAgentsTechnicalScheduler` in `apps/extension/src/application/technical-scheduler.js`, composed into the worker prelude. It stores minimum metadata in `seller_agents_technical_wake_v1` and owns one one-shot alarm, `seller-agents-technical-wake-v1`.

The durable task kinds retained are:

- `C3E_PENDING_SYNC_RETRY`
- `KNOWN_PROVIDER_QUOTA_WAIT`
- `KNOWN_RESULT_RECOVERY`
- `TECHNICAL_BUFFER_EXPIRY`
- `SAFE_WORKER_RESTART_RECONSTRUCTION`

Delivery reconciliation is not made into an endless task. Existing content-surface observation remains the only reconciliation path; a committed or unknown delivery is never sent again by the scheduler.

Each task has a stable task ID, kind, due time, revision, retry count, claim expiry, and a bounded identity reference. Identity fields can include account, installation, conversation, binding/revision, Work generation, execution/provider-attempt/delivery IDs, C3E request ID, queue index, and artifact key. No task stores business payloads.

The coordinator claims due entries durably for a short lease, processes at most 16 per wake in deterministic `(dueAt, taskId)` order, and removes a task only if the claimed revision is still current. Duplicate alarms, late alarms, startup/alarm races, and worker termination therefore converge. A failed handler remains durable with a bounded one-minute technical retry. Domain functions remain responsible for permission, fencing, and idempotence.

## Domain integrations

### C3E sync

The C3E journal remains the source of truth and retains the accepted approximately `5s, 15s, 30s, 60s, 120s`, then bounded five-minute jitter schedule. One coordinator entry points at the earliest durable request. `requestId` is unchanged across retry and worker restart. A stale `IN_FLIGHT` journal row from a prior worker session is reconstructed as `RETRY_WAIT` with the same request ID; the control endpoint's existing request identity remains the deduplication boundary.

No pending entry cancels the sync task and clears the one-shot alarm. A sync retry is metadata-only and cannot start Work, replay a provider operation, or block local Work.

### Quota waits

`Retry-After`/`next_allowed_at` remains provider-specific. The coordinator only makes the existing quota wait eligible. The existing batch processor then performs its full C3G predispatch check; a legitimate next attempt receives a new provider-attempt ID while the logical execution ID remains stable. Finish, rebind, generation, credential revision, authority expiry, and reconciliation conflict continue to fence the operation. Provider UNKNOWN is never scheduled as quota work.

### Known result recovery

On restart, the coordinator reconstructs a task only for a manual operation still in requesting state with a buffered known result. It calls the existing local batch processor, which materializes the bounded P2 buffer with provider calls equal to zero. It does not recover a missing buffer, an UNKNOWN provider attempt, a finished/rebound generation, or a delivery that crossed an irreversible/unknown boundary. `DELIVERY_OUTCOME_UNKNOWN` and confirmed delivery have zero automatic AI Sends.

### Expiry

Payload and IDB artifact expiry are scheduled from durable expiry timestamps. Cleanup can run late after sleep/restart but never resurrects the buffer. It leaves the accepted no-provider-replay/no-delivery-replay fence and emits no marketplace request, AI Send, sync payload, or user-visible history. There is no repeating five-minute liveness alarm.

## Forbidden work evidence

The final generated worker has one `chrome.alarms.onAlarm` registration and one one-shot alarm creator. There is no repeating scheduler alarm, server scheduler, Work lease, heartbeat, Health polling, hidden Start/Resume, hidden pagination, report STATUS/DOWNLOAD polling, provider UNKNOWN replay, delivery-UNKNOWN resend, automatic AI navigation, or automatic ChatGPT/Alice tab/chat creation.

The scheduler wall clock selects technical eligibility only. It does not update signed authority, grace, binding revision, store, marketplace, credential revision, Work generation, or Finish state. A late or skewed wake re-enters the domain fence; it cannot grant authority.

## RED-first batch and closure

| Item | Result |
|---|---|
| P3-RED-01 pending state lost on worker restart | `ALREADY_GREEN_BASELINE` for durable C3E/P1/P2 state; P3 adds durable coordinator entries. |
| P3-RED-02 duplicate alarm repeats irreversible action | Closed by durable claim/revision plus domain single-flight; focused test PASS. |
| P3-RED-03 quota retry bypasses C3G | Closed by existing batch processor and C3G predispatch; full client suite PASS. |
| P3-RED-04 provider UNKNOWN redispatch | `ALREADY_GREEN_BASELINE`; P1 state excludes UNKNOWN from retry and P3 has no UNKNOWN task. |
| P3-RED-05 delivery UNKNOWN resend | `ALREADY_GREEN_BASELINE`; P2 recovery decision remains no-retry; P2 browser PASS. |
| P3-RED-06 known result requires popup | Closed by worker-local known-result task; P3 source/package and P2 regressions PASS. |
| P3-RED-07 expiry missed after sleep | Closed by durable one-shot expiry reconstruction and artifact re-arm. |
| P3-RED-08 duplicate C3E request identity after restart | Closed by stable request ID and stale in-flight reconstruction. |
| P3-RED-09 idle heartbeat | Closed; no repeating scheduler alarm after drain. |
| P3-RED-10 Finish/rebind stale action | `ALREADY_GREEN_BASELINE`; existing P2/C3F/C3G fences remain in domain paths. |
| P3-RED-11 one dialogue blocks another | Closed by bounded per-task dispatch and independent domain keys. |
| P3-RED-12 scheduled wake bypasses authority | `ALREADY_GREEN_BASELINE`; scheduler never calls authority mutation and domain gates remain mandatory. |
| P3-RED-13 independent timer races | Closed by replacing worker-side independent alarms with the one coordinator. |
| P3-RED-14 clock grants Work authority | `ALREADY_GREEN_BASELINE`; signed clock/authority tests remain green. |
| P3-RED-15 hidden polling/commands | Closed by explicit typed task kinds and static final-worker checks. |

## Evidence

- Focused coordinator test: `7 scenarios PASS` on generated source and ZIP-extracted runtime; 100 synthetic wake deliveries, 0 duplicate side effects, identity-only storage, max 16 due tasks per wake.
- Real unpacked Playwright Chromium: source and extracted candidates PASS; worker restart count 1, duplicate/late wakes 2 in the browser smoke, marketplace requests 0, periodic scheduler alarms 0. Existing P2 real Chromium evidence covers known-result recovery and delivery-UNKNOWN no-resend; P1 covers provider outcome and quota fencing.
- Complete Extension I1 checker: `138 gate processes PASS` with Node `v22.22.2`, Node 24 Corepack pnpm, `C3H_BROWSER_PROOF=REAL_UNPACKED_CHROMIUM_PASS`; no live marketplace traffic.
- Deterministic package: version `0.2.4`, `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`, 2,015,625 bytes, SHA-256 `ca12eb7916363eaf5e3c5b3eddceb1679c2b81a87b6050062355291f7589b4c7`; repeat archive equal and source/extracted bytes equal.
- System Google Chrome and other browser families remain deferred, as required by P1/P2 scope.

## Stream 2 and server boundary

No Stream 2 production file changed. No `PARALLEL_STREAM_DEPENDENCY` was discovered. No server scheduler, migration, heartbeat table, provider queue, result queue, lease service, or control contract was added. `/v1/sync` remains the only ordinary synchronization path.

## Security

Scheduler storage contains only task kind, bounded identity references, due/revision/claim metadata, and retry count. It contains no marketplace token, Authorization header, raw provider result/report/file, AI message text, Health envelope, storageState, owner credential, or signing key. Raw result/artifact data remains in the accepted bounded P2 stores.

## Publication and next boundary

The candidate branch is `feature/i1-p3-local-scheduler-integration-2026-09-18`. Publication uses no force push, reset, rebase, amend, or merge. Remote publication is not performed by this local run; if credentials are unavailable the ledger remains `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`.

After architect acceptance, the next intended dependency is `FULL AUTOMATED EARLY-I1 / D2 PRE-HANDOFF ACCEPTANCE`. It is not started here. D3/S2 and Stream 2 monitoring-agent scheduling are not started.
