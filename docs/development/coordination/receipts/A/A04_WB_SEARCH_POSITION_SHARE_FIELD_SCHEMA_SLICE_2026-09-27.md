# A04 — WB search position/category share boundary — 2026-09-27

Status: **SOURCE POSITION/SHARE PASS / REGION + ENTITLEMENT + LIVE VALUES OPEN**

Task: `A04_CAP23_WB_SEARCH_POSITION_SHARE`.
Parent A head before the slice: `b0d88ced2de6ee934db421e530a1bb980e7a2d58`.
Observed `origin/main`: `2a734899810c540e9597e56c531be247f7065fb4`.

## Scope

This slice pins field/grain/null/completeness semantics for `CAP-23` without changing
the accepted operation map:
- `search_report_main`;
- `search_report_groups`;
- `search_report_details`;
- `brand_share`.

No runtime/provider implementation, live WB call, credential, owner session, AI
request, deployment, STORE package or shared readiness TSV was changed.

## Pinned source boundary

Pinned mirror:
`eslazarev/wildberries-sdk@5057bdb9bf16dea24000e3ca79e1934f7761d7fe`.

Search-report sources establish:
- a required current period plus optional past comparison;
- filters by product, subject, brand and tag;
- explicit position clusters:
  `all`, `firstHundred` (1–100), `secondHundred` (101–200), `below` (201+);
- provider average and median search-position fields;
- main/groups limit up to 1000 plus offset-based selected-scope pagination;
- no region parameter in the pinned main/groups/details request family.

Brand-share source establishes:
- required `parentId`, `brand`, `dateFrom`, `dateTo`;
- report window up to 365 days;
- row fields `brandRating`, `pricePercent`, `qtyPercent`;
- `pricePercent` means sales-value share in the parent category;
- `qtyPercent` means sales-quantity share in the parent category;
- these optional fields are not a search-visibility-share metric.

This remains pinned-source evidence; no fresh live-account value claim is made.

## Enforced semantics

- Average and median position are separate provider definitions and may not be mixed.
- Region-specific search-position claims fail closed because the pinned source family
  has no region request field; absence is not silently interpreted as a region.
- Brand share is category sales share, not search visibility share.
- Missing optional share evidence remains `null`, never numeric zero.
- Missing position evidence is `UNKNOWN`, never position zero.
- Period and selected position definition are mandatory.
- Search analytics entitlement/account tariff remains an external capability boundary.
- Offset pagination must be exhausted for a complete selected group/product scope.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-search-position-share-field-schema-slice-v1.json`
SHA-256: `297773da614ff76dd140e24030703b2bb8391de05a5921d7f0a136beed54a3de`.

Validator:
`tests/regression/extension-core/wb-search-position-share-field-schema-slice.mjs`
SHA-256: `89d9b533098930767a0640c3d59a99c30ed5268fb7326a063f44b91fb3361969`.

Numeric fixtures after adding executable `search_position_boundary` cases:
`tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json`
SHA-256: `9bc8848af5a064554456aa7e7cab30344efda6df2ddabc7a33cc6a6a5515ff0d`.

Aggregate validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `ae1efdc247d75df1a6015fa8291b4631496ef03f3f5d008d51d2d0c11bba682c`.

## Verification

Node `v24.20.0`:
- `node tests/regression/extension-core/wb-search-position-share-field-schema-slice.mjs` — PASS;
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- aggregate: 45/45 scenarios, 101 Ozon operation refs, 138 WB operation refs,
  36 deterministic numeric cases;
- deterministic cases cover known average position/share, null share preservation,
  missing-position UNKNOWN and unsupported-region rejection;
- Prettier completed on the changed source-evidence/test files;
- `git diff --check` — PASS.

No full extension/package/browser suite was rerun because this slice changes only
source evidence/tests and no product/runtime bytes.

## Remaining gates

Open and not relabelled:
- live search-analytics entitlement and actual account tariff behavior;
- live WB position/category-share values and owner gold-set reconciliation;
- region-specific search position requires a different authoritative source;
- brand-share remains sales share, not search visibility share;
- complete selected-scope pagination.

Evidence level: SOURCE only. This is not LIVE_WB, LIVE_OWNER, installed-store,
store publication or production acceptance.

