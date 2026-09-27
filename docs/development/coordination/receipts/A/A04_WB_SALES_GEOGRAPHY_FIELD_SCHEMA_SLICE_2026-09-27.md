# A04 — WB sales geography field-schema slice — 2026-09-27

Status: **SOURCE GEOGRAPHY PASS / OFFICE-ID JOIN FAIL-CLOSED / FINAL REVENUE NOT SELECTED**

Task: `A04_STD09_WB_SALES_GEOGRAPHY`.
Parent A head: `c036c9deaeea053bbf9f946d766a8895636def44`.
Observed `origin/main`: `24571c392b0c01359887019e6d23f3363d830f69`.

## Scope

STD-09 accepted WB operations remain:
- `statistics_sales`;
- `marketplace_offices`.

The slice answers the source-level question “sales by warehouse/geography” without inventing an office-ID relationship or final accounting revenue.

No runtime, registry, live WB, credential, owner session, AI request, deployment, shared readiness-map or STORE package change was performed.
## Pinned authority

Upstream OpenAPI mirror:
- repository: `eslazarev/wildberries-sdk`;
- commit: `5057bdb9bf16dea24000e3ca79e1934f7761d7fe`;
- reports spec blob: `22ff073c10a3cebe0dc7af647eb2b704fd35857c`;
- items spec blob: `54f6d7828f4188671ef68fde06922e609ef7e7a4`.

The pinned sales model exposes:
- `warehouseName`;
- `warehouseType`;
- `countryName`;
- `oblastOkrugName`;
- `regionName`;
- `finishedPrice`;
- `saleID`.

Provider semantics for `saleID`:
- `S...` — sale;
- `R...` — return to a WB warehouse.

The pinned Office model exposes separate office reference fields including `id`, `name`, `address`, `city`, coordinates, `federalDistrict`, and `selected`.
The sales row exposes `warehouseName`, not an office ID, so this slice does not claim an authoritative sales-row -> office-ID join.
## Enforced semantics

- count only `S...` rows as sale units;
- count `R...` rows separately as return units; never silently net returns into sales;
- duplicate `saleID` is incomplete, not double-counted;
- missing `warehouseName` is incomplete, not “unknown warehouse = zero”;
- use `warehouseName/countryName/oblastOkrugName/regionName` directly from the sales row for geography;
- office-directory name equality is not treated as a guaranteed ID relation;
- preserve operational `finishedPrice` row values, but do not relabel them as final finance revenue;
- no explicit sales-row currency-code field is assumed by this slice;
- warehouse ranking uses sale units descending and warehouse label ascending for ties;
- omission policy remains `MISSING_NOT_ZERO`.
## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-sales-geography-field-schema-slice-v1.json`
SHA-256: `24facc707e63d4e7d48f0083791f7fcd02ea60dd92cbbf347072286648dd9385`.

Validator:
`tests/regression/extension-core/wb-sales-geography-field-schema-slice.mjs`
SHA-256: `7aae8cb7b8726e320b4b97cf5edc18b040e473b36fd3fe5f8ea8de50d7dd4c30`.

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `99bcf7ff578866fb22afcb33fcad3a2b023f9d31e8a82025fa36f25c2d7cf0b1`.

## Verification

Focused validator:
- PASS;
- direct sales geography fields pinned;
- sale/return distinction enforced;
- duplicate sale ID rejected;
- missing warehouse rejected;
- office ID join remains non-authoritative;
- final revenue selected: false.

Business coverage:
- PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 138 WB operation refs;
- 25 deterministic numeric cases;
- accepted STD-09 operation mapping unchanged.

Formatting:
- Prettier PASS;
- `git diff --check` PASS.

No full extension/runtime suite was rerun because this block changes only source fixture/validator/coverage-import evidence.
## Remaining gates

This is SOURCE evidence only. It is not LIVE_WB, LIVE_OWNER, final finance acceptance or installed-store acceptance.

Open:
- live WB values and owner gold-set reconciliation;
- explicit business timezone when different from provider Moscow default;
- currency binding for operational money values;
- final revenue requires finance realization detail semantics;
- authoritative warehouse-to-office ID relation if WB exposes one in a future source.
