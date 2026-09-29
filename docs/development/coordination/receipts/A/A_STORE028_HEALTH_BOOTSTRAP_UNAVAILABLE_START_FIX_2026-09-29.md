# A STORE 0.2.8 Start / optional Health BOOTSTRAP_UNAVAILABLE fix — 2026-09-29

Status: `SOURCE_FIX_PASS_INSTALLED_SYNTHETIC_PASS_STORE028_REWORK_REQUIRED`

Scope: A-owned Work admission runtime plus focused regression. The frozen official STORE 0.2.8 bytes remain immutable and are **not** relabelled as fixed.

## Exact frozen STORE 0.2.8 boundary

- source bytes: `8c6ade801b7441f0b64eb850f46b86c4b61dc39e`
- Chromium SHA-256: `63943ebc63f37fa4c8718ae252149dfd2b90a1d9dbc4b9637d35023f0c15ae48`
- Opera: `136.0.6008.22`
- C compatibility DONE: `/root/octoport-control/peer-handoffs/A/C-A-STORE028-COMPAT-DONE-20260929-1150.response.json`

After that exact compatibility handoff, A ran the exact frozen package technical lifecycle:
- normal technical auth on two fresh installations: PASS;
- signed profile admission on both installations: PASS;
- transfer refusal/create/discover/receive: PASS;
- same-request no-replay and second-request preservation: PASS;
- cleanup/tombstone: PASS;
- reset/re-auth and other-install isolation: PASS;
- provider requests: 0;
- AI POST requests: 0;
- page errors: 0.

Evidence:
`/root/octoport-control/logs/A/owner-test-opera-028-lifecycle-20260929/lifecycle-after-compat-r1.json`

## Reproduced installed Start defect

On the same exact STORE 0.2.8 family after restart, the client still had a valid cached authority:
- authenticated: true;
- workAllowed/canWork: true;
- requested/detected AI: chatgpt/web;
- profile: `chatgpt-web-opera-v1`, revision 2;
- config version: 4;
- authority generation matched the client generation.

`ensureForIdentity({ai_id:"chatgpt"})` succeeded. The following optional signed Health observation failed with `BOOTSTRAP_UNAVAILABLE`, and real popup `SA_WORK_START` propagated that failure before any Work mutation.

Evidence:
- `/root/octoport-control/logs/A/owner-test-opera-028-lifecycle-20260929/work-smoke-start-diagnostic-r1.json`
- `/root/octoport-control/logs/A/owner-test-opera-028-lifecycle-20260929/restart-authority-probe.json`

The server contract confirms the exact error shape: `POST /v1/health-authority` converts a non-device `BootstrapError` to HTTP 503 `BOOTSTRAP_UNAVAILABLE` in `apps/api/src/bootstrap-routes.ts`.

## Root cause and fix

`saObserveHealth()` is explicitly an optional online observation and never the lifecycle authority. Its availability classifier already ignored:
- `CONTROL_TRANSPORT_UNAVAILABLE`;
- HTTP 503 `PRODUCER_UNAVAILABLE`.

It did not include the server's real HTTP 503 `BOOTSTRAP_UNAVAILABLE` response for an unavailable Health producer. Therefore a valid signed local Work authority could be blocked by an optional observation outage.

The fix extends only that availability classification:
- HTTP 503 + `BOOTSTRAP_UNAVAILABLE` now returns no Health observation and continues to the existing signed local admission decision.

It does **not** ignore:
- 401/403 auth failures;
- signed Health DENY;
- tampered or invalid signed Health;
- context/generation races;
- local authority/profile/entitlement failures.

## Red/green regression

New case: `C1-17B` — “Health 503 BOOTSTRAP_UNAVAILABLE does not block local autonomous Start”.

Before the runtime fix, against exact frozen 0.2.8 runtime:
- overall focused suite: FAIL;
- only `C1-17B`: FAIL with `BOOTSTRAP_UNAVAILABLE`;
- surrounding C1 cases remained PASS.

Evidence:
`/root/octoport-control/logs/A/store028-health-bootstrap-unavailable-red-20260929.json`

After the runtime fix, on a freshly composed runtime:
- full C1 online-work-admission suite: PASS, including `C1-17B`;
- verified signed Health observation regression: PASS;
- offline lifecycle regression: PASS;
- development composition: deterministic, source/extracted bytes match.

Evidence:
- `/root/octoport-control/logs/A/store028-health-bootstrap-unavailable-green-r2-20260929.log`
- `/root/octoport-control/logs/A/store028-health-bootstrap-unavailable-fix-r1/verified-health-authority.log`
- `/root/octoport-control/logs/A/store028-health-bootstrap-unavailable-fix-r1/offline-lifecycle.log`
- build resource job: `978671cd36de4ba28782890adca7e0e0`

## Installed patched-source verification

For changed-boundary installed verification only, A composed a **non-release synthetic store-mode carrier** from the patched source using the accepted public 0.2.8 release authority.

Synthetic carrier SHA-256:
`a8bd3b628b065ff036a28d0e0e2526bead74ec8bc2c7710ecb0f6cb97e66985a`

This carrier is not the frozen STORE 0.2.8 package, is not a store submission candidate, and must not replace the official package.

On a fresh isolated Opera profile:
- normal technical device authorization: PASS, no injected auth;
- ChatGPT sanitized content bridge detected: PASS;
- signed bootstrap/workAllowed: PASS;
- one temporary synthetic Ozon store: created and cleaned;
- real popup Start: `active_visible`;
- real visibility toggle: true -> false -> true;
- real Finish: `inactive`;
- synthetic initial prompt reached the sanitized local ChatGPT fixture;
- provider request attempts: 0;
- ChatGPT POST attempts: 0;
- page errors: 0.

Evidence:
- `/root/octoport-control/logs/A/store028-health-bootstrap-unavailable-fix-r1/store-synthetic-technical-auth.json`
- `/root/octoport-control/logs/A/store028-health-bootstrap-unavailable-fix-r1/work-smoke-store-synthetic.json`
- browser resource job: `d875a78780414973abc4031af1f30bd6`

## Acceptance boundary and next gate

Frozen STORE 0.2.8 remains:
- installed transfer/reset lifecycle: PASS;
- Start/visibility/Finish: **FAIL / REWORK_REQUIRED** because those bytes do not contain this fix.

Patched source is:
- SOURCE: PASS;
- PACKAGE/LOCAL patched runtime: PASS;
- INSTALLED_SYNTHETIC changed-boundary Start/visibility/Finish: PASS.

Required next release action:
C integrates this exact A candidate through the normal intake, creates a new versioned STORE successor (do not silently rebuild 0.2.8), and A reruns only the changed installed Start/visibility/Finish boundary on those exact new bytes.

Still not claimed:
- genuine authenticated ChatGPT response / H3;
- human email login UX;
- store reviewer / Windows store-channel installation;
- STORE submit;
- production.
