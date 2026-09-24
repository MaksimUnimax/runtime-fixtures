# A04 network correctness — N1 + N3 — 2026-09-24

Role: A
Task: A04 / controller subscription-network follow-up
Evidence level: SOURCE + PACKAGE/SYNTHETIC
Installed/live acceptance: NOT CLAIMED

## Trigger

Controller notice `SUBSCRIPTION-NETWORK-REVIEW-20260924` reproduced N1 sync alarm starvation and N3 protected control paths using expired access tokens without shared refresh. The same audit also found delivery markers arming their own near-immediate sync task and that the intended retry ceiling was not represented in the retry sequence.

Baseline reproduction against A HEAD `144551fdb8d9d67b2988162592b27716b9c2e42d` reproduced the controller cases. Evidence: `/root/octoport-control/logs/A/a04-network-repro-baseline.json`.
## Change

- Technical scheduler preserves the already persisted deadline for the same fresh pending sync request instead of moving it forward on every reconstruction.
- Delivery-only markers remain durable metadata but do not create their own network wake; they can travel with a later ordinary sync.
- Sync retry progression now reaches the existing five-minute ceiling and respects bounded server Retry-After.
- Sync no longer performs a second blind `localReset()` after control-client authentication handling.
- Control-client has one generation-fenced authenticated service request path for sync, signed Health and credential-transfer calls.
- Expired access tokens refresh on demand; a current 401 gets one forced refresh and one request retry.
- Confirmed terminal service identity failures invalidate local auth fail-closed; refresh transport/service failures do not by themselves erase local auth.
- No marketplace command request is automatically replayed by this change.
## Regression evidence

New regression: `tests/regression/extension-core/client-i1/client-a04-network-correctness.mjs`.

It proves, for source and extracted package runtimes:
- first pending sync deadline survives reconstruction and fires;
- delivery marker alone schedules no network sync;
- expired access refreshes before sync, Health and credential-transfer service use;
- one 401 performs one forced access rotation and one retry;
- a reactive 401 is not silently converted into ordinary offline success when refresh transport fails;
- repeated 401 invalidates auth once, without sync-journal double reset;
- preflight refresh service failure preserves local auth for retry;
- Retry-After is honored by sync scheduling.

The regression is wired into `tooling/checks/extension_i1.py`.
## Verification

Development composition is deterministic and builds successfully under Node v24.20.0.

Focused source/extracted checks passed:
- A04 network correctness regression;
- P3 technical scheduler;
- control-client lifecycle refresh single-flight;
- R2/Races generation fencing;
- signed Health transport;
- MV3 transfer-recipient recovery;
- C2.3-C1 online-work admission including C1-18 terminal 401 denial.

Full `extension_i1.py` through the A browser heavy runner: PASS, 146 gate processes, Node v24.20.0, installed_acceptance=false. Evidence: `/root/octoport-control/logs/A/a04-n1n3-i1-r2/summary.json`.
Resource job `38a00f2369d34db09db96aa2a90632e2`: exit 0, OOM 0, cleanup verified, peak 343,932,928 bytes.
`git diff --check`: PASS.
## Limits / next work

This is not installed-browser or live-provider acceptance. It does not claim cross-browser sync is complete.

N2 remains blocked on the C-assigned shared account-scoped conversation identity/pull contract and B DB ownership; A does not invent an entity-ID scheme.

N5 quota-wake continuation and N4 Wildberries quota/header correctness remain separate A04 candidates. N6 remains a later bounded optimization task.

A03 store-package/live gates remain independent. The controller's original reproduction is retained as historical defect evidence; the new regression is the current fix contract.
