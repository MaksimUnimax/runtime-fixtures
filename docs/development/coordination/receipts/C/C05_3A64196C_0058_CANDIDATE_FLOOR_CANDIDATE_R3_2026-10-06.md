# C05 — 3a64196c migration0058 candidate → floor → candidate recovery R3 — 2026-10-06

## Exact boundary

Task: `C05-3A64196C-0058-CANDIDATE-FLOOR-CANDIDATE-R3-20261006`.

- exact candidate source: `3a64196c9fa54ed842e5d221fcb1266e5f962994`;
- candidate tree: `9a9fb6d95d4ce8aad1705392ba67385d2f13d72e`;
- accepted rollback floor: `d24838669c54f21dc161dc48a7e71e0e288384c2`;
- rollback-floor tree: `5e3530ca38970a6487aa73b7297aa1953012eb7e`;
- Drizzle journal count: `47`, latest tag `0058_extension_release_browser_artifacts`;
- accepted harness blob: `0e1dcb154937b631ec353a15da4aa2bdddd52321`;
- accepted runtime-identity blob: `b0df0b27cd85214e10c0f128b0bbd00f5f40f3b5`;
- Drizzle journal blob: `485ea5cee05f40fc8be7475d69601c848a12bb12`.

The predecessor `c8dd58f3...` heavy rehearsal remains valid only for that exact source. Main advanced to `3a64196c...` by adding the accepted Chrome policy canonical input and exporting it through `packages/server/compatibility/src/index.ts`. The accepted C05 harness, runtime-identity helper and migration journal are byte-identical, but server compatibility source is part of the exercised application boundary, so the c8dd PASS was not promoted to the new source.

## Supervised real recovery rehearsal

One fresh heavy run was accepted for `3a64196c...`. It used the role-C disposable PostgreSQL fixture through the existing bounded e2e resource supervisor with a 4096 MiB ceiling. Task-local dependency links pointed only to already-installed frozen workspace dependencies; no package installation, lockfile mutation or shared dependency change occurred. Those task-local links and cache were removed after the run.

The accepted R1 completed this exact sequence:

- `RESTORE_READY`;
- `CANDIDATE_SOURCE_READY`;
- `FORWARD_MIGRATION_PASS`;
- `UPGRADED_BACKUP_RESTORE_PASS`;
- `FLOOR_SOURCE_READY`;
- `SYNTHETIC_SETUP_READY`;
- `CANDIDATE_PHASE_1_PASS`;
- `FLOOR_PHASE_PASS`;
- `CANDIDATE_PHASE_2_PASS`;
- `CLEANUP_PASS`.

The resource unit `octoport-test-c-0e1ff6a830724fc6a48bdc7881e02046.service` exited 0 with `cleanup_verified=true`; peak memory was 1402 MiB.

Primary evidence:

`/root/octoport-control/logs/C/c05-3a64196c-0058-recovery-r3-20261006/evidence/c05-three-service-rollback-evidence.json`

SHA-256: `6a739072fcbf9aa4e70e76079318e91070a4858e02c54783e39151ee1600d2a9`.

The seed was restored from journal 40 and forward-migrated to journal 47. The upgraded forward-schema backup SHA-256 is `8be021fcb7d60e811be9b52511bf75bbc83c7f290b8e542b5173704c27f58792`, size 504199 bytes. The three application phases are exact `3a64196c...` → exact floor `d2483866...` → exact `3a64196c...`. Each candidate/floor phase reports API live/ready 200, worker-ready evidence and portal login 200.

Post-run evidence reports `disposableDatabaseDropped=true`, `privateTransientStateRemoved=true` and `tempWorkRemoved=true`. No live database, deployed service, provider, marketplace, SMTP, Telegram, browser, owner authentication or extension package bytes were mutated.

## Verdict and limits

Verdict: `PASS_DISPOSABLE_POSTGRESQL_REAL_APP_RECOVERY_CURRENT_0058_3A64196C`.

This proves the exercised migration0058 recovery boundary for exact `3a64196c...` using real disposable PostgreSQL and real API/worker/portal processes. It does **not** prove `LIVE_DB_RESTORE`, live owner-test deployment, production rollback, destructive down-migration safety, ordinary extension authentication, live catalog/policy/profile publication or `LIVE_OWNER`.

The rollback model remains application candidate → accepted floor → candidate over the restored forward schema. Restoring an older database snapshot after writes reopen remains a separate data-loss/recovery decision.
