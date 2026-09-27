# A04 — WB supply acceptance/detail field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA + OPERATION-MAP CORRECTION PASS / LIVE VALUES OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `55fb2a40ffa1e6336bc30d29f47da7ed552b8c59`.
Observed `origin/main`: `fe31e4ac80d0ffb3b7cc7f25772b2e1d30b4e712`.

## Scope and proven mapping defect

CAP-08 requires `accepted_units:count` and already referenced `acceptance_report_create`, but the accepted row stopped at task creation.
Current WB OpenAPI defines a three-step read-derived lifecycle:
1. `GET /api/v1/acceptance_report` -> `taskId`;
2. `GET /api/v1/acceptance_report/tasks/{task_id}/status` -> `new|processing|done|purged|canceled`;
3. `GET /api/v1/acceptance_report/tasks/{task_id}/download` -> rows containing `incomeId`, `nmID`, `count`.

The existing STD-13 row already uses all three operations for the same `supply_acceptance` metric. CAP-08 therefore had a concrete completeness defect, not a product redesign.
Its WB mapping is corrected by adding `acceptance_report_status` and `acceptance_report_download`, and continuation becomes `EXPLICIT_REPORT_LIFECYCLE`.
## Current provider schema evidence

Observed at `2026-09-27T07:59:10Z`.
Direct retrieval of the official WB raw YAML for the relevant specs returned HTTP 498 on this server, so the field proof uses the current machine-readable `eslazarev/wildberries-sdk` mirror. Its `generation.yaml` blob `43ac4287e0afe98f273fd00f1a89bdf6c6229565` points those files directly to the official `dev.wildberries.ru/api/swagger/yaml/ru/*.yaml?region=ru` upstream.

Pinned current mirror inputs:
- `03-orders-fbs.yaml`: blob `7965dedd6851edf0e37b3109149d9d323e32e710`, SHA-256 `9b86cf918ef7456644319577ba303acf8208e8c53d36d3001d402a5acf7103df`;
- `07-orders-fbw.yaml`: blob `7ae91e4101c9a2c0f74d2c34c6dbf743d8ef5f45`, SHA-256 `486d5d77b4987ceaab96b9a378fd489504c8ae8eb9599b3067b02e7b8ef6bada`;
- `12-reports.yaml`: blob `22ff073c10a3cebe0dc7af647eb2b704fd35857c`, SHA-256 `f7eb3bd284905044142f9b53bd160f3c6993b1773330fafcdb03bca00985311b`.

Anchored lifecycle proof in `12-reports.yaml`:
- line 1144: `/api/v1/acceptance_report`; its description says it creates a report-generation task, and `CreateTaskResponse` at lines 3104–3114 contains only `data.taskId`;
- line 1213: `/api/v1/acceptance_report/tasks/{task_id}/status`; `GetTasksResponse` at lines 3084–3103 defines `new|processing|done|purged|canceled`;
- line 1287: `/api/v1/acceptance_report/tasks/{task_id}/download`; its 200 response contains report rows where `count` is item quantity, plus `incomeId`, `nmID`, `shkCreateDate`, and `total`; 204 means no data.

Other anchored provider boundaries:
- `07-orders-fbw.yaml` lines 335/415 and schemas 1684/1594 prove FBW detail/goods `acceptedQuantity` and the goods limit 1..1000;
- `03-orders-fbs.yaml` lines 2809/2958 and schema 5421 prove FBS supply detail/order membership; `done` is a closed flag and `orderIds` are membership IDs, not accepted units.

Therefore the CAP-08 mapping defect is concrete: task creation alone cannot yield `accepted_units:count`; explicit status and download reads are required. These mirror observations are not relabeled as a successful live WB-page fetch.

No live WB call, credential, owner session, AI call, deployment or shared readiness TSV mutation was performed.
## Machine-readable evidence

Corrected mapping fixture:
`tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json`
SHA-256: `6cabdbbb7356b62cab64c0fb905cae8abf24966965d543dd3d14468f05b4dad8`

New schema fixture:
`tests/regression/extension-core/fixtures/wb-supply-acceptance-field-schema-slice-v1.json`
SHA-256: `9c5817cea11aafc6d7c8251429ea01f00a7baf8b90c2aab2709d7ddd3ebddeb1`

Validator:
`tests/regression/extension-core/wb-supply-acceptance-field-schema-slice.mjs`
SHA-256: `e6ca2add10364f76c960eafa20598192b4df2784656099e07b7fd28a86b47ea4`

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `29eac49b85739e6a6fc97ca40f69624a53df9eb3a75e8ec2032831a9d6f73f5c`

## Enforced semantics

- FBW accepted, declared, ready-for-sale and unloading quantities stay distinct.
- FBS `done` means supply closed; it is not an accepted-unit count.
- FBS `orderIds` prove membership only.
- Acceptance report must reach `done` before download rows are used.
- `purged`, `canceled`, or not-yet-`done` remain `INCOMPLETE`, never zero.
- Download `count` is summed only after a completed report lifecycle.
## Verification

Targeted:
- `node tests/regression/extension-core/wb-supply-acceptance-field-schema-slice.mjs` — PASS.

Business coverage after the justified mapping correction:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 139 WB operation refs (previously 137; exactly two lifecycle reads added to CAP-08);
- 25 deterministic numeric cases;
- readiness semantic projection unchanged.

Formatting:
- Prettier applied to changed JSON/MJS;
- `git diff --check` PASS.

No additional 131-gate extension run was launched: this slice changes only test/evidence mapping files, not extension runtime bytes, consistent with controller notice `STREAMS-AUDIT-20260927-0701`.

## Remaining gates

This is SOURCE schema/mapping evidence, not LIVE_WB or final business acceptance.
Still open:
- live WB supply/report values and owner gold-set reconciliation;
- report latency and terminal behavior on a real account;
- reconciliation when direct FBW `acceptedQuantity` differs from report `count` because of period/grain;
- explicit business interpretation of HTTP 204 in requested-period context.
