# C06 merge-aware coordination guard

Date: 2026-09-25
Role: C
Status: **SOURCE FIX VERIFIED / NOT YET MAIN**

## Problem

After C accepted and published Firefox/C05 work, both A and B had no product delta versus current `main`, but their normal merge commit was blocked by the pre-commit ownership guard. During `git merge origin/main`, the hook ran `control.py <role> guard`; the default guard compared the merge result against the role branch's old `HEAD`. As a result, every accepted upstream file owned by another role appeared to be a local ownership violation.

Both streams independently observed that explicit `guard --base origin/main` was empty/PASS, confirming that the product trees had no unauthorized local delta.

## Fix

`tooling/coordination/control.py` now resolves the default ownership base as:

- `MERGE_HEAD` while a merge is in progress;
- ordinary `HEAD` otherwise.

Explicit `--base` continues to override automatic detection unchanged.

This keeps the existing ownership rule intact:

- accepted upstream files from the merge target are not attributed to the receiving role;
- the receiving role's own branch delta and any conflict-resolution edits are still compared against `MERGE_HEAD`;
- a forbidden cross-role edit made during the merge still blocks the commit;
- ordinary non-merge commits still use `HEAD`.

## Verification

Coordination unit suite:

- 34 tests run;
- PASS, with the existing 7 environment-dependent skips;
- includes direct tests for MERGE_HEAD preference, HEAD fallback, merge-base use in `scope_guard`, and explicit-base override.

Real Git mini-rehearsal with the actual pre-commit hook:

1. base repository contained one A-owned extension file and one C/API-style upstream file;
2. accepted-main changed only the upstream API file;
3. A branch changed only its extension file;
4. `git merge --no-commit accepted-main` created `MERGE_HEAD`;
5. default `control.py A guard` returned only the A-owned extension file;
6. merge commit passed the actual pre-commit hook;
7. a second rehearsal changed the upstream API file locally after the merge;
8. the same hook rejected the commit with `OWNERSHIP_VIOLATION: apps/api/upstream.txt`.

No hook bypass, force-push, reset of published history, live DB action, or product runtime change was used.

## Acceptance boundary

This receipt proves the guard algorithm and hook behavior in source/disposable Git rehearsal. A and B should only retry ordinary current-main synchronization after this exact coordination change is accepted into `main`; they must not bypass hooks in the meantime.
