# A — passive v3 shared refresh scheduler — 2026-09-27

Status: **SOURCE/PACKAGE FOCUSED PASS / CURRENT STORE V2 DORMANT / LIVE NOT RUN**

Task: `A_V3_PASSIVE_CLIENT_REFRESH_SCHEDULER`.
Parent A head: `49cd4d41c66ff6465d2ea1c384b53fb07006b113`.
Observed `origin/main` before this checkpoint: `22473b416949892d66e5d8e204805ea84347c329`.

Authority:
- `docs/architecture/SUBSCRIPTION_ACCESS_POLICY.md`;
- `docs/development/coordination/SUBSCRIPTION_ACCESS_CONTRACT_V3_2026-09-27.md`;
- controller notice `STREAMS-AUDIT-20260927-1022`.

## Boundary

This block extends the existing installation-local technical scheduler. It does not introduce a second timer subsystem, licensing service, heartbeat, WebSocket, per-business-command server request, live deployment or STORE-1 activation.

The currently composed STORE/development package is still packaged as `control_plane_v2`. Its subscription refresh plan is therefore `NEGOTIATION_DORMANT` and makes zero subscription-refresh network calls.

A future package explicitly configured for `control_plane_v3` can use the same client/scheduler code after the compatible producer/negotiation boundary is intentionally enabled. That synthetic future-v3 path is what the focused tests exercise.

Frozen STORE 0.2.4 authority is not changed by this receipt.

## Client refresh policy

The client derives one shared refresh plan from the currently verified v3 authority:
- base cadence: approximately 24 hours from signed `serverTime`;
- deterministic per-installation jitter: up to 30 minutes early;
- future `paidThrough` takes precedence when it arrives before the cadence point;
- a `paidThrough` already behind the server time of a newly verified current response does not trigger an immediate loop;
- COMMERCIAL with no paid access object uses its short current expiry as the conditioned refresh boundary;
- BETA retains its separate legacy boundary;
- signed `NONE` is not scheduled as an allowing authority.

The durable task is one `authority:refresh` entry in the existing `seller_agents_technical_wake_v1` coordinator.

Durable task identity stores only bounded technical identity:
- account ID;
- installation/device ID;
- session ID;
- signed-authority retry generation;
- signed server time.

No access token, refresh token, marketplace secret, client payload or raw business data is stored in the scheduler task.
## Single-flight, restart and retry

All tabs of one installation converge on the existing extension service-worker coordinator and one `authority:refresh` task.

The scheduler preserves:
- one dispatch flight per worker;
- durable claim/lease;
- one overdue refresh after browser sleep/restart;
- no replay of every missed daily interval;
- retry state only while the same signed-authority identity remains current.

A new signed authority/session resets old retry attempts.

Technical refresh failure uses bounded exponential backoff with deterministic jitter:
- base 15 minutes;
- doubles by attempt;
- ±10% deterministic jitter;
- cap 6 hours.

This retry is only for the technical subscription-authority refresh. It does not retry marketplace business commands and does not change marketplace 429 semantics.

## Online refresh semantics

The scheduler invokes one **online** bootstrap attempt. It does not call `bootstrapWithPolicy()` as a refresh success path, so a transport failure cannot be misclassified as a new authority merely because cached offline authority remains usable.

If the short access token is stale, the existing auth-refresh single-flight rotates it before the bootstrap request.

For synthetic future-v3 negotiation:
- outgoing bootstrap contract is v3 only when packaged config itself is v3;
- current production packaged v2 continues to request only v2;
- the signed response must verify under the existing trust bundle;
- the account must match the current account;
- scheduled refresh requires signed `serverTime` to advance strictly beyond the prior authority;
- a non-advancing signed response is treated as stale/replay and cannot manufacture a new paid boundary;
- a current signed renewal replaces the paid boundary and reanchors the daily plan;
- a current signed `accessBasis=NONE` response is persisted as an immediate deny, advances generation/trusted server watermark, and removes future allow scheduling;
- an older cached allow cannot replace the newer signed deny after restart.

