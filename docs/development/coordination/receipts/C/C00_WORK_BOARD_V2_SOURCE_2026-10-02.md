# C00 — Work board v2 source implementation

Date: 2026-10-02

## Scope

Implemented the isolated work-board v2 source candidate from base `961d4ed1e157b751017d9c6bfeffc52726856f05` in the registered controller worktree. The implementation preserves the public v1 logical board shape and queue API while adding the v2 sidecar and generation model described in `docs/development/coordination/WORK_BOARD_V2.md`.

The implementation includes the v2 reader/writer, queue compare-and-set, inspect-only migration with single-use authority, protected four-reader two-file rollout, and focused unit/fault tests. It does not change the live board, operational role state, running readers, shared source, or publication route. No migration, rollout, commit, or push was performed by this implementation task.

## Verification

Focused command, run with bytecode disabled and a task-local temporary directory:

```sh
PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.task-cache" PYTHONPATH=tooling/coordination \
  python3 -m unittest test_work_board_v2 test_work_queue \
  test_work_board_v2_migrate test_work_board_reader_rollout test_waiting_gate
```

Result: 66 tests passed. `git diff --check` passed. The tests use temporary roots and include queue fault boundaries, exact/torn event recovery, migration rollback and committed-receipt failure, generation reopen, capacity checks, authority rejection, rollout parity/rollback, and waiting-gate invalidation.

## Handoff state

This is an unaccepted source candidate pending independent review. The frozen live board has only been inspected/projection-tested; no v2 generation was published. Any migration or reader rollout requires the separate owner-authorized operational process and fresh exact receipts. The test result is scoped to these focused Python tests and does not claim full repository CI or live migration verification.
