# A04 — WB replenishment priority business-boundary slice — 2026-09-27

Status: **SOURCE POLICY/SCHEMA REUSE PASS / LIVE VALUES + BUSINESS INPUTS OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `7e3ad2f862546f62cf5981e4eba0e4b240069593`.
Observed `origin/main`: `fe31e4ac80d0ffb3b7cc7f25772b2e1d30b4e712`.

## Scope

Readiness row `STD-07` asks which products will run out soon, which move too slowly, and what should be replenished first.
Its WB family is stock + sales + turnover, and its explicit boundary says demand period/days-cover formula must be explicit while lead time/target stock are owner inputs only for exact ordering.

This slice therefore reuses the already validated CAP-05 turnover field-schema:
`tests/regression/extension-core/fixtures/wb-turnover-field-schema-slice-v1.json`.

No accepted operation mapping changes:
- `stock_products`;
- `statistics_sales`.

No new provider field semantics are invented.
## Enforced business boundary

- finite days-cover may rank replenishment urgency ascending, with stable product-ID tie-break;
- zero or unknown demand stays unknown and is not converted to infinite cover;
- negative demand is `INCOMPLETE`;
- invalid/negative stock is `INCOMPLETE`, not “unknown demand” or zero;
- provider `avgStockTurnover` remains a separate duration signal;
- “slow mover” requires an explicit business threshold in days;
- exact replenishment quantity requires lead time, target stock **and an accepted business formula**;
- even when lead-time/target-stock values are present, this slice does not invent that formula.

The earlier draft contained an unaccepted arithmetic formula for exact order quantity. It was removed before commit and never became product/runtime behavior.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-replenishment-field-schema-slice-v1.json`
SHA-256: `e7ba078192d952ad24327678aab26785e8220c242f0f938c6965e8677eb2ee60`.

Validator:
`tests/regression/extension-core/wb-replenishment-field-schema-slice.mjs`
SHA-256: `71c2079fe0184036aadd20b820f7120d0816014e36041273e8c719d027d711a9`.
Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `8935645c6d7a1b566657e71d47deed19bbe54bf0b6d202e30fedcebec35ad12a`.

Reused turnover fixture SHA-256:
`b27807a810ed182133e588c7651264daaf5ad54ba7bb70117fe3f275dcabee9d`.

## Verification

Focused:
- `node tests/regression/extension-core/wb-replenishment-field-schema-slice.mjs` — PASS;
- urgency ordering, unknown-demand separation, slow-mover threshold requirement;
- invalid stock rejection;
- negative-demand rejection;
- exact order missing inputs rejection;
- exact order with inputs but without accepted formula remains `INCOMPLETE`.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 139 WB operation refs;
- 25 deterministic numeric cases;
- readiness semantic projection unchanged.

`git diff --check` PASS.
No additional full `extension_core` run: this slice changes only test/evidence business-boundary files and reuses unchanged runtime/package evidence per controller policy.
## Remaining gates

This is SOURCE policy/schema-reuse evidence only. It is not LIVE_WB or owner business acceptance.

Still open:
- real WB values and owner gold-set reconciliation;
- sale-versus-return classification before operational rows become a custom demand denominator;
- owner/business slow-mover threshold;
- lead time and target-stock inputs;
- accepted business formula for exact replenishment quantity;
- real-account stock pagination completeness.

No marketplace credential, owner session, deployment, production mutation or live provider request was used.