The existing fixed commercial offline rule remains independent: network unavailability may leave the previously verified paid authority usable only before its fixed `offlineHardUntil`; a refresh failure does not recompute or extend that deadline.
## Focused verification

Fresh composed package:
- output: `/tmp/octoport-a-v3-scheduler-focus-r5`;
- archive: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`;
- archive SHA-256: `2ef4552c2bf7cfef17d02b9d76264c8128b1e0bd47fd8764dfed528b14e6321e`;
- repeat archive match: true;
- source/extracted bytes match: true.

Resource job:
- `c96aa8aa469242f6b8f90138d6ee3742`;
- command exit: 0;
- cleanup verified: true;
- OOM kills: 0;
- peak bytes: 155189248.

Source runtime and extracted package both PASS:

`client-v3-refresh-scheduler.mjs`
- v2 dormant/no task;
- multi-tab single-flight;
- sleep/restart exactly one overdue refresh;
- renewal reanchors;
- signed deny cancels;
- bounded jittered retry through 6h cap;
- retry attempts reset on new signed authority;
- no token material in durable scheduler.

`client-v3-refresh-online.mjs`
- current v2 package remains dormant;
- synthetic future-v3 daily refresh;
- stale short-token refresh remains one existing single-flight;
- renewal replaces paid boundary;
- exact paidThrough is a refresh trigger;
- unavailable refresh preserves only the fixed cached fallback;
- current signed deny is immediate;
- deny advances generation/trusted watermark;
- older cached allow replay after deny is rejected;
- current GRACE with already-past paidThrough schedules cadence instead of immediate loop;
- signed non-advancing refresh is rejected.

Existing regressions rerun on both source and extracted package:
- `client-p3-technical-scheduler.mjs` — PASS;
- `client-v3-passive-cache.mjs` — PASS;
- `verifier-v3.mjs` — PASS.

File SHA-256 at this focused boundary:
- `packages/control-client/src/client.js`: `a9991bfb019f0a405e5184ec57c748f99d593c024bc5b883cf15e498f3ac4519`;
- `apps/extension/src/application/technical-scheduler.js`: `45c46010b8f5387b07af8b6190fb02c50297230d42cf9985ff0f0ba1eb6f522b`;
- `client-v3-refresh-scheduler.mjs`: `a4d25d0ee98dccede34de8be09e8b98d74a43552ada2eea9d410690969e8380f`;
- `client-v3-refresh-online.mjs`: `56d7a6ab4f6b4b49ab26a0653ddaa61d591f0c41a89b0b889708bdca7b18b6c5`.

These hashes are rechecked before commit; if any file changes, this receipt must be updated before handoff.
## Controller hard-boundary correction

Controller notice `STREAMS-AUDIT-20260927-1022` separately identified a cache-vs-current-online hard-boundary defect in `autonomous-work-authority.js` and prepared exact candidate:

`951b99d24ab2d129a738056b781fb015f3793036`.

That controller-owned candidate is **not duplicated or edited in this scheduler block**. At this checkpoint it is still awaiting normal C intake/main publication. After it lands in main, A consumes it normally and reruns the relevant hard-before/equal/after-expiry regression together with this scheduler candidate.

This scheduler receipt does not claim that controller candidate as integrated.

## Evidence boundary

This is SOURCE/PACKAGE focused evidence only.

It is not:
- production/live commercial activation;
- STORE publication acceptance;
- LIVE_OWNER acceptance;
- deployment;
- permission to change the frozen STORE 0.2.4 package;
- evidence that v3 negotiation is currently enabled in the packaged extension.

Next safe step:
1. docs/diff/guard;
2. commit this scheduler block;
3. merge fresh `origin/main` on a clean boundary;
4. rerun focused checks on the merged exact bytes;
5. run full `extension_i1` on the final merged candidate;
6. consume controller hard-boundary correction only after it appears through normal main/C intake.
