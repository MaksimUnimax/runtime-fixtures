# A04 — WB visibility/current-source mapping refresh — 2026-09-27

Status: **SOURCE MAPPING REFRESH PASS / BUYER VISIBILITY + LIVE VALUES OPEN**

Task: `A04_WB_VISIBILITY_MAPPING_REFRESH`.
Parent A head before the slice: `1dd958811444748f45d41db846e6d8780cbbaa61`.

## Defects corrected

Pinned current mirror `eslazarev/wildberries-sdk@5057bdb9bf16dea24000e3ca79e1934f7761d7fe`
records that obsolete `GET /api/v1/analytics/banned-products/shadowed` was removed
on 2026-08-15. The frozen project WB registry still marks that alias current, so this
slice removes it only from current business-scenario mappings and explicitly preserves
the frozen-registry drift as evidence rather than editing the migration reference.

Existing A04 STD-18 evidence also proves `promo_nms` means cards eligible to be
added to a campaign, not current advertising membership. STD-19 therefore replaces
that false signal with `promo_campaigns` status-9 membership.

Because `cards_errors` identifies affected seller articles through `vendorCodes`
rather than `nmId`, STD-19 also adds `cards_list` as the explicit
`vendorCode -> unique nmID` identity bridge. Ambiguous seller articles fail closed.

Corrected WB mappings:
- STD-14: `cards_errors + banned_products_blocked + stock_products`;
- STD-15: `banned_products_blocked + seller_warehouses + marketplace_offices`;
- STD-19: `promo_campaigns + cards_errors + cards_list + banned_products_blocked`;
- CAP-02: `cards_errors + banned_products_blocked + stock_products`.

No replacement visibility heuristic is invented. STD-14, STD-15 and CAP-02 remain
explicit boundaries; blocked/content/stock/campaign signals do not prove
buyer-specific visibility or delivery.

## Pinned authority

- reports spec blob: `22ff073c10a3cebe0dc7af647eb2b704fd35857c`;
- promotion spec blob: `30ae48c8d1b67944b34cf51ac896ae4c2b2fa0d9`;
- upstream changelog blob: `7a9395c29abff969d072f95587fdb0094497b6cd`;
- current blocked response blob: `c3033252c6982783b0b77a5b56b6d426215ad053`;
- current blocked row blob: `5494cb177f096d5e4c8860d7a84a78a8ba9b0daf`.

The current blocked-card row exposes optional `nmId`, `vendorCode` and provider
`reason`. Missing identity remains unknown, not zero.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-visibility-mapping-refresh-v1.json`
SHA-256: `600bc5f3534c1e31ea2a0ad22111fda5e1856f3db724fe5b5955c564ebfb9f2c`.

Validator:
`tests/regression/extension-core/wb-visibility-mapping-refresh.mjs`
SHA-256: `f5ef335ce729047f11efa296eb0b96d56a58c2c004ff7a852c0f577a9ecd5cd7`.

Coverage manifest after the four bounded corrections:
SHA-256: `b381dad9ef6c35c1065049e693fceccb573d755f341e6160cf0cf9ce9104ecfc`.

Numeric fixtures after executable `visibility_boundary`,
`restriction_boundary` and `ad_content_join` cases:
SHA-256: `cd673156a8c06dee049901fbe4312399ba7a70abe856a51106b6731813c58140`.

Aggregate validator:
SHA-256: `1b1341626e95810c7a3640aed04754d4e8ddf4733cf95c3dd1d50339e84b992f`.

## Verification

Node `v24.20.0`:
- `node tests/regression/extension-core/wb-visibility-mapping-refresh.mjs` — PASS;
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- aggregate: 45/45 scenarios, 101 Ozon refs, 135 WB refs, 41 numeric cases;
- frozen stale `banned_products_shadowed` is explicitly detected but absent from
  all four corrected current scenario mappings;
- eligibility-only `promo_nms` does not create an advertised signal;
- active promotion membership, content identity bridge and blocked-card signals
  are joined fail-closed;
- duplicate/ambiguous joins fail closed;
- buyer-specific visibility remains unproven;
- `git diff --check` — PASS.

No full extension/package/browser suite was rerun because this slice changes only
source evidence/tests/business mappings and no extension/runtime bytes.

## Remaining gates

Open:
- live WB blocked/content/campaign values and owner gold-set reconciliation;
- buyer-specific visibility/delivery remains unavailable from these signals;
- complete cards-errors/catalog pagination before product-level content conclusions;
- the frozen WB reference still contains the deleted alias; regenerating that
  shared migration/reference authority is a separate ownership/integration task.

Evidence level: SOURCE only. No LIVE_WB, LIVE_OWNER, installed-store, publication
or production acceptance is claimed.

