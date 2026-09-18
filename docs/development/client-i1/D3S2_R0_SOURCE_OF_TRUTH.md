# D3/S2 R0 — Source-of-truth and residual recovery

Work ID: `D3S2-R0-RESIDUAL-SOURCE-OF-TRUTH-RECOVERY-2026-09-18`

Status: `RECOVERY_ARTIFACT_ONLY`. This document does not self-accept D3/S2,
does not implement the recommended feature, and does not change the accepted
C3E/C3F/P1/P2/P3 models.

## Exact starting state

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `acceptance/i1-d2-full-automated-prehandoff-2026-09-18`
START_LOCAL_HEAD: `57f872b84bd121959c368d571d6bf9b80fdb3839`
START_LOCAL_TREE: `c1fdc6a2ed3dd77af499bdb3fed14d7fb471d050`

The expected candidate is present locally. `git cat-file -t` returns `commit`,
`git rev-parse 57f872b8^{tree}` returns the exact expected tree, and `HEAD`
resolves to the exact expected commit.

LOCAL_START_CLASSIFICATION: `LOCAL_ACCEPTED_CANDIDATE_VERIFIED`.

The accepted post-D3A/I1 chain is intact through the local Early-I1 receipt:

```text
C3B ed32fc1
 -> C3C 5c87191
 -> C3D d91aa70
 -> C3E 2b2ca0c
 -> C3E-R1 2809415 / eeb943f closure line
 -> C3F 9724a9b
 -> C3G b8639fc
 -> C3H 804d58b
 -> P1 77c101c
 -> P1-R1 1d9f0ca
 -> P2 ca45019 / receipt 09b32c8
 -> P3 4a339f3 / receipt commits 8369401, 1809b15, ae92876, 57f872b
 -> D2 pre-handoff receipts 8369401, 1809b15, ae92876, 57f872b
```

The exact P3-to-receipt lineage and tree identities are recorded in
`EARLY_I1_D2_AUTOMATED_PREHANDOFF_ACCEPTANCE_2026-09-18.md`. No local branch
or remote-tracking ref is a descendant of `57f872b8`; no newer descendant was
found in local heads, fetched remote-tracking heads, or the inspected reflog.

## Remote facts verified

`git fetch origin --prune` completed normally. The supplied refs resolve to:

| Ref | Commit | Tree checked during recovery |
|---|---|---|
| `origin/main` | `bc718cc5c677ad0eb4598e7de3ad766473ff0847` | `4543971211ffaca302fb201ebe11a4a5fc7d6462` |
| `origin/integration/i1-c1-srv5-2026-09-16` | `23047b3bdc22842a5b17e29e3d3f603c0ee51b16` | `314b3a6db2989830ef9ea7659490f4eaa7c5b39b` |
| `origin/docs/roadmap-autonomy-correction-2026-09-18` | `6a48af8cd19137aaa10688c36cb064d3c4b16969` | `9963100b003b6cb11a09e4b97e50de0ef647adf` |

Remote publication was not attempted. The accepted local implementation line
is ahead of the remote facts above.

## Worktree state

At start, there were no tracked modifications. The worktree had these
pre-existing untracked entries, all preserved:

- symlinks under `packages/server/*/*` pointing at local `node_modules` package
  paths (including `adapter-registry`, `auth`, `health`, and the other listed
  server packages);
- `repro/`.

No reset, rebase, amend, force-push, merge, checkout-discard, or deletion was
performed. The recovery artifacts in this directory are intentionally not
mixed with those entries. The workspace remains dirty because both the
pre-existing entries and these new audit documents are uncommitted.

## Source precedence used

1. Explicit current product/architect truth in the task handoff, including the
   carried-forward acceptance status and permanent architecture invariants.
2. Exact local accepted code, tests, and Early-I1/D2 receipt at `57f872b8`.
3. Later local evidence/design receipts for C3E, C3F, C3G, C3H, P1/P1-R1, P2,
   and P3 on the same ancestry.
4. Live normative product and architecture documents.
5. Fetched remote docs and older status prose, only as historical context.

This ordering is necessary because the local `ROADMAP.md`/`STATUS.md` prose
still contains pending-review language for some C3H/P2/P3 and Early-I1 items,
while the task handoff and exact local receipt carry the later accepted local
status. That stale prose was not rewritten in R0.

## Stale or misleading documentation findings

- `origin/main` still describes the older I1-SRV synchronization boundary and
  does not contain the local C3E/C3F/P1/P2/P3 implementation line.
