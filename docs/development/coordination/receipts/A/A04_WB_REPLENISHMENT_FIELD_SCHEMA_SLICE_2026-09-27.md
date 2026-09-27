# A04 — WB replenishment / days-cover reuse slice — 2026-09-27

Status: **SOURCE SEMANTIC REUSE PASS / LIVE VALUES + ORDER QUANTITY INPUTS OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `7e3ad2f862546f62cf5981e4eba0e4b240069593`.
Observed `origin/main`: `fe31e4ac80d0ffb3b7cc7f25772b2e1d30b4e712`.

## Scope

This slice closes the field/semantic gap for:
- `STD-07` — products nearing stockout, slow movers, and replenishment priority.

It deliberately reuses the already validated CAP-05 WB field schema:
`tests/regression/extension-core/fixtures/wb-turnover-field-schema-slice-v1.json`.

The accepted STD-07 operation map is unchanged:
- `stock_products`;
- `statistics_sales`.

No new provider field interpretation is invented and no runtime/product byte changes are made.
## Reused provider boundaries

From the existing validated turnover slice:
- `stockCount` is current stock units;
- WB `saleRate {days,hours}` and `avgStockTurnover {days,hours}` remain provider metrics and are not renamed into a custom formula;
- preliminary `statistics_sales` sale/return rows require explicit business classification before they become a custom demand denominator;
- custom days cover is only `stock units / explicit comparable average daily demand units`.

## New deterministic business boundaries

- replenishment urgency sorts only finite days-cover values ascending, with deterministic product-ID tie-break;
- zero/unknown demand stays in an explicit unknown bucket, not infinite cover or zero demand;
- a slow-mover label requires an explicit turnover threshold in days;
- exact reorder quantity is not calculated without both lead time and target-stock inputs;
- missing/incomplete provider data remains missing, never zero.

Synthetic evidence proves:
- zero-stock with valid demand ranks as the most urgent finite case;
- unknown demand is separated from the ranking;
- a 45.5-day provider turnover crosses an explicit 30-day slow-mover threshold while 30 days does not;
- missing slow-mover threshold and missing lead-time/target-stock inputs fail closed.
## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-replenishment-field-schema-slice-v1.json`
SHA-256: `850611eb62ac17333730775c00eac5536f09e3d8f51e9c49b60936bc0e7e2e1f`

Validator:
`tests/regression/extension-core/wb-replenishment-field-schema-slice.mjs`
SHA-256: `5c45c412fdb56ba9c404e7aeb5f031607cbfad4f3e21245d7e93c074c02bf1aa`

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `8935645c6d7a1b566657e71d47deed19bbe54bf0b6d202e30fedcebec35ad12a`

## Verification

Targeted:
- `node tests/regression/extension-core/wb-replenishment-field-schema-slice.mjs` — PASS.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon refs;
- 139 WB refs;
- 25 deterministic numeric cases;
- readiness semantic projection unchanged.

Prettier applied to the new fixture/validator; `git diff --check` PASS.
Per controller policy this fixture-only reuse does not repeat the 131-gate extension suite because runtime bytes are unchanged.
## Remaining gates

This is SOURCE semantic evidence only, not LIVE_WB, LIVE_OWNER, or final business acceptance.

Still open:
- live WB values and owner gold-set reconciliation;
- sale/return classification for the chosen demand denominator;
- owner/business threshold for “лежит слишком долго”;
- lead time and target stock for exact order quantity;
- full provider pagination/completeness on real account data.

The absence of those inputs blocks only the precise business claim/order quantity, not continued A04 field-schema work.
