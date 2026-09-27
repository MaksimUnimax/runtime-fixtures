# A04 — WB finance balance field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA PASS / LIVE VALUES + BUSINESS LABELING OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `6dad8732a78d191efe65f9563272804cb7415326`.
Observed `origin/main`: `61bb49f3553fd217a9a2c8d8ff8d9f92419f0184`.

## Scope

This slice closes the missing `finance_balance` field boundary inside `CAP-13`.
The accepted WB mapping remains:
- `finance_balance`;
- `finance_sales_reports`.

No live WB request, credential, owner session, AI request, deployment, runtime, contract or shared readiness mutation was performed.

## Current official WB source

Checked on 2026-09-27:
`https://dev.wildberries.ru/en/openapi/financial-reports-and-accounting`.

The current balance method is `GET /api/v1/account/balance` and returns:
- `currency`;
- `current`;
- `for_withdraw`.
The method is a current account snapshot with no request period.
It is distinct from period/report totals in `finance_sales_reports`, including `retailAmountSum` and `forPaySum`.

No field is renamed to revenue or profit by this slice.

## Enforced semantics

- `current` and `for_withdraw` remain distinct provider balance fields;
- the balance snapshot is not a period sales-report total;
- provider currency is required and RUB is not assumed;
- missing amounts remain missing, not zero;
- provider numeric sign is preserved; negative `current` is not rejected or reinterpreted;
- profit is not derived from these two balance fields;
- later arithmetic requires an explicit precision policy rather than silently assuming binary-float finance math.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-finance-balance-field-schema-slice-v1.json`
SHA-256: `3f6f0a4e6d6e511f100396d9a0258fee87518527021812e80693ae8b16c9153e`.

Validator:
`tests/regression/extension-core/wb-finance-balance-field-schema-slice.mjs`
SHA-256: `1aad23a5c7650db88c1acb8c2e0ce3b58a6ed81fd4dc9830d361b6415bb8e98e`.

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `6d2de3b0eba07e09f82787e0109c4724cbc47b7a21bdd12f2fb06a568ffa1a61`.
Reused finance schema:
`tests/regression/extension-core/fixtures/wb-finance-sales-field-schema-slice-v1.json`.

## Verification

Focused:
- `node tests/regression/extension-core/wb-finance-balance-field-schema-slice.mjs` — PASS;
- current/withdraw distinction PASS;
- negative current balance preserved PASS;
- missing currency/amount fail closed;
- non-numeric provider amount fails closed.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 139 WB operation refs;
- 25 deterministic numeric cases;
- readiness semantic projection unchanged.

No full `extension_core` rerun: this slice changes fixture/validator/import/receipt only; runtime/package bytes are unchanged, consistent with controller batching guidance.

## Evidence boundary and remaining gates

This is SOURCE field-schema evidence only. It is not LIVE_WB, LIVE_OWNER, store-installed acceptance or final business acceptance.

Still open:
- live WB balance values and owner gold-set reconciliation;
- owner/business naming for balance versus payout, revenue and profit;
- reconciliation of current account balance with period sales-report totals;
- precision policy if later calculations use provider numeric balance fields.
