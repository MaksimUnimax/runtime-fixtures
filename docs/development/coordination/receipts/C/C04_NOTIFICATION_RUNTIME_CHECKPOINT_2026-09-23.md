# C04 notification runtime / schedule bootstrap checkpoint — 2026-09-23

Status: **NOT_ACCEPTED — PARTIAL C04 CHECKPOINT**

Base integration SHA: `1ca6184056ac1151b0764df55664351394701654`

This checkpoint does **not** claim C04 completion, live monitoring acceptance, Telegram production delivery, deployment acceptance, or scheduled Health execution acceptance.

## Completed independent slice

- Added idempotent bootstrap helper for the accepted no-session schedule definitions.
  - Stable schedule IDs are preserved.
  - Existing rows must match provider/surface/target/probe identity.
  - Concurrent create races re-read and validate the same identity.
- Wired the existing durable Health notification outbox into the normal worker lifecycle only when the already provisioned Telegram runtime contract is complete: `TELEGRAM_BOT_TOKEN` plus exactly one `TELEGRAM_NOTIFICATION_CHAT_IDS` destination.
  - Missing both values disables this optional delivery runner.
  - Partial configuration or multiple notification destinations fail startup deterministically for the owner-monitoring route.
  - No parallel `HEALTH_TELEGRAM_*` secret namespace is introduced.
  - Existing OTP, device-expiry, subscription-lifecycle, B06 feedback-retention (including its error logger), and conditional audit-retention runners remain in the same `CompositeJobRunner`.
- Added Telegram `NotificationDeliveryPort` for route `OWNER_MONITORING` only.
  - Formats only bounded allowlisted Health notification fields.
  - Raw evidence, DOM, conversation contents, cookies, marketplace payload and secrets are not formatted.
  - Redirects are rejected.
  - Request/body consumption is bounded by one timeout.
  - Provider response body is bounded to 64 KiB.
  - 429 is classified as `RATE_LIMIT` with bounded `retry_after`.
  - Network/5xx failures are transient; auth/config errors and provider rejections remain distinct.
  - No external exactly-once claim is made; durable local intent/dedup semantics remain in the existing repository.
- Hardened `HealthNotificationRunner` against overlapping local ticks and waits for in-flight delivery during shutdown.

## Current-base verification

Fresh worktree base: `1ca6184056ac1151b0764df55664351394701654`

Focused unit matrix:
- `apps/health-runner/src/scheduler-targets.test.ts`
- `apps/worker/src/health-notification-runner.test.ts`
- `apps/worker/src/health-notification-runtime.test.ts`
- `apps/worker/src/telegram-health-notification-delivery.test.ts`
- `apps/worker/src/feedback-retention-runner.test.ts`

Result after fresh-base rebase and Telegram env-contract correction: **5 files / 20 tests PASS**.

Resource evidence: C build-profile job `ad20168d3cdc4948849485da91defac5`, exit 0, OOM 0, peak 769654784 bytes, cleanup verified.

Static checks:
- health-runner typecheck: PASS
- worker typecheck: PASS
- ESLint on changed C04 files: PASS
- `git diff --check`: PASS

No live LLM calls and no live Telegram sends were performed by this checkpoint.

## Explicit blocker / not implemented

The no-session durable schedule helper is **not yet wired to a production Health execution loop**.

Existing `NoSessionObservationResult` already carries deterministic `HealthState`, but the current persisted Health-run interface requires relational Health suite/profile identity that the no-session runtime target contract does not carry. DB/domain monitoring code is B-owned. C will not invent UUID attribution, add migrations, or bypass that boundary.

Still required for full C04 acceptance:
1. controller/B decision on the bounded existing-schema persistence adapter from no-session target/result to scheduled-linked `health_run`;
2. real health-runner service wiring: ensure schedules -> durable scheduler claim/reconciliation -> no-session execution -> accepted Health persistence -> incident processing;
3. restart/reconciliation evidence for that production loop;
4. focused DB integration proving scheduled_run -> persisted run -> incident/outbox on the combined tree.

Open control review remains the authority for this blocker. This checkpoint is safe to preserve but **must not be presented as accepted C04**.
