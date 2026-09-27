# A04 — WB promotion calendar field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA PASS / LIVE VALUES + AUTO-PROMOTION PRODUCT SOURCE OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `6c479174f3e809dcb3794694ba8de08cf787a4b6`.
Observed `origin/main`: `61bb49f3553fd217a9a2c8d8ff8d9f92419f0184`.

## Scope

This slice covers `CAP-11` — promotions participation and provider price fields.

Accepted WB operation mapping stays unchanged:
- `calendar_promotions`;
- `calendar_promotion_details`;
- `calendar_promotion_nomenclatures`.

No live WB request, credential, owner session, AI request, deployment, runtime, contract or shared readiness mutation was performed.
## Current official WB source

Checked on 2026-09-27:
`https://dev.wildberries.ru/en/docs/openapi/promotion`.

The Promotions Calendar requires a Prices and Discounts token.

Current documentation states:
- promotions list: required `startDateTime`, `endDateTime`, `allPromo`; offset/limit with limit 1..1000;
- `allPromo=false` means promotions available for participation, while `true` means all promotions;
- details: required unique `promotionIDs`, 1..100 IDs;
- nomenclatures: required `promotionID` and `inAction`; offset/limit with limit 1..1000;
- nomenclatures is not applicable to auto promotions;
- nomenclature rows expose `id`, `inAction`, `price`, `currencyCode`, `planPrice`, `discount`, `planDiscount`.

The provider's promotion-list availability is not treated as proof that a specific product participates.
## Enforced semantics

- product participation uses nomenclature `inAction:boolean`;
- promotion availability and product participation stay distinct;
- auto-promotion nomenclature lookup is `INCOMPLETE`, not silently `false`;
- `price` and `planPrice` remain distinct provider fields;
- `discount` and `planDiscount` remain distinct provider percent fields;
- currency is required from `currencyCode`; RUB is not assumed;
- incomplete offset pagination cannot be called a complete product list;
- missing values remain missing, not zero.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-promotion-calendar-field-schema-slice-v1.json`
SHA-256: `870e7af4d9a3a3b4610b80cd22306c2a7947951d9861fd89d4cac94494d7e72a`.

Validator:
`tests/regression/extension-core/wb-promotion-calendar-field-schema-slice.mjs`
SHA-256: `b6f4a9eff8ac65c4baad8df3def8677edb3b7ce504dbd1fc41dade66ea26061f`.

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `3ada7499268d0719c7c1dc5db2a0526747d006620ff1786cd9245e63bb0899e8`.
## Verification

Focused:
- `node tests/regression/extension-core/wb-promotion-calendar-field-schema-slice.mjs` — PASS;
- regular promotion participation/price projection PASS;
- auto promotion -> explicit `INCOMPLETE`;
- incomplete nomenclature pagination -> `INCOMPLETE`;
- missing currency -> `INCOMPLETE`.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 139 WB operation refs;
- 25 deterministic numeric cases;
- readiness semantic projection unchanged.

Prettier PASS and `git diff --check` PASS.
No full `extension_core` rerun: only source fixture/validator/import evidence changed and runtime/package bytes are unchanged, consistent with controller batching policy.
## Evidence boundary and remaining gates

This is SOURCE field-schema evidence only. It is not LIVE_WB, LIVE_OWNER, store-installed acceptance or final business acceptance.

Still open:
- live WB promotion/product values and owner gold-set reconciliation;
- real offset-pagination terminal behavior;
- provider-supported product-participation source for auto promotions when needed;
- owner/business interpretation of planned versus current promotion price/discount.

Continue the next uncovered A04 family; do not convert provider promotion fields into a recommendation or business verdict.
