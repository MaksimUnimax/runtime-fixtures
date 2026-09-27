# A04 — WB paid storage / platform-contribution source boundary — 2026-09-27

Status: **SOURCE SCHEMA PASS / PLATFORM CONTRIBUTION REMAINS FAIL-CLOSED**

Task: `A04_CAP24_WB_PAID_STORAGE_UNIT_ECONOMICS`.
Parent A head: `315b2a5e462e74f32c1fda47f341949cc8c4ce62`.
Observed `origin/main`: `24571c392b0c01359887019e6d23f3363d830f69`.

## Scope

CAP-24 accepted WB operations are preserved:
- `finance_sales_detail_period`;
- `deductions`;
- `paid_storage_create`;
- `paid_storage_status`;
- `paid_storage_download`;
- `promo_spend_history`;
- `statistics_sales`.

This slice does not add runtime behavior or claim a final contribution/profit formula. It pins the paid-storage report lifecycle and proves where cross-source arithmetic must remain incomplete until the owner/business layer supplies explicit component and currency policy.

No live WB request, credential, owner session, AI request, deployment, frozen registry edit, runtime change, or shared readiness-map change was performed.
## Pinned provider authority

Current upstream OpenAPI mirror used by the existing A04 source program:
- repository: `eslazarev/wildberries-sdk`;
- commit: `5057bdb9bf16dea24000e3ca79e1934f7761d7fe`;
- `specs/12-reports.yaml` blob: `22ff073c10a3cebe0dc7af647eb2b704fd35857c`;
- `specs/13-finances.yaml` blob: `9b268d4f3edfc5912e3e7c8b9bc571523bd7a377`;
- `specs/08-promotion.yaml` blob: `30ae48c8d1b67944b34cf51ac896ae4c2b2fa0d9`.

The pinned reports schema independently confirms:
- paid-storage creation through `GET /api/v1/paid_storage`;
- report window up to 8 days;
- task lifecycle with `new`, `processing`, `done`, `purged`, `canceled`;
- download through the task ID;
- HTTP 204 as explicit no-data;
- row fields including `warehousePrice`, `barcodesCount`, `originalDate`, `loyaltyDiscount`.

The paid-storage row has no explicit currency-code field in this source. This receipt therefore does not inherit a currency assumption from an unrelated report family.
## Enforced semantics

- create task ID must equal status/download task ID;
- only `done` is download-ready;
- `new` / `processing` are incomplete, never zero storage;
- `purged` / `canceled` are terminal unavailable, never zero storage;
- `done + HTTP 204` is a complete empty dataset;
- recalculation rows preserve both `date` and `originalDate`;
- rows are not deduplicated without a documented unique row key;
- provider `warehousePrice` sign is preserved;
- exact money aggregation is not performed from binary JSON numbers until an explicit decimal-normalization policy exists;
- paid-storage and promotion-spend values require an explicit common currency binding before cross-source arithmetic;
- `statistics_sales` remains preliminary operational evidence, not selected final finance revenue;
- platform fees/logistics are not derived by subtraction or implicit field bucketing;
- `platform contribution` remains incomplete until revenue, fee/logistics component policy and a common currency binding are explicit;
- full net profit remains outside this slice because CAP-24 still carries deferred COGS/tax/external-cost dependencies.
## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-paid-storage-contribution-field-schema-slice-v1.json`
SHA-256: `5dfb8b2c271fa0192695d8df94d4e198d00f9397a6bda30f0a84beeb8e8cf308`.

Validator:
`tests/regression/extension-core/wb-paid-storage-contribution-field-schema-slice.mjs`
SHA-256: `a7e8b539ee8a3721f936c363d8671d01b2ea6369dea9ac9d0d4cf1bd8083674a`.

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `a77bd4878b26389712bedf5b331fdfc1350814880f7f7c2712117917eba75527`.

## Verification

Focused:
- `node tests/regression/extension-core/wb-paid-storage-contribution-field-schema-slice.mjs` — PASS;
- lifecycle `CREATE_STATUS_DOWNLOAD`;
- max period 8 days;
- explicit 204 empty semantics;
- recalculation rows preserved;
- no paid-storage currency field assumed;
- exact storage aggregate requires policy;
- platform contribution remains fail-closed with reason `COMPONENT_POLICY_AND_COMMON_CURRENCY_BINDING_OPEN`.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 138 WB operation refs;
- 25 deterministic numeric cases;
- accepted CAP-24 operation mapping unchanged.

Formatting:
- Prettier PASS;
- `git diff --check` PASS.

No full extension/runtime suite was rerun because this block changes only source fixtures/validator/coverage import and does not alter extension/runtime/package bytes.
## Remaining gates

This is SOURCE field/unit/completeness evidence only. It is not LIVE_WB, LIVE_OWNER, installed-store acceptance, or a final accounting model.

Open:
- explicit CAP-24 business component policy for revenue/platform-fee/logistics buckets;
- explicit store/account currency binding shared across finance, paid storage and promotion spend;
- exact decimal normalization for paid-storage JSON-number money before arithmetic;
- live paid-storage task lifecycle and owner gold-set reconciliation;
- live cross-source period alignment;
- whether CAP-24 eventually needs `finance_sales_reports` metadata for explicit currency reconciliation;
- COGS, tax and external costs remain deferred dependencies for full profit.
