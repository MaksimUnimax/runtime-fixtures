# C owner-test forward recovery — 2026-09-28

Status: **SOURCE RECOVERY CANDIDATE — LIVE RECOVERY NOT YET EXECUTED**

## Trigger

Authorized tracked deploy on main `6fce1c291fcd00d1f5b28a27898e3df642b2adff` passed preflight, backup, isolated 22→40 migration, live migration to canonical 40 and candidate runtime health (`live=200`, `ready=200`, `portal=200`, worker ready).

The apply then failed closed with `MONITOR_UNIT_CHANGED`. Durable evidence remains under `/root/octoport-control/logs/C/owner-test-deploy-62024d19/`; the owner-test product units are intentionally quiesced, schema state is `FORWARD_VERIFIED`, and `recoveryRequired=true` remains set.

## Root cause

The deploy guard compared raw `systemctl show ExecStart` strings for monitor units. Those strings include volatile runtime metadata such as `start_time`, `pid`, `code` and `status`. The owner-test drop-in switch runs `systemctl daemon-reload`; the monitor executable/argv and `NRestarts` stayed unchanged, but systemd re-serialized those volatile fields, creating a false positive.

Independent readback after failure confirmed canonical migration prefix 40, exact candidate drop-ins, both monitor units active/running on the same c2e71550 executable/argv, and `NRestarts=0`.
## Correction

`deploy_owner_test.py` now normalizes only volatile ExecStart runtime fields while preserving configured path/argv/ignore-errors identity. Monitor snapshots also require active/running state and restart-count stability.

A narrow `recover-forward` command accepts only the exact durable state:
- candidate `62024d192a8572c11aafab91653330d1f996699f`;
- `FORWARD_VERIFIED`, phase `CANDIDATE_PASS`;
- failed source receipt `MONITOR_UNIT_CHANGED`;
- live migration count 40 and prior candidate health PASS.

Before starting product units it re-verifies immutable candidate/floor, canonical prefix40, exact candidate drop-ins, product quiescence and monitor identity. Any recovery failure re-quiesces product units and preserves the durable fence.

## Validation so far

- Existing failure matrix remained 20/20 PASS after stable monitor identity change.
- Added runtime-metadata and real-command-change regressions: 22/22 PASS.
- Added forward recovery success / non-eligible failure / health-failure requiesce cases: 25/25 PASS.
- No recovery command has yet been executed against owner-test by this source candidate.

Next: exact C guard/commit, independent read-only review and five branch workflows. Only after that candidate is promoted to main may C execute the already-authorized forward recovery and record DEPLOYMENT evidence.