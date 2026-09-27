# A04 — WB cross-source product/period join — 2026-09-27

Status: **SOURCE CROSS-SOURCE JOIN PASS / AD-SPEND PRODUCT ALLOCATION + LIVE VALUES OPEN**

Task: `A04_CAP19_WB_CROSS_SOURCE_JOIN`.
Parent A head before the slice: `7e4938f6eadf959caabe143cf936f01a89c166b2`.
Verified code/test commit: `8de7cdec903968394ab18e377bcbd6757b59d569`.
Observed `origin/main`: `022dfca0adee97767d3c0552a3d17aab78c401a5`.

## Scope

CAP-19 requires at least two different sources and explicitly allows either
advertising × stock or sales × finance. This slice chooses the source-safe
`statistics_sales × finance_sales_detail_period` path for the deterministic
product/period join.

The accepted WB operation mapping remains unchanged:
- `promo_spend_history`;
- `stock_products`;
- `statistics_sales`;
- `finance_sales_detail_period`.

No runtime/provider code, live WB request, credential, owner session, AI request,
deployment, STORE package or shared readiness TSV was changed.

## Source boundary

The pinned upstream mirror remains
`eslazarev/wildberries-sdk@5057bdb9bf16dea24000e3ca79e1934f7761d7fe`.

The pinned `SalesItem.ts` model exposes `nmId`, `saleID`, `date` and the
operational money fields. Existing A04 finance evidence exposes
`finance_sales_detail_period` rows with `rrdId`, `reportId`, `nmId`, separate
`retailAmount`/`forPay`, explicit pagination to HTTP 204 and report-currency
binding by `reportId`.

The live WB documentation endpoint was not promoted to a fresh-source claim from
this server because the direct refetch boundary remained unavailable (HTTP 498).
This receipt therefore stays pinned-source evidence only.

## Fail-closed semantics

The deterministic sales × finance join requires:
- one explicit comparable period and timezone policy;
- complete reads from both sources;
- unique `saleID` on operational sales rows;
- unique `rrdId` on finance detail rows;
- exact product identity by `nmId` on both sides;
- equal product sets for a complete joined result;
- finance currency from report metadata;
- `retailAmount` and `forPay` remain separate;
- missing products/data are `INCOMPLETE`, never zero.

The alternate advertising × stock path is deliberately not product-allocated:
`promo_spend_history` exposes actual cost by `advertId`/`updSum`, but no product
ID and no currency field. Full campaign spend must not be copied to every product.
Until a documented allocation or product-grain actual-spend source exists, that
branch returns `CAMPAIGN_SPEND_PRODUCT_ALLOCATION_UNDEFINED`.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-cross-source-join-field-schema-slice-v1.json`
SHA-256: `be78de5a8ffc8548d1144466bcd2fe00d9795b773c8a7acfe767fa7e91eb3fb5`.

Validator:
`tests/regression/extension-core/wb-cross-source-join-field-schema-slice.mjs`
SHA-256: `78ce547f36ecff93b359632292d652e6b75e9cde148d7c7e65fb718e0be9c468`.

Numeric fixtures after adding the missing executable `cross_source_join` cases:
`tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json`
SHA-256: `ccc0b41c433435800cd6e3c7f7c4a4c81f2ebd60db487edad2589568203878cf`.

Aggregate validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `57960f4bea94d4adf1c25c45981505a903964dcf92155b4334be8048264fa231`.

## Verification

With Node `v24.20.0`:
- `node tests/regression/extension-core/wb-cross-source-join-field-schema-slice.mjs` — PASS;
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- aggregate: 45/45 scenarios, 101 Ozon operation refs, 138 WB operation refs,
  29 deterministic numeric cases;
- `cross_source_join` covers complete join, duplicate-row rejection and missing
  product-set rejection;
- Prettier write/check boundary completed on the four changed fixture/validator files;
- `git diff --check` — PASS.

A full extension/browser/package suite was not rerun because this slice changes only
source evidence/tests and no extension/runtime bytes.

## Remaining gates

Open and not relabelled:
- live WB sales/finance values and owner gold-set reconciliation;
- business period/timezone policy when it differs from provider Moscow semantics;
- owner/business definition of final revenue versus provider `retailAmount`/`forPay`;
- product-grain advertising-spend allocation/source for advertising × stock;
- promotion-spend currency binding.

This receipt is SOURCE evidence only. It is not LIVE_WB, LIVE_OWNER,
installed-store, store publication or production acceptance.

