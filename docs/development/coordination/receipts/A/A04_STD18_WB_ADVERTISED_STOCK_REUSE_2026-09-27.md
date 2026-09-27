# A04 — STD-18 WB active advertising + current stock reuse — 2026-09-27

Status: **SOURCE MAPPING CORRECTION PASS / LOW-STOCK BUSINESS RULE + LIVE VALUES OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `261969e9348e99d2d8cbb6303545fdc71925bd64`.
Observed `origin/main`: `0b9648bd0bb14d1af6a2916f6fbba16e37b887a0`.

## Scope

Readiness row `STD-18` asks which products are currently advertised while stock is low or absent.

The previous accepted WB operation set was:
- `promo_nms`;
- `promo_campaigns`;
- `stock_products`.

Current provider authority shows that `promo_nms` means **cards eligible to be added to a campaign**, not current campaign membership. The accepted mapping is therefore corrected to:
- `promo_campaigns`;
- `stock_products`.

`promo_nms` stays in the product registry as a valid read-only eligibility operation; only its incorrect use as an `advertised:boolean` source is removed.

No runtime, frozen donor, live WB request, credential, owner session, deployment or shared readiness TSV mutation was performed.
## Provider authority

Pinned current mirror:
- repository: `eslazarev/wildberries-sdk`;
- commit: `5057bdb9bf16dea24000e3ca79e1934f7761d7fe`;
- path: `specs/08-promotion.yaml`;
- blob SHA: `30ae48c8d1b67944b34cf51ac896ae4c2b2fa0d9`.

`POST /adv/v2/supplier/nms` is documented as returning product cards that **can be added** to an advertising campaign. Response `nm` is a product ID but does not indicate that the product belongs to any current campaign.

`GET /api/advert/v2/adverts` returns campaign rows containing:
- campaign `id`;
- provider `status`;
- `nm_settings[].nm_id` — actual products in that campaign;
- campaign `currency`.

Existing CAP-17 evidence pins promotion status `9` as `ACTIVE`; status `11` is paused and `7` is finished.

Existing stock evidence pins `stock_products` at product grain `nmID`, with current-day `metrics.stockCount`.

## Enforced semantics

- `promo_nms` eligibility is never interpreted as current advertising membership;
- `advertised=true` only when `nm_settings[].nm_id` belongs to at least one campaign with promotion status `9`;
- membership in paused/finished campaigns alone is not “currently advertised”;
- duplicate active memberships are deduplicated by `nmID` while preserving all active campaign IDs;
- current stock joins by exact `nmID`;
- stock pagination must be complete for the advertised product set;
- duplicate/missing current-stock rows fail closed;
- explicit `stockCount=0` means no current stock units;
- positive stock is not labelled “low” without an owner/business threshold or days-cover rule;
- missing values remain missing, never zero.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-advertised-stock-reuse-v1.json`
SHA-256: `6af327d0dd08adb801198398f46f40737afee240b64b5e6960def6d6c6d7df23`.

Validator:
`tests/regression/extension-core/wb-advertised-stock-reuse.mjs`
SHA-256: `1d130a4d5a39a23eae52cc717bcc2f1086c1c373a33730d309ba57d2561557e0`.
Coverage manifest:
`tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json`
SHA-256: `7ee7cbc4a0cbb157527bd06c8dc63000d091447695878c532794c538e81ac9a3`.

Coverage validator/importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `098874564d09da6a930ac6aeb9476d8d1a535c71be3d2b6cb504a82da42bcf19`.

## Verification

Focused:
- `node tests/regression/extension-core/wb-advertised-stock-reuse.mjs` — PASS;
- accepted mapping before: `promo_nms + promo_campaigns + stock_products`;
- accepted mapping after: `promo_campaigns + stock_products`;
- eligibility-only card does not produce an advertised signal;
- two active campaigns for the same product retain both campaign IDs;
- paused and finished memberships remain inactive-only;
- explicit zero stock is preserved and flagged as out-of-stock;
- missing stock, duplicate stock and incomplete stock pagination fail closed;
- low-stock threshold remains unresolved instead of guessed.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 138 WB operation refs after removing the false `promo_nms` STD-18 use;
- 25 deterministic numeric cases;
- readiness semantic projection SHA remains `4013ffaf678697ed1ed940c89fa3cd7cb0dbaf08e947597e02f071d8eff04c4a`.

No full `extension_core` rerun: mapping fixture/validator/import/receipt only; runtime/package bytes are unchanged.
## Evidence boundary and remaining gates

This is SOURCE mapping/field-schema evidence, not LIVE_WB, LIVE_OWNER, installed-store or final STD-18 business acceptance.

Open:
- live active-campaign/current-stock values and owner gold-set reconciliation;
- owner/business low-stock threshold or days-cover policy for “заканчиваются”;
- real stock pagination completeness for the active advertised set;
- business decision whether paused campaigns should be shown as separate attention context.

This correction does not resolve the separate visibility/shadowed source-freshness HOLD or the CAP-18 media identity/currency review.
