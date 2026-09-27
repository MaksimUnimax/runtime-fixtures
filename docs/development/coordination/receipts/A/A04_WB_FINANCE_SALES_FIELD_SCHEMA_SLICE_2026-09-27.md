# A04 — WB finance sales field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / OWNER REVENUE DEFINITION + LIVE VALUES OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head after syncing accepted main: `3ddb77155413ee9fd0b735d100755d72e0a75f1f`.
Observed `origin/main`: `6a0149c958423082a62d5cb84ac757eed2e785a2`.

## Scope

The accepted 45/45 business operation mapping is intentionally unchanged.
This slice narrows financially authoritative WB field, unit, pagination and currency semantics for:
- `STD-01` — yesterday money + ordered units boundary;
- `STD-03` — product ranking by a money metric boundary;
- `CAP-13` — finance/accrual/payout distinction.

It does **not** decide that WB `retailAmount`, `forPay`, operational sale price, order value or buyout value is the owner's business meaning of “выручка”.
No live WB request, marketplace credential, owner session, AI request, deployment or shared readiness TSV mutation was performed.

## Current official WB sources

Checked on 2026-09-27:
- https://dev.wildberries.ru/en/openapi/financial-reports-and-accounting
- https://dev.wildberries.ru/en/release-notes

The current Finance API exposes:
- `POST /api/finance/v1/sales-reports/list` as `finance_sales_reports`;
- `POST /api/finance/v1/sales-reports/detailed` as `finance_sales_detail_period`.

The detailed endpoint accepts Personal or Service Finance tokens, supports explicit selected fields, uses RFC3339 period boundaries in Moscow time (UTC+3), caps one response at 100000 rows, starts pagination at `rrdId=0`, continues from the final returned `rrdId`, and terminates when the provider returns HTTP 204.
The 2026 finance replacement uses camelCase and string-encoded monetary amounts.

Report-list metadata supplies `reportId` and `currency` and keeps `retailAmountSum` distinct from `forPaySum`.
Detailed rows likewise keep `retailAmount` distinct from `forPay`, and expose product/report identifiers such as `nmId`, `vendorCode`, `reportId` and `rrdId`.
Currency is joined from report metadata by `reportId`; this slice does not assume RUB.

## Machine-readable evidence

New fixture:
`tests/regression/extension-core/fixtures/wb-finance-sales-field-schema-slice-v1.json`

SHA-256:
`216163c926246bfff643c4a61f6603b09d1e220b0045efb1252ee53731bc2b77`

New validator:
`tests/regression/extension-core/wb-finance-sales-field-schema-slice.mjs`

SHA-256:
`73120639a74bb9fc40d007653541f5f1356078433efa3c06638cd71aa3a12ce2`

Existing 45/45 validator imports the finance slice:
`tests/regression/extension-core/business-scenario-coverage.mjs`

SHA-256 after the one-line import:
`85ebbb9335fefd2b1724f4b5e255cf8d6908f8bbf0f29af476c24fb75e598895`

The accepted `business-scenario-coverage-v1.json` mapping itself remains unchanged.

## Enforced semantics

- `retailAmount` and `forPay` are distinct provider metrics and cannot be silently substituted.
- Money fixtures must be decimal strings and are summed exactly without binary floating-point.
- A finance result without report currency is `INCOMPLETE`, not implicitly RUB.
- A detail row with the wrong report identity is `INCOMPLETE`.
- Pagination is incomplete until the `rrdId` chain reaches provider HTTP 204.
- Missing finance data remains missing, not zero.
- Product aggregation preserves both money metrics separately.
- The label “revenue/выручка” remains unresolved until the owner/business definition selects the intended meaning and live values are reconciled.

The existing operation map exposes a deliberate completeness boundary:
- `STD-01` currently maps operational orders/sales, not the finance-detail route;
- `STD-03` currently maps operational sales + cards;
- `CAP-13` maps finance balance + report list.
This slice records the financially authoritative field source without silently rewriting those accepted mappings.

## Verification

Targeted exact validator:
- `node tests/regression/extension-core/wb-finance-sales-field-schema-slice.mjs` — PASS.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation references;
- 137 WB operation references;
- 25 deterministic numeric cases;
- accepted readiness semantic projection unchanged.

Full extension regression under the A supervisor:
`python3 tooling/coordination/control.py A heavy --profile browser --timeout-seconds 3600 -- env PATH=/root/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin python3 tooling/checks/extension_core.py --output /tmp/a04-wb-finance-sales-extension-core-20260927-r1`

Result:
- supervisor unit `octoport-test-a-b0e05a37098f42f4aa9789788a708ffd.service` completed successfully;
- `ExecMainStatus=0`;
- 131/131 product regression gates PASS;
- supervisor process group deactivated normally;
- no product/runtime implementation bytes were changed by this slice.

The earlier invocation without mandatory `--output` exited 2 before running the suite and was a command-shape error, not product evidence. The corrected supervised run above is the acceptance run.

## Evidence boundary and remaining gates

This is SOURCE schema/unit evidence plus a clean SOURCE/PACKAGE regression, not LIVE_WB, LIVE_OWNER or final business acceptance.

Still open:
- owner/business definition of “выручка” versus provider retail amount, seller payout, order value or buyout value;
- live WB values and owner gold-set reconciliation;
- explicit review of accepted `STD-01` / `STD-03` operation mapping if final-finance money is required for their business meaning;
- business-period timezone reconciliation when it differs from the Finance API's Moscow-period boundary;
- live complete product ranking / finance reconciliation;
- remaining A04 field/unit/completeness families, including advertising spend/DRR attribution.

Shared readiness TSV ownership remains with C. This receipt is evidence for normal C intake, not a `PASS_FEATURE` claim.
