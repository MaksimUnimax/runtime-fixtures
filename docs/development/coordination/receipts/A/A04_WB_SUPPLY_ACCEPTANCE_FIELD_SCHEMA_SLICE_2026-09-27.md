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

Machine-readable source checked at mirror commit:
`eslazarev/wildberries-sdk@5057bdb9bf16dea24000e3ca79e1934f7761d7fe`.

That repository's `generation.yaml` points the relevant specs directly to current Wildberries upstream YAML endpoints under `https://dev.wildberries.ru/api/swagger/yaml/ru/`.

Verified provider boundaries:
- FBW supply details expose `statusID` 1..6 plus `quantity`, `readyForSaleQuantity`, `acceptedQuantity`, `unloadingQuantity`, `depersonalizedQuantity`, and `discrepancies`;
- FBW supply goods expose per-product `quantity`, `acceptedQuantity`, `readyForSaleQuantity`, `unloadingQuantity` with offset/limit (limit 1..1000);
- FBS supply detail exposes `done` and lifecycle timestamps but no accepted-unit count;
- FBS supply order IDs expose supply membership, not accepted units;
- acceptance-report creation supports at most 31 days;
- report download row `count` is quantity of goods in pieces and is only consumed after task status `done`.

No live WB call, credential, owner session, AI call, deployment or shared readiness TSV mutation was performed.
## Machine-readable evidence

Corrected mapping fixture:
`tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json`
SHA-256: `6cabdbbb7356b62cab64c0fb905cae8abf24966965d543dd3d14468f05b4dad8`

New schema fixture:
`tests/regression/extension-core/fixtures/wb-supply-acceptance-field-schema-slice-v1.json`
SHA-256: `b5d39c3753c7e39d1fbf8b061706b6e181fcbac39a898c686f903e4517cc5b5b`

Validator:
`tests/regression/extension-core/wb-supply-acceptance-field-schema-slice.mjs`
SHA-256: `bb2e27c5c937f8ab260c0db2adfc4a60e2aa64f255e014549b56af940b4a024e`

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
