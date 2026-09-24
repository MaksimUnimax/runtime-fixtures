# A04 network correctness — N6 control request deadline — 2026-09-24

Role: A
Task: A04 / controller N6 bounded optimization
Evidence level: SOURCE + PACKAGE/SYNTHETIC
Installed/live acceptance: NOT CLAIMED

## Trigger

Controller review N6 identified that the privileged control client bounded response size but did not bound total request lifetime after headers/body stalls. A browser/network stack could therefore leave sync, Health, auth, or transfer work pending indefinitely.

## Change

- `packages/control-client/src/client.js` applies one 30-second application deadline across the complete control request: fetch, response-body streaming, and JSON parse.
- The deadline aborts the underlying request, reports `CONTROL_REQUEST_TIMEOUT`, carries no fake HTTP status/body, and is registered as transport provenance so bootstrap offline-grace policy can treat it as an unavailable transport rather than a confirmed denial.
- An independently supplied AbortSignal remains distinct as `CONTROL_REQUEST_ABORTED`; the internal deadline does not silently replace caller cancellation.
- Deadline timers and abort listeners are removed on every terminal path. Existing response-size bounds, 401 refresh behavior, idempotency keys, generation fences and Retry-After handling remain unchanged.
- `apps/extension/src/application/sync-journal.js` classifies `CONTROL_REQUEST_TIMEOUT` as retryable transport state. A sync timeout therefore becomes bounded `RETRY_WAIT`, not a permanent metadata failure.
- Test harness timer scaling is test-only and defaults to 1, so ordinary regressions and production timing are unchanged.

## Regression

- New `client-request-deadline.mjs` proves a stalled fetch and a stalled body read both terminate as `CONTROL_REQUEST_TIMEOUT` without invalidating authentication.
- It proves a successful request leaves no deadline timer behind.
- It proves a Health timeout preserves authenticated generation.
- It proves sync-journal timeout handling becomes `RETRY_WAIT` with a future retry deadline.
- Parent focused Node 24.20.0 run also re-ran client lifecycle and offline policy; resource job `fb20f764aa7d4442b1d2ab9bd2e94ccb` completed exit 0, OOM 0, cleanup verified. Evidence package: `/root/octoport-control/logs/A/a04-n6a-deadline-focused-parent-3`.

## Limits

This change does not alter the N2 sync wire contract, does not add polling/heartbeat, and does not change attachment Port recovery. It is not installed-browser or live-server acceptance.
