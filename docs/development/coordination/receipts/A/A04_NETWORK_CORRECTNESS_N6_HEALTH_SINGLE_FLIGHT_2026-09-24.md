# A04 network correctness — N6 Health in-flight single-flight — 2026-09-24

Role: A
Task: A04 / controller N6 bounded optimization
Evidence level: SOURCE + PACKAGE/SYNTHETIC
Installed/live acceptance: NOT CLAIMED

## Trigger

Controller N6 review identified duplicate signed Health acquisitions when matching Work admissions overlap. Health is an online observation rather than lifecycle authority, but redundant identical requests create avoidable control-plane load.

## Change

- `packages/control-client/src/client.js` now coalesces only matching **currently in-flight** Health acquisitions in memory.
- The key is the exact current signed bootstrap/authority decision identity plus requested AI family/surface/variant. It contains no access token, refresh token, store identity, dialogue identity, or marketplace payload.
- A joining caller must be current before joining and again after the shared promise resolves. The underlying request retains the existing authenticated-request refresh/401/deadline path, signature verification, exact Health context verification and final authority-generation fence.
- Authority invalidation/replacement clears the flight map; a stale in-flight result still fails the existing generation/authority fence.
- Every caller receives a deep clone. The flight entry is deleted in `finally` on PASS, DENY, UNAVAILABLE, validation failure, timeout or other error.
- There is **no TTL cache**: once the shared request settles, the next call issues a fresh Health request. DENY and UNAVAILABLE are therefore never delayed by a cache window.

## Regression

- `client-c2-3b1-health-transport.mjs` proves two concurrent matching PASS calls produce one request and isolated cloned results.
- It proves the immediately following PASS call refetches.
- It proves different detected-AI identities do not coalesce.
- It proves concurrent matching UNAVAILABLE and DENY may share only their active flight, while the next sequential call refetches immediately.
- It proves an auth reset during a shared delayed PASS causes both callers to reject `AUTH_GENERATION_CHANGED`; the stale PASS cannot become authority.
- `browser_c1_acceptance.py` preserves independent parallel-dialogue admission semantics while allowing one or two Health requests depending on whether the real browser calls actually overlap in time.
- Parent focused Node 24.20.0 evidence: signed Health transport PASS including HT-34..HT-38, request-deadline PASS and offline-policy PASS. Resource job `a85c57a70a2f4f6299a5aa8b6cb730c1` exited 0, OOM 0, cleanup verified, peak 401,604,608 bytes. Evidence package: `/root/octoport-control/logs/A/a04-n6c-health-flight-focused-parent-2`.

## Limits

This is same-runtime in-flight coalescing only. It intentionally does not coordinate Health across browsers/devices, persist Health state, add positive/negative caching, or change N2 sync/server contracts. Browser-installed and live-server acceptance remain separate gates.