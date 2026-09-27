# A04 — WB turnover / days-cover field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / LIVE VALUES AND CUSTOM DEMAND DEFINITION OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `4e0c6a5c14d09a2d339e5071c0b3578161c9f725`.
Observed current `origin/main`: `84c3ba00a2c7f60f17bda414e0292f285cfd734e`.

## Scope

The accepted 45/45 operation mapping remains unchanged.
This slice adds field/unit boundaries for:
- `CAP-05` — stock, turnover and calculated days-cover.

No live WB request, marketplace credential, owner session, AI request, deployment, shared readiness mutation or write operation was performed.

## Current official WB sources

Checked on 2026-09-27:
- https://dev.wildberries.ru/en/openapi/analytics
- https://dev.wildberries.ru/en/openapi/reports

`POST /api/v2/stocks-report/products/products` forms inventory analytics by product.
WB states that inventory in these stock-report responses is for the current day and this product report updates once an hour.
The request requires `currentPeriod` and `stockType`; stock type distinguishes WB warehouses, marketplace/seller warehouses or the combined provider scope.

The response keeps product-level metrics explicit, including:
- `stockCount` and `stockSum`;
- `ordersCount`, `ordersSum`, `avgOrders`;
- `buyoutCount`, `buyoutSum`;
- `saleRate {days,hours}`;
- `avgStockTurnover {days,hours}`;
- `toClientCount`, `fromClientCount`;
- provider `availability`.
`GET /api/v1/supplier/sales` is a separate preliminary operational stream.
WB documents one row as one sale or return item, with data updated every 30 minutes and storage guaranteed for no more than 90 days.
Therefore those rows are not silently converted into a net-demand denominator without an explicit sale-versus-return/business rule.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-turnover-field-schema-slice-v1.json`

Validator:
`tests/regression/extension-core/wb-turnover-field-schema-slice.mjs`

The accepted `business-scenario-coverage-v1.json` mapping remains byte-unchanged.

## Enforced semantics

- WB `saleRate` is retained as the provider's days+hours duration and is not recomputed or renamed.
- WB `avgStockTurnover` remains a distinct provider days+hours duration.
- Provider turnover is not declared equal to a custom days-cover formula.
- Custom days-cover is `stock units / explicit comparable average daily demand units` only after the demand denominator is defined.
- zero or unknown demand returns `null`, never infinity;
- negative demand is `INCOMPLETE`;
- missing stock is `INCOMPLETE`, never zero;
- preliminary sale/return rows are not automatically net demand;
- `stockType` must be explicit for comparable warehouse scope.
## Verification

Targeted:
- `node tests/regression/extension-core/wb-turnover-field-schema-slice.mjs` — PASS.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 137 WB operation refs;
- 25 deterministic numeric cases;
- accepted readiness semantic projection unchanged.

Full extension-core source/package regression on this extension tree:
- `python3 tooling/coordination/control.py A heavy --profile browser --timeout-seconds 3600 -- env PATH=/root/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin python3 tooling/checks/extension_core.py --output /tmp/a04-wb-turnover-extension-core-20260927-r2` — PASS;
- resource job `16615ab7b0f34863a2b3e69172989adf`, exit 0, cleanup verified, OOM kills 0;
- `131/131` gates PASS across source and extracted package.

## Evidence boundary and remaining gates

This is SOURCE field/schema evidence. It is not LIVE_WB, LIVE_OWNER, store-installed acceptance or final business acceptance.

Still open:
- live WB values and owner gold-set reconciliation;
- exact business definition of the demand denominator for custom days-cover;
- sale-versus-return classification before preliminary sales rows can feed that denominator;
- complete full-catalog pagination proof for `stock_products`;
- lead time and target stock remain external business inputs for exact replenishment quantity.

Next independent A04 work remains uncovered field/unit/completeness families; no accepted operation map is changed without a concrete defect.
