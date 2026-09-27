# A04 — WB advertising statistics grain field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA PASS / MEDIA CAMPAIGN-JOIN + CURRENCY HOLD**

Task: bounded continuation of `A04_BUSINESS_COVERAGE` for `CAP-18`.
Parent A head: `ada6d817e5570b159586a447ddf223b6f760db54`.
Observed `origin/main`: `0b9648bd0bb14d1af6a2916f6fbba16e37b887a0`.

## Scope

Accepted WB mapping remains:
- `promo_fullstats`;
- `media_stats`.

This slice pins the current provider grain for both families and explicitly refuses to collapse promotion product statistics and media banner statistics into one invented schema.

No runtime, frozen donor, accepted operation mapping, live WB request, credential, owner session, AI call, deployment or shared readiness mutation was performed.

## Provider authority

Pinned current mirror:
- repository: `eslazarev/wildberries-sdk`;
- commit: `5057bdb9bf16dea24000e3ca79e1934f7761d7fe`;
- path: `specs/08-promotion.yaml`;
- blob SHA: `30ae48c8d1b67944b34cf51ac896ae4c2b2fa0d9`.

The mirror preserves the current WB promotion OpenAPI surface used for this source-only check.
## Promotion statistics

`GET /adv/v3/fullstats` requires `ids`, `beginDate`, `endDate`; the documented period is bounded to 31 days and up to 50 campaign IDs.

Current OpenAPI exposes:
- `advertId` — campaign identity;
- `views`, `clicks`;
- `sum` — promotion statistics spend;
- `currency` — ISO-4217 account currency;
- `days[].date`;
- `days[].nms[].nmId` — product identity.

Therefore promotion statistics can preserve campaign/product/day grain with explicit response currency.

The earlier `wb_advertising_field_schema_slice_v1` recorded a narrower historical `currencyField:null` boundary. This slice does not rewrite that receipt; it records the newer pinned OpenAPI surface as forward evidence.

## Media statistics

`POST /adv/v1/stats` requires a body array of 1..100 request items. Each request item is one of:
- campaign ID only;
- campaign ID + selected dates;
- campaign ID + interval.

The success response is an array of one-of:
- `Stat`;
- `StatDate`;
- `StatInterval`;
- `StatCampaignNotFound`.

Successful `Stat*` variants expose `stats[]` but do **not** expose a campaign ID. `StatCampaignNotFound` alone exposes `advert_id`.

Inside `stats[]`:
- `item_id` is documented as banner ID, not product `nmID`;
- `views`, `clicks`, `expenses`, `daily_stats` are media-stat fields;
- no response currency-code field is present.
The OpenAPI describes the request/response schemas and examples but does not state a guarantee that successful response elements can be correlated to request campaign IDs solely by array position. This slice therefore does not invent such a join.

## Enforced semantics

- promotion and media statistics keep explicit family tags;
- media `item_id` is never interpreted as product `nmID`;
- successful media responses are not joined to request campaign IDs by array position without a provider guarantee;
- media `expenses` is not labelled `spend:provider_currency` until an explicit account currency code is bound;
- promotion `sum` uses its explicit response `currency`;
- promotion product/day grain is not merged with media banner grain;
- missing identity/currency remains missing, never zero or inferred.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-advertising-stats-grain-field-schema-slice-v1.json`
SHA-256: `cf072c2626553df432423942ab8be892e27b40c82a223a10945c06e5be53274c`.

Validator:
`tests/regression/extension-core/wb-advertising-stats-grain-field-schema-slice.mjs`
SHA-256: `3f705de8160b95d3eb80b1feeda5ddcf6a08967aed34eb59a09fe9cc8b1a115b`.

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `dc97d2f4a2dbe76d57f4a3a211ac82ec8f0af17082b17b98094d265f2ebcc2ac`.
## Verification

Focused:
- `node tests/regression/extension-core/wb-advertising-stats-grain-field-schema-slice.mjs` — PASS;
- promotion campaign/product/day + explicit currency projection — PASS;
- media banner identity kept distinct from product identity — PASS;
- successful media campaign identity remains explicit `INCOMPLETE` rather than position-joined;
- media campaign-not-found `advert_id` handled explicitly;
- media request body >100 items fails closed.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 139 WB operation refs;
- 25 deterministic numeric cases;
- readiness semantic projection unchanged.

No full `extension_core` rerun: fixture/validator/import/receipt only; runtime/package bytes are unchanged.

## Evidence boundary and remaining gates

This is SOURCE field-schema evidence, not LIVE_WB, LIVE_OWNER, installed-store or final CAP-18 business acceptance.

Open:
- provider-guaranteed successful media response ↔ campaign correlation;
- explicit media-stat account/store currency-code binding for `expenses`;
- live WB advertising-stat values and owner gold-set reconciliation;
- business policy for presenting promotion product statistics beside media banner statistics;
- controller review of whether CAP-18 accepted mapping needs an explicit additional identity/currency source.

The separate visibility/shadowed source-freshness HOLD remains unresolved and is not changed by this slice.
