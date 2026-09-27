# A04 — WB finance reconciliation / deductions field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA PASS / LIVE VALUES + CURRENCY/BUSINESS RECONCILIATION OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `a72e1dc216503cf2db78c7d023fce0f3a56168cf`.
Observed `origin/main`: `61bb49f3553fd217a9a2c8d8ff8d9f92419f0184`.

## Scope

This slice closes the missing `deductions` field/completeness boundary in `CAP-14`.
The accepted WB mapping remains:
- `finance_sales_detail_period`;
- `deductions`.

No live WB request, credential, owner session, AI request, deployment, runtime, contract or shared readiness mutation was performed.

## Provider evidence

Direct Wildberries documentation fetches are not reliably retrievable from Easyscript in this cycle, so field-level verification uses the current generated mirror `eslazarev/wildberries-sdk` at exact commit `5057bdb9bf16dea24000e3ca79e1934f7761d7fe`, whose specs preserve the official WB OpenAPI source.

Pinned specs:
- `specs/12-reports.yaml` blob `22ff073c10a3cebe0dc7af647eb2b704fd35857c`;
- `specs/13-finances.yaml` blob `9b268d4f3edfc5912e3e7c8b9bc571523bd7a377`.

Provider currency policy is pinned separately to the official WB February 2026 release note: monetary values in Analytics/Data reports use the currency of the seller's registration country; `deductions` still does not return a currency-code field.

The reports spec documents `GET /api/analytics/v1/deductions`: optional `dateFrom`, required `dateTo`, optional `sort` (`nmId | dtBonus | bonusSumm`), optional `order` (`desc | asc`), required `limit` up to 1000, optional `offset`, response `data.reports[]` plus `data.total`, and fields including `dtBonus`, `nmId`, `bonusSumm`, `bonusType`, before/after SKU/article fields and photo URLs.

The finances spec documents `POST /api/finance/v1/sales-reports/detailed` rows with their own `currency`, `sellerOperName`, and signed decimal-string money fields including `retailAmount`, `forPay`, `penalty`, `additionalPayment`, and `deduction`.

No source snapshot is treated as live-account proof.

## Enforced semantics

- `bonusSumm` is preserved as the provider deduction amount and its provider sign is not rewritten;
- no unique row key is invented, so rows are not deduplicated by a guessed composite key;
- full-list evidence requires offset progression until collected row count reaches provider `total`;
- the deductions response does not expose a currency-code field, while provider policy defines the money in the seller-registration-country currency;
- an actual store/account currency code must still be bound explicitly before cross-source reconciliation;
- deduction amounts are not netted into finance-detail money until store currency matches explicit finance-detail `currency` and an owner/business reconciliation rule exists;
- missing data stays missing, never zero.

Finance-detail rows preserve their own `currency`, `sellerOperName`, `retailAmount`, `forPay`, `penalty`, `additionalPayment`, and `deduction` values as returned. Their decimal-string signs are not rewritten. A mixed-currency finance-detail set fails closed. The deductions endpoint has seller-registration-country currency semantics but no response currency code, so it remains a separate source family until that store/account currency code is explicitly matched.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-finance-reconciliation-field-schema-slice-v1.json`
SHA-256: `2c46c3d2d1e722f5cb95101cec28aa27c7d99c85e8ca0ae97d2c9b20cb7fe0ad`.

Validator:
`tests/regression/extension-core/wb-finance-reconciliation-field-schema-slice.mjs`
SHA-256: `fb084a5bad5f1a8257f3d2146752c37aa2caeb41415dab8c774c1ce7ad278441`.

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `91533d6df117f4a0c7f0cb7e35c637bf043923c678721445ec841116fc88b4fb`.
## Verification

Focused:
- `node tests/regression/extension-core/wb-finance-reconciliation-field-schema-slice.mjs` — PASS;
- complete two-page offset sequence reaches provider total — PASS;
- incomplete pages fail closed;
- invalid offset sequence fails closed;
- missing deduction amount fails closed;
- provider deduction amount sign is preserved;
- deductions response currency code is absent while seller-registration-country currency policy is pinned;
- finance-detail decimal-string signs are preserved;
- finance-detail currency is required and mixed currency fails closed;
- cross-source deductions/finance netting is explicitly disabled without an authoritative currency/business rule.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 139 WB operation refs;
- 25 deterministic numeric cases;
- readiness semantic projection unchanged.

No full `extension_core` rerun: only fixture/validator/import/receipt bytes change; runtime/package bytes are unchanged, consistent with controller batching guidance.

## Evidence boundary and remaining gates

This is SOURCE field-schema evidence only. It is not LIVE_WB, LIVE_OWNER, installed-store acceptance or final financial reconciliation.

Still open:
- live WB deductions values and owner gold-set reconciliation;
- direct official-portal retrievability from the execution environment;
- explicit store/account currency-code binding for actual deductions-to-finance reconciliation;
- owner/business rule for how deductions affect reconciliation/contribution metrics;
- documented unique row identity if deduplication is later required.

The separate visibility/shadowed source-freshness conflict remains held without runtime mutation and is not resolved by this finance slice.
