# CONTROLLER-TASK-PUBLICATION-ROUTE source receipt

Task date: 2026-10-01. Recovery implementation date: 2026-10-02.

The partial isolated publication implementation could not validate its own
registration, rejected the frozen A manifest schema, omitted blocked-task
reclaim, and did not fully revalidate identities when settling an interrupted
push. Required tests and operating documentation were absent. Independent R1
source review required rework.

This change implements the reviewed R6/R7/R8/R9 contract: committed external
hook bundles, normalized and verified source manifests, exact-task unblock,
single-parent reconstruction, task/review/configuration identity checks,
version-bound ready receipts, atomic lease consumption/cancellation, strict
consumed-attempt settlement, immutable recovery evidence, guarded cleanup,
and exact worktree-local configuration restoration.

The route requires `work_queue.advance_task(..., expected_task=...)` for
race-safe reclaim. This dependency is supplied by the separately reviewed queue
recovery change. A v2 live board also requires its matching reader in the bundle.

Validation recorded under the owner recovery audit:

- `publication-queue-integration-r4.log`: 30 tests passed on the real server with
  the new queue writer, including race-safe unblock and a full
  disposable bare-Git task-ref → ready → main → cleanup → close cycle.
- The focused resource job exited 0, peaked at 45 MiB, and verified cleanup.
- Tests use synthetic CI results only inside disposable fixtures. Operational
  ready receipts must use real exact-candidate CI results.

Audit directory:
`/root/octoport-control/controllers/audits/OWNER-PUBLICATION-RECOVERY-20261002T0421Z`.
Exact source identities, subsequent test runs, independent review, publication
and installation results belong to immutable records there. This source
receipt does not assert that review, main publication, or installation has
already completed.
