# C03 API-watch product-compatible baseline integration — 2026-09-28

Status: INTEGRATED BRANCH CANDIDATE / NOT LIVE DEPLOYED.

Canonical base before this chain: `80c7fe6240b2ff53525040531e48fa7986d528a4`.

Integrated source/dependency chain:
- C03 source policy checkpoint `d5774b05672d0ebbab7849b7e27ba7abfe0440cc`;
- C04 structured coverage checkpoint `8094d4cf340a4fba9b7f851be35cb3569485a895`;
- B baseline durability intake `9939144986f3f5b91747b88edaf4d0219135210f` -> C cherry-pick `89959821`;
- B document-scope follow-up `5fc3ad669fca0f4c97c222c111acf22f36e11aa9` -> C cherry-pick `720039c8`.

Runtime wiring:
- existing Telegram API-watch runner receives
  `createApiWatchProductBaselineRepository(database)` as a read dependency;
- report execution never calls `accept()`;
- acquisition authority, latest observation and product-compatible baseline remain distinct;
- baseline advancement remains a separate explicit acceptance action.

Semantics:
- repeated breaking B remains compared with accepted compatible A;
- repeated observed B does not become product recovery merely because acquisition is unchanged;
- verified return to exact accepted compatible baseline can recover product incidents;
- source transport/authority recovery remains independent;
- missing/unavailable baseline is explicit uncertainty, not implicit acceptance;
- source/document identity is preserved through snapshot and report persistence;
- exact nullable document scope supports multi-document Wildberries sources;
- structured monitoring coverage records tested/unverified targets and never treats source acquisition alone as a product comparison.

C independent validation on the combined tree:
- API-watch + monitoring scheduler + Telegram runner focused suite: 13 files / 224 tests PASS;
- `@product/db typecheck`: PASS;
- `@product/api-watch typecheck`: PASS;
- `@product/monitoring-control typecheck`: PASS;
- `@product/telegram-operator typecheck`: PASS;
- C disposable PostgreSQL, sequential:
  - product baseline 0054: 9/9 PASS;
  - canonical lineage: 7/7 PASS;
  - postgres base: 3/3 PASS;
  - adapter registry: 7/7 PASS;
  - retention upgrade: 10/10 PASS;
  - total 36/36 PASS; supervisor `octoport-test-c-feb49d1e0cbc4d94a3aaa482aad2cac1.service`, exit 0, peak 538 MiB, cleanup verified;
- migration unit suite: 18/18 PASS;
- no live DB migration, no provider calls, no Telegram send.

Boundary:
- migration 0054 is source-only until an explicitly authorized runtime migration;
- no initial product baseline was accepted automatically or manually by this integration;
- no production/live baseline pointer was written;
- first baseline remains a separate operator/compatibility acceptance under MONITORING_REPAIR_ARCHITECTURE;
- H3 legitimate ChatGPT session remains an external live prerequisite and is not substituted by this work.
