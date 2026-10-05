# C01 — immutable release identity 0.2.13

Task: `C01-STORE0213-IMMUTABLE-RELEASE-IDENTITY-R3-20261005`

## Exact source basis

- Fresh publication base for the current reconstruction: `d7f26119d4e1e73d6f45ea6127951583a1ae28e0`, tree `fb57c9cacc07b48adae0f41e45818f2fa363975e`.
- R2 exact candidate `5549a37e4240584a3ddf40fe1ce4198be9a9ba12` was superseded after mandatory Server CI exposed a real omitted consumer: the health-runner packaged authority still declared extension 0.2.12.
- Earlier R3 candidates and their focused/build/review evidence are retained as supporting history only. In particular, `1f2c9a8e82710b06b4208aa8cb2bafa46a440757` on base `d798b735f3af434e0d806f14bcc853503bfde30f` passed focused checks, the bounded D2.4 composition/build gate, and independent Luna SOURCE review; that evidence is not promoted to a later candidate identity.
- The accepted pre-drift R3 source was `4710b5d65a3d2794e17face8ce8a9e3f4e62597e` on base `6b3a6c5e0863d4750011af7a88a69cf0b4158a1c`; all five mandatory workflows passed on that exact SHA. It was not pushed to main after `origin/main` advanced.
- Before the current reconstruction, `origin/main` advanced to `d7f26119d4e1e73d6f45ea6127951583a1ae28e0`. Fresh preflight and reconstruction verification found zero same-path drift and matched all nine task-path blobs to the accepted source. The current code-bearing reconstruction before this receipt-only correction was `c6d35c43d688781d157f9f5b7ecd6aa8136c057a`, parent `d7f26119...`, tree `1eb587ea4c496ee9ca989c2a9b6bb7a7f40d941c`.
- `c6d35c43...` retained the accepted full binary diff SHA256 `5ea3d4ee403cdfdb664029960574b8375b7bcfe4b32859585070d0156f9b3066` and exact task-path blob matches `9/9`. Independent Luna review found no code/security P0 or P2 and identified one P1 only in this receipt: stale provenance wording from the older `6b3a6c5e...` reconstruction.
- The first receipt-only correction was exact candidate `8b74e93faab04374841bee63f144b1b1ecc6c127`, tree `72020e96413e9fc13e904b0eda259ef622afd327`, parent `d7f26119d4e1e73d6f45ea6127951583a1ae28e0`. Its independent Luna review confirmed all seven code files were unchanged from `c6d35c43...` and found one remaining P1 only: the receipt had not named that exact correction candidate/tree.
- This successor changes only that provenance record. Because Git commit/tree identity is content-addressed by the tracked receipt itself, the receipt cannot truthfully embed the SHA/tree of the same successor commit without a circular self-reference. Therefore the exact post-commit successor SHA/tree is bound externally and immutably by its source-freeze/review/publication registration; this receipt names the exact reviewed predecessors and does not transfer their verdicts to the successor.
- The product/runtime code delta remains the same 0.2.13 identity change described below. Published 0.2.12 release/package evidence remains immutable and is not relabelled.
- Evidence class remains **SOURCE / LOCAL_CONTRACT** only.

## Scoped change

- `apps/extension/composition.json`: current recipe 0.2.13.
- `tooling/build/extension_composed.py`: current composition assertion 0.2.13.
- `tooling/checks/extension_import.py`: 0.2.12 is an explicit historical route; existing historical flags are preserved, including `page_entry_recovery` for patch >= 12; 0.2.13 is current and arbitrary future versions remain fail-closed.
- `tests/regression/extension-core/test-composed-version-policy.py`, `tests/regression/extension-core/store-package-contract.py`, and `tooling/b1/release-safety.test.mjs`: expectations follow the current 0.2.13 identity without weakening release fences.
- `apps/health-runner/src/authenticated-deep-runtime-authority.ts`: only `extensionVersion` advances from 0.2.12 to 0.2.13; `adapterEngineVersion` remains 0.1.0.
- `apps/health-runner/src/authenticated-deep-runtime-authority.test.ts` is intentionally unchanged and remains the real cross-package equality assertion that exposed the R2 omission.

No runtime feature behavior, API contract, trust key, browser minimum, migration level, provider/auth/marketplace behavior, live state, or historical 0.2.12 bytes are changed.

## Current d7f-based verification

The current `d7f26119...` reconstruction `c6d35c43...` was checked directly after reconstructing the accepted source onto the fresh base:

- composed-version policy: **11/11 PASS**;
- store-package contract: **PASS**;
- release-safety: **42/42 PASS** from the exact candidate root;
- authenticated-deep runtime-authority contract: **1/1 PASS**;
- `git diff --check`: **PASS**;
- worktree clean after checks: **true**.

Exact reconstruction evidence:
- `/root/octoport-control/logs/C/c01-store0213-immutable-release-identity-r3-20261005/FRESH_D7_RECONSTRUCTION_VERIFICATION.json`.

The earlier bounded D2.4 composition/build evidence from accepted R3 source `1f2c9a8e...` remains **supporting evidence only**:
- `/root/octoport-control/logs/C/c01-store0213-immutable-release-identity-r3-20261005/FRESH_D798_EXTENSION_CORE_OUTPUT/summary.json`
- `/root/octoport-control/logs/C/c01-store0213-immutable-release-identity-r3-20261005/FRESH_D798_EXTENSION_CORE_HEAVY.stdout`

It is not claimed as exact-head CI for the publication successor. After this receipt is committed, the exact successor SHA/tree must be written to the external source-freeze and independent review binding, and all five mandatory workflows must run on that same external exact SHA before main publication. No predecessor review or CI result is promoted across that identity change.

## Review history

- Independent peer review of `d37e09bff5c1e027ef3d7ea10bdcb3b98d713992` was PASS with P0/P1/P2 empty; it is supporting evidence only because the candidate identity later changed.
- Independent exact review of `c6d35c43d688781d157f9f5b7ecd6aa8136c057a` returned `REWORK_REQUIRED` solely for stale provenance text in this receipt. The reviewer explicitly confirmed the requested HEAD/tree/base, clean worktree, accepted full diff hash, scoped paths, 9/9 task-path blob match, 0.2.13 routing semantics, fail-closed future versions, unchanged adapter engine identity and absence of broader runtime/security changes.
- Independent exact review of receipt-correction candidate `8b74e93faab04374841bee63f144b1b1ecc6c127`, tree `72020e96413e9fc13e904b0eda259ef622afd327`, parent `d7f26119d4e1e73d6f45ea6127951583a1ae28e0`, returned `REWORK_REQUIRED` solely because this receipt did not name that exact predecessor identity. The reviewer again confirmed the seven code files were unchanged from `c6d35c43...`, the eight-path scope was exact, routing remained fail-closed, and no broader runtime/security change was introduced.
- The successor created by committing this receipt must receive its own exact read-only Luna review and external exact SHA/tree binding. No earlier verdict is promoted to that successor.

## Explicit exclusions and remaining gates

This task does **not** publish a 0.2.13 STORE ZIP, mutate compatibility catalog/live state, perform ordinary login, prove installed-browser behavior, claim LIVE_OWNER/DEPLOYMENT/PRODUCTION, or mark a package READY_FOR_OPERATOR.

Before main publication the exact corrected fresh-base candidate still requires independent `codex3` / `gpt-6-luna` read-only SOURCE review with P0/P1/P2 empty, a fresh-main compatibility check, all five mandatory exact-head CI workflows, governed task-publication, non-force main readback, and strict queue completion.