- The fetched roadmap-correction branch is a roadmap document branch, not the
  accepted local implementation ancestry.
- Local `docs/ROADMAP.md` and `docs/STATUS.md` correctly keep D3/S2, Q1, B1,
  production publication, live providers, and full browser coverage open, but
  their “architect acceptance pending” wording for the already-carried local
  Early-I1 receipt is stale relative to this task handoff.
- `docs/product/SPEC.md`, `docs/architecture/*`, and the acceptance matrix are
  target contracts. They do not prove a feature exists. In particular, their
  transfer/export clauses are not implementation evidence.
- `docs/architecture/CONTRACTS.md` mentions future shop metadata and transfer
  endpoints, but the current tree has only the C3E/C3F `/v1/sync` contract;
  those future entries are design intent, not existing routes.

## Files read

Normative source:

- `docs/ROADMAP.md`
- `docs/STATUS.md`
- `docs/product/SPEC.md`
- `docs/decisions/DECISIONS.md`
- `docs/decisions/OPEN_ITEMS.md`
- `docs/development/ACCEPTANCE_MATRIX.md`
- `docs/architecture/OVERVIEW.md`
- `docs/architecture/SYNC.md`
- `docs/architecture/STATE_MACHINES.md`
- `docs/architecture/CONTRACTS.md`
- `docs/architecture/DATA_AND_SECURITY.md`

Local design/evidence:

- `docs/development/client-i1/C3E_RARE_EXTENSION_INITIATED_SYNC_JOURNAL_2026-09-18.md`
- `docs/development/client-i1/C3E_R1_ACCEPTANCE_CLOSURE_2026-09-18.md`
- `docs/development/client-i1/C3F_MULTI_BROWSER_RECONCILIATION_2026-09-18.md`
- `docs/development/client-i1/C3G_CORRECTED_PREDISPATCH_2026-09-18.md`
- `docs/development/client-i1/C3H_CORRECTED_AUTONOMY_FULL_ACCEPTANCE_2026-09-18.md`
- `docs/development/client-i1/POST_C3H_PROVIDER_OUTCOME_REPLAY_2026-09-18.md`
- `docs/development/client-i1/POST_C3H_PROVIDER_OUTCOME_REPLAY_R1_ACCEPTANCE_2026-09-18.md`
- `docs/development/client-i1/POST_C3H_P2_JOINT_OFFLINE_COMMAND_RESULT_RECOVERY_2026-09-18.md`
- `docs/development/client-i1/POST_C3H_P3_LOCAL_SCHEDULER_INTEGRATION_2026-09-18.md`
- `docs/development/client-i1/EARLY_I1_D2_AUTOMATED_PREHANDOFF_ACCEPTANCE_2026-09-18.md`
- `docs/development/client-i1/README.md`

Implementation surfaces inspected:

- `packages/bridge-core/src/stores/catalog.js`
- `apps/extension/src/application/runtime.js`
- `apps/extension/src/application/popup.js`
- `apps/extension/src/application/sync-journal.js`
- `packages/bridge-core/src/sync/reconciliation.js`
- `packages/bridge-core/src/execution/provider-outcome.js`
- `packages/bridge-core/src/execution/result-recovery.js`
- `apps/extension/src/application/technical-scheduler.js`
- `packages/contracts/src/index.ts`
- `apps/api/src/sync-routes.ts`
- `packages/server/sync/src/index.ts`
- `packages/server/sync/src/reconciliation.ts`
- `packages/server/db/src/schema/sync.ts`
- `packages/server/db/drizzle/0017_i1_c3e_sync_journal.sql`
- `packages/server/db/src/sync-repository.ts`
- device/auth modules under `packages/server/device-auth`,
  `packages/server/device-management`, `packages/server/extension-auth`, and
  `packages/control-client`
- Stream-2 boundary paths `apps/health-runner/**`,
  `packages/server/health/**`, and `tooling/api-watch/**` as ownership checks

## Verification boundary

Targeted package tests passed: `@product/sync` 8/8, `@product/contracts` 9/9,
and DB unit/migration tests 12/12. Supported composed-runtime checks passed:
C3E 6/6, C3F 28/28, P2 9/9, and P3 7/7. JavaScript syntax checks passed
under Node `v24.20.0`. The first C3E/C3F invocation used a file instead of the
required runtime directory and produced only the expected harness `ENOTDIR`
argument error; it was rerun correctly and passed.

These checks validate existing artifacts and entry points. They do not grant a
new D3/S2 behavior PASS.
