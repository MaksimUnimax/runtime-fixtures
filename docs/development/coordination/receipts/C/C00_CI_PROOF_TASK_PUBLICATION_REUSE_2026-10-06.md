# C00 — reuse exact task-publication CI proof on identical main SHA

Task: `C00-CI-PROOF-TASK-PUBLICATION-REUSE-R1-20261006`

## Boundary

Base at task start: `c0735db63e866268f6f92e18573fa7c165711888`.
This change is limited to the CI proof selector and its regression tests. It does not change workflow triggers, required publication workflows, product code, package bytes, server/runtime behavior, credentials, databases, deployment, or production.

## Problem reproduced

For a main push whose SHA is byte-identical to a preceding governed task-publication push, `ci_proof.py` previously searched reusable same-SHA evidence only on `work/a-extension`, `work/b-backend`, and `work/c-integration`.
Governed publication uses branches under `controller/task-publication/`, so a successful exact-SHA full proof from that path could not be selected and the identical main push ran the enabled heavy suites again.
This is the checked ORG-002 boundary; it does not justify generic reuse from arbitrary `controller/*` branches.

## Contract

For `branch == main`, same-SHA source candidates are now limited to:
- the three existing `STREAM_BRANCHES`; or
- a string branch beginning exactly with `controller/task-publication/`.

Arbitrary `controller/*` source branches remain ineligible for main proof reuse.
The existing direct-run `trusted_branch` behavior is unchanged; being eligible to run a controller workflow does not make that branch reusable evidence for main.

The newest eligible same-SHA source run still wins across eligible source branches. A newer failed, incomplete, future, malformed, wrong-workflow, wrong-repository, stale, or wrong-SHA task-publication run therefore cannot hide behind an older green run.
`select_run` continues to require exact branch identity, push event, workflow path and name, an older run id than the current run, completed/success, canonical repository and head repository, and freshness within six hours.
`full_jobs` continues to require complete job enumeration, all expected jobs, no duplicate names, exact head SHA and attempt, and completed/success for every returned job.

Existing stream reuse retains reason `EXACT_STREAM_PUSH_FULL_PROOF`.
Accepted task-publication reuse reports `EXACT_TASK_PUBLICATION_PUSH_FULL_PROOF`.

## Regression coverage

Added explicit cases for:
- accepted exact-SHA `controller/task-publication/*` reuse on main;
- rejection of a generic `controller/*` source;
- rejection when a newer task-publication attempt failed;
- rejection of stale task-publication proof;
- rejection of task-publication exact-SHA mismatch.

Existing stream, parent-prose, workflow/repository/fork, pending/failure, attempt, job completeness, freshness, unknown API, event identity, missing history and symlink fail-closed cases remain intact.

Local checks on the source candidate before commit:
- `python3 tooling/coordination/test_ci_proof.py` — PASS, 19/19.
- `python3 -m py_compile tooling/coordination/ci_proof.py tooling/coordination/test_ci_proof.py` — PASS.
- `git diff --check` — PASS.

## Evidence level and remaining gate

Evidence at this receipt is SOURCE / LOCAL_CONTRACT only.
ORG-002 must not be closed from unit tests alone. Whole-class effect requires the next real governed task-publication → identical-main transition to demonstrate reuse without hiding a newer failure.
Before main publication this exact candidate still requires independent review, all five mandatory exact-SHA CI workflows, the normal ready-main path, non-force push, and remote-main readback.
