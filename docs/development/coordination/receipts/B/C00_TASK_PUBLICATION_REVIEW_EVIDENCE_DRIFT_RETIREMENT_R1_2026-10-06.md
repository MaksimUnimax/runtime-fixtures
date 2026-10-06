# C00 — task-publication review-evidence-drift retirement R1 — 2026-10-06

Task: `C00-TASK-PUBLICATION-REVIEW-EVIDENCE-DRIFT-RETIREMENT-R1-20261006`

Evidence level: **SOURCE / LOCAL_CONTRACT** only.

## Problem

A historical governed publication can reach `TASK_REF_PUBLISHED` and later become impossible to retire through ordinary `supersede` if the already registered review path is accidentally overwritten. Ordinary supersede correctly re-hashes the registered review and fails `REVIEW_HASH_MISMATCH`; manually editing registration state or deleting the public temporary ref would bypass the publication state machine.

The concrete historical consumer is registration `7b330792...`. This source task does **not** mutate that registration. It adds a narrow recovery contract that must itself be reviewed and normally published before any separately governed operational use.

## Recovery contract

Normal supersede behavior remains unchanged and continues to require the original registered review hash.

A second evidence kind, `octoport.task-publication-review-drift-retirement-evidence`, is accepted only for a registration currently in `TASK_REF_PUBLISHED`. It binds:

- exact registration, task, candidate SHA/tree and task ref;
- the registered review path and expected SHA;
- the freshly observed, different review SHA;
- fixed classification `EVIDENCE_PATH_BYTES_DRIFT_AFTER_TASK_REF_PUBLICATION`;
- a non-empty reason;
- optional distinct successor SHA;
- non-empty hash-verified supporting evidence.

The current work-board row must still belong to the registered role and be `BLOCKED`. A READY/IN_PROGRESS task cannot use this recovery.

## Preserved fail-closed identity

Review-drift recovery skips only validation of the old review file's current bytes. It still validates the immutable registration/core hash and active pointer, clean exact candidate HEAD/tree/parent, changed paths and full/publication diff hashes, ownership/path scope, accepted manifest and preserved patch, execution bundle, and route/common/global/fixed-role configuration.

This last configuration check is performed before a deletion lease can be prepared. Therefore a changed hook path, push URL or other registered route/config identity cannot delete the task ref and then fail only during close.

The remote operation is deletion-only:

- absent exact task ref -> `ALREADY_ABSENT`, then ordinary close;
- exact task ref still equal to the registered candidate -> existing supersede lease/hook/send-pack/CAS deletion machinery;
- foreign task ref -> fail closed with `REVIEW_DRIFT_RETIREMENT_FOREIGN_TASK_REF` and leave it untouched.

The path never pushes the candidate or `main`. Parent, isolated hook and settlement all revalidate the evidence kind through the same request validator. Ordinary supersede keeps its original review validation.

## Regression evidence

The first exact candidate `6e881d3b...` passed 87 focused tests, py_compile/docs/diff checks, then independent `gpt-6-luna` review returned `REWORK_REQUIRED` with P0=0, P1=0 and one P2: operation-level tests did not explicitly cover missing supporting evidence, wrong/missing registered review path, or a `READY` work-board row. That candidate was not published or used operationally. R2 added those negatives and reached 90/90 focused PASS.

Fresh-main R3 candidate `0df8d3b6c97b3bb9932a83d134d04e8dc16dcc94` was reconstructed directly on `3a64196c9fa54ed842e5d221fcb1266e5f962994` and preserved the accepted R2 behavior. Independent `gpt-6-luna` review again returned `REWORK_REQUIRED`, P0=0/P1=0/P2=1: the drift receipt validator still accepted unknown top-level fields, and Python `True == 1` meant `version: true` passed the identity comparison. Review evidence is preserved at `/root/octoport-control/logs/B/C00-REVIEW-DRIFT-R3-3A-REVIEW-20261006-result.md`, SHA-256 `bb0b6e40d079a56451391db99b91608fa2b538c2c13af9f29cef0673d538f81c`.

R4 changes only that finding:

- the review-drift receipt must have exactly the 13 defined top-level keys;
- `version` must satisfy `type(version) is int`, so booleans and strings fail closed;
- operation-level regressions reject an extra key, `version: true`, and `version: "1"`, while proving the registration/task ref remains unchanged after each rejection.

Before the R4 candidate freeze, `origin/main` advanced from `3a64196c9fa54ed842e5d221fcb1266e5f962994` to `ba85c725b9d8f07406f42c4bed5e2a3d83187c57` only through the disjoint C05 recovery receipt. All four assigned C00 paths were unchanged. The exact R4 diff was therefore reconstructed on `ba85c725...` and the full focused suite was rerun there; the earlier 3a run is intermediate evidence only.

Full focused R4 publication suite on fresh base `ba85c725b9d8f07406f42c4bed5e2a3d83187c57`:

- `python3 tooling/coordination/test_task_publication.py`: **91/91 PASS**;
- `python3 -m py_compile tooling/coordination/task_publication.py tooling/coordination/test_task_publication.py`: PASS;
- `node tooling/checks/docs-check.mjs`: PASS;
- `git diff --check`: PASS.

R4 fresh-base evidence:

- test log: `/root/octoport-control/logs/B/c00-review-evidence-drift-retirement-r4-ba85-tests.log`, SHA-256 `2160c0367296d4b8f1d4f4bfea52483efd47bcf00c2736de7723a081713dfde5`;
- docs log: `/root/octoport-control/logs/B/c00-review-evidence-drift-retirement-r4-ba85-docs.log`, SHA-256 `4fd5bd537b05765b3de8b0a75f4813305469a12518c3be4be4befd5f19dc8e29`.

Regression coverage now includes successful exact-ref retirement against a disposable bare remote; unchanged normal supersede review-hash enforcement; real hash drift and BLOCKED-state requirements; exact 13-key/type-checked drift evidence; explicit rejection of missing supporting evidence, wrong or missing registered review path, and `READY`/`IN_PROGRESS` work-board states; TASK_REF_PUBLISHED-only scope; already-absent idempotence; terminal replay; foreign-ref and dirty-worktree rejection; accepted-manifest drift; and route-config drift before any ref mutation.

## Non-claims and next gate

No real GitHub task ref, historical registration, `main`, product source outside this coordination scope, package, browser, database, service, provider, operator record, deployment or production state is changed by this source task.

Registration `7b330792...` must not use this recovery until the exact source candidate has a fresh independent `gpt-6-luna` review with no P0/P1/P2, all normal publication gates are satisfied, and the recovery implementation is accepted on `main`. Any operational retirement remains a separate governed action with its own exact evidence.
