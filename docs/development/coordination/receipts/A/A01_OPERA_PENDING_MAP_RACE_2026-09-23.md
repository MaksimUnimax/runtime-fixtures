# A01 — Opera pending Work Start race — 2026-09-23

Status: `CANDIDATE_READY_FOR_C / SOURCE+PACKAGE+INSTALLED_SYNTHETIC_EVIDENCE`

This receipt closes the bounded A01 defect investigation and fix. It does **not** claim full Opera/browser-family, LIVE_OWNER, deployment, or production acceptance.

## Base and scope

- Canonical base at task start and final pre-commit fetch: `dc63fc6290b0ecd78d8b31452811dc5a93d89f38` (`origin/main`).
- Stream: A, task `A01`.
- Owned changed files:
  - `apps/extension/application-patches.json`
  - `tests/regression/extension-core/client-i1/client-c2-3c1-online-work-admission.mjs`
- Independent read-only Luna review: `/root/octoport-control/logs/A/a01-opera-race-review-r1-result.md`, SHA-256 `0ed370601472f1faa2451bfec99e2d77662149993fff7e145d926b11253bc1f5`.

## Root cause and three-level ownership

1. Component: `createPendingWorkStart()` read-modify-wrote the complete `ozmb_pending_work_starts_v1` map outside the existing `withBindingWrite` queue. Two valid concurrent dialogue Starts could read the same map, write different tab slots, and lose one update. The losing request then correctly detected missing readback as `WORK_START_PENDING_COMMIT_READBACK_FAILED`.
2. Subsystem: local extension Work-admission/pending-start persistence owns this race. Opera exposed the interleaving; no server, DB, shared contract, marketplace provider, or network behavior is needed to cause it.
3. Product invariant: independent dialogues must not destroy each other's local pending Work state. UNKNOWN/no-replay, account/store/dialogue isolation and signed authority remain unchanged.

The fix serializes pending-map creation and the adjacent whole-map writers on the existing Work/binding queue. Expiry inside send commit/ack uses an unlocked internal clear helper because those callers already hold the queue; this avoids reentrant deadlock. Tab-close and partial pending-observation updates use the same serialized path.

## Deterministic RED before the fix

Baseline test package:

- package SHA-256: `01b4c7044d0fce88fbed6df0708c028dff3f94dc85bad148f66ca537d7618830`
- 39 runtime files
- repeat archive identity: PASS
- source↔extracted byte identity: PASS

New deterministic regression `C1-49` against the baseline package: **FAIL** with `WORK_START_PENDING_COMMIT_READBACK_FAILED`.
`C1-50` (expired send-commit bounded completion / no reentrant deadlock) remained PASS.
Evidence log: `/root/octoport-control/logs/A/A01_C1_PENDING_BASELINE_RED.log`, SHA-256 `b6c191f544a9a502ee97159ba8df0d4e239f6ec22e05d7991d7842dabc3ab197`.

A fresh real-Opera focused baseline run also reproduced BR-C1-19 on the source runtime while BR-C1-21 passed; extracted 19/21 passed in that run. This confirms the product race is real but timing-sensitive and that the earlier BR-C1-21 `#account` timeout is not coupled deterministically to it.

## Candidate evidence

Candidate test package:

- package SHA-256: `b34511e7eec358fb398d304d5274fed788824438193ee5412b44d8b451f33017`
- 39 runtime files
- repeat archive identity: PASS
- source↔extracted byte identity: PASS

Deterministic admission regression on candidate package:

- source runtime: overall PASS; 50/50 C1 cases; `failureBatch=0`; `rbFailures=0`; `preTokenFailures=0`.
- extracted runtime: same PASS counts.
- `C1-49`: PASS on source and extracted.
- `C1-50`: PASS on source and extracted.
- source evidence SHA-256: `d4c0d026aae2f52f230c102cf7f3e2b3f943a08e1647e8fae3108a9ebab58aad`.
- extracted evidence has the same deterministic output SHA-256.

Real Opera `136.0.6008.22`, exact candidate package, synthetic provider/control fixtures only:

- focused BR-C1-19: source PASS, extracted PASS.
- focused BR-C1-21: source PASS, extracted PASS.
- focused evidence SHA-256: `5d732e85a4ca398d661d9db4ddf5926cc2142f727f688f0e167de6b511f95c04`.
- fresh focused BR-C1-24 and BR-C1-28: source PASS and extracted PASS for both; evidence SHA-256 `38184f7cb87950e0cfab41a3a40215cdefdac632cd8dfeff02f7db3f2055a2e1`.

## Full Opera run limitation

A long full Opera source+extracted matrix was also attempted on the candidate. It is **not** an acceptance run:

- source BR-C1-19 and BR-C1-21 passed;
- source later produced intermittent BR-C1-24/28 failures, but both passed immediately in a fresh focused source+extracted run on the same package;
- source later crashed the popup target around BR-C1-35 and subsequent cases cascaded;
- extracted passed through BR-C1-21, then Playwright driver itself raised a `_CRSession` assertion at BR-C1-22 and the context connection closed;
- the run was stopped after the driver failure because remaining results in that dead context could not be independent product evidence.

Retained earlier Opera evidence had BR-C1-24..35 passing before a separate driver/context failure. Therefore the current full-run crash is classified as browser/Playwright long-context instability, not proof of a deterministic A01 regression. Full Opera release acceptance remains open for A03 and must use its own stable browser evidence.

## BR-C1-21 classification

The earlier `#account` timeout occurs during BrowserFixture restart/popup readiness before the scenario's store-change behavior. It did not reproduce in the fresh baseline focus, candidate focus, or the candidate full source run before later browser-target instability. No product change was made for it. Current classification: environment/harness readiness issue; retain as browser-matrix evidence risk rather than claiming product PASS from absence alone.

## Security and boundaries

- No production/live credentials, sessions or customer data used or persisted.
- No backend, shared contract, DB, migration or lockfile change.
- No production deploy/package publication.
- This receipt is SOURCE/PACKAGE/INSTALLED_SYNTHETIC evidence only.
