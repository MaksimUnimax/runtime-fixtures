# C04 immutable ops-release bytecode recovery — 2026-09-29

Status: **LIVE PILOT PERIODIC RETENTION RECOVERED / SOURCE PREVENTION FIX READY / NO PRODUCT DEPLOY**

## Incident

The accepted isolated retention timer stayed enabled, but its oneshot service failed every 30 minutes from 19:49 MSK through 23:19 MSK with `RELEASE_FILE_SET_MISMATCH`.

Immutable ops release:
- source SHA: `fe3b4aeb9bcd41a038f79d7c233a6866b314a0fc`;
- source tree: `0ef76a7b1dae0b7c779ea07006ba0334aab7ed4e`;
- expected files: 25283;
- expected symlinks: 917.

All 25283 expected file checksums still matched and no expected file was missing. The only extra entry was `tooling/operations/__pycache__/monitor_pilot_retention_runner.cpython-311.pyc`.

That file was root-owned and created at 2026-09-29 19:41:01 +03:00. The service runs as `octoport-monitor`, so the service itself did not create the root-owned file.

## Root cause

C04 acceptance executed the **deployed** `test_monitor_pilot_retention_runner.py`. That test inserted its deployed directory into `sys.path` and imported `monitor_pilot_retention_runner` normally. Python therefore wrote bytecode beside the imported module.

The C04 acceptance receipt was written at 19:42 MSK. The first scheduled immutable-release verification failed at 19:49 MSK. The strict verifier behaved correctly; ignoring `__pycache__` is not the fix.

## Source prevention fix

Source commit: `898336cc6dd54c7a8155d6586704bdb061c4a014`.

The deployed-style test now sets `sys.dont_write_bytecode = True` before importing the local runner and contains a regression that pins this ordering.

Evidence:
- source test: **13/13 PASS**;
- independent temporary deployed-style copy with both systemd templates: **13/13 PASS**;
- no `monitor_pilot_retention_runner*.pyc` after either run;
- `git diff --check`: PASS.

The source fix is not patched into the existing immutable release. It follows the normal C source/CI/main path and becomes effective in a future accepted ops release.

## Live pilot recovery

Before mutation:
- timer enabled and active/waiting;
- service failed only at immutable `ExecStartPre`;
- expected-file hashes: **25283/25283 match**;
- file-set delta: exactly one extra `.pyc`, zero missing files.

Recovery stayed inside the already-authorized isolated retention pilot:
1. stop only `octoport-monitor-retention.timer`;
2. remove the single proven generated `.pyc` and empty `__pycache__`;
3. verify release as `octoport-monitor`: **PASS 25283 files / 917 symlinks**;
4. run read-only inspect;
5. run one normal retention apply for accumulated backlog;
6. verify immutable release again;
7. restore the existing timer.

Read-only inspect found `projection=27`, `incident=0`, `blocked={}`, `deadlineReached=false`.

Recovery apply processed 27 projected / 27 reconciled / 27 pruned, leaving `pendingAfter.projection=0`, `nextCursor=null`, `blocked={}`, `deadlineReached=false`, `prunedReceipts=316`, `terminal=18`.

The next **automatic timer-triggered** cycle also passed with `projection=0`, `ALREADY_PRUNED=316`, `RECENT_STATE_PINNED=8`, no blocked work and no deadline.

After that automatic cycle:
- timer: enabled, `active/waiting`;
- service last result: success;
- immutable verifier: **PASS 25283 files / 917 symlinks**;
- `.pyc` entries inside the release: **0**.

## Boundaries

This recovery did not deploy new product API/worker/portal code, apply live migration 0055, create another Telegram poller, or invoke provider/payment/store-publication operations.

The old deployed test in release `fe3b4aeb...` must not be manually rerun without bytecode suppression before a future accepted ops release carries the source prevention fix. The scheduled runtime path itself was re-proved not to recreate bytecode.
