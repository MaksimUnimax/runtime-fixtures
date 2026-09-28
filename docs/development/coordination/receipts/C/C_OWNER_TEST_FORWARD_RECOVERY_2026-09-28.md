# C owner-test forward recovery — 2026-09-28

Status: **DEPLOYMENT RECOVERY PASS — RUNTIME READY; ORDINARY AUTH / INSTALLED / USEFUL-FLOW NOT YET ACCEPTED**

## Trigger

Authorized tracked deploy on main `6fce1c291fcd00d1f5b28a27898e3df642b2adff` passed preflight, backup, isolated 22→40 migration, live migration to canonical 40 and candidate runtime health (`live=200`, `ready=200`, `portal=200`, worker ready).

The apply then failed closed with `MONITOR_UNIT_CHANGED`. Its durable failed receipt is `/root/octoport-control/logs/C/owner-test-deploy-62024d19/apply-20260928T111855095131Z/receipt.json`; failure handling quiesced the three owner-test product units with schema state `FORWARD_VERIFIED` and `recoveryRequired=true`.

The bounded `recover-forward` path was then independently reviewed and executed. Live recovery receipt `/root/octoport-control/logs/C/owner-test-deploy-62024d19/recovery-20260928T114222879214Z.json` records `FORWARD_RECOVERY_PASS`, `recoveryRequired=false`, canonical prefix 40, candidate runtime health PASS and unchanged monitor identity. No second 22→40 apply was performed.

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

The live recovery ran from parent HEAD `5584f6f18044ce13a9086e8f5512bef08c9ce213` plus the then-dirty two-file provenance guard. The executed `deploy_owner_test.py` SHA256 was `13ecef92db6a1f7e3a29676c1c21bd22011c41b76a86a34638fd64ebf532ec5d`; the paired test file SHA256 was `425b102a16854fc546b63e0f65271496868dacb0588029ff3c2c06061f417303`; the exact dirty diff SHA256 was `dc837a716746a1f3324f26607c6f7badfd05dbf6a52830011ef539dcf5c51df0`. These are recorded as executed-source provenance, not misreported as a published commit.

After live recovery, a final source-only hardening pins `recover-forward` to the exact failed receipt relative path and SHA256 `619e0c6f86b2a4128e7f5ab2f9e8db8c9a6115acb12d5904e02137bc7db7222c`. Future unrelated failures are intentionally rejected until new reviewed source is authored.

## Validation and live readback

- Existing failure matrix remained 20/20 PASS after stable monitor identity change; runtime-metadata and real-command-change regressions extended this to 22/22.
- Forward recovery success / non-eligible failure / health-failure cases extended the matrix to 25/25. First Luna review BLOCKED a pre-start failure-handler gap; commit `5584f6f18044ce13a9086e8f5512bef08c9ce213` closed that gap.
- A second Luna review BLOCKED arbitrary evidence receipt provenance. The live recovery executed only after a narrower dirty path/stamp guard was present; recovery receipt SHA256 is `42458913a85255da411cf3d31a28e30dd265eae06e0e0252220e005738169962`.
- Post-recovery source hardening added exact failed-receipt path+SHA pinning and a modified-canonical-receipt negative test. Final matrix: **28/28 PASS**, `py_compile` PASS and `git diff --check` PASS under supervisor `octoport-test-c-41f51fe648c749f7a8dad116d62cb1af.service`, exit 0, peak 24 MiB, OOM 0, cleanup verified.
- Final retained source SHA256: `deploy_owner_test.py` `bed51791106254b78f612dc23319e30e035abc9e1d0a63724ee521b7feb0d036`; test file `4f778757d659105c97c47444d0811a5812a1d3657666509279fbfd5e3800c23e`; final two-file diff SHA256 `334354eacaafc35e698f38e80ba93ff7050243d569958e970e6a1cbcf925f864`.
- Final Luna source review `owner_test_forward_recovery_review4_20260928` returned **PASS_WITH_NONBLOCKING_NOTES**: no blocking source issue; exact path+content pin closes fabricated receipt substitution under the stated local-OS trust model.
- Independent post-recovery readback: canonical migration prefix **40/40 PASS**; API `/health/live` 200; API `/health/ready` 200; portal `/login` 200; API/worker/portal active on immutable `62024d192a8572c11aafab91653330d1f996699f`, `NRestarts=0`; both monitor units remain active on exact `c2e715501161d421b1641bb697c7ee7786d84960`, `NRestarts=0`.
- Controller independently verified the same deployment/runtime facts and explicitly classified them as DEPLOYMENT evidence, not ordinary authentication, installed-extension or useful-flow acceptance.

Next: commit/publish the final reviewed retained source without altering the executed evidence, update C state to `DEPLOYMENT_READY`, and hand A the already-authorized ordinary login/OTP + exact STORE 0.2.6 controls/useful read-only flow. Never rerun the original 22→40 apply on the already-forward database.