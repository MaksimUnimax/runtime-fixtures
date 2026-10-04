# A04 — WB advertising spend/DRR field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / CURRENCY + OWNER REVENUE + LIVE VALUES OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Base exact A candidate: `0ffa7ad2a1a9ad31517c267001824c558e337de8`.
Observed `origin/main`: `6a0149c958423082a62d5cb84ac757eed2e785a2`.

## Scope

The accepted 45/45 operation mapping is unchanged.
This slice pins field/unit/completeness boundaries for:
- `STD-16` — promotion spend by campaign/period;
- `STD-17` — campaign/product clicks, spend, revenue/DRR boundary;
- `STD-20` — period spend versus comparable revenue/DRR boundary.

No live WB request, marketplace credential, owner session, AI request, product runtime change or shared readiness TSV mutation was performed.

## Current official sources

Checked 2026-09-27:
- https://dev.wildberries.ru/en/docs/openapi/promotion
- https://dev.wildberries.ru/en/release-notes
- https://seller.wildberries.ru/instructions/en/ru/material/statistics-and-promotion-management

Current documented boundaries used here:
- `GET /adv/v1/upd` returns promotion costs history for explicit `from/to`, with a documented 1–31 day interval and `updSum` cost amounts.
- Its documented response exposes campaign/cost fields but no currency field, so this slice refuses to assume RUB.
- `GET /adv/v3/fullstats` accepts at most 50 campaign IDs, at most 31 days and campaigns in statuses 7/9/11; its campaign/day/product tree contains `sum`, `sum_price`, clicks/orders/units/views.
- WB seller guidance distinguishes statistics spend from the actual amount spent and points to Finance → Costs history for the current actual spend.
- `POST /adv/v1/normquery/stats` supports CPM and CPC. Current release notes explicitly state that CPC results do not include views, CTR or CPM.

## Project interpretation / fail-closed rules

Provider field presence is separated from business meaning:
- actual promotion spend for this slice comes from `promo_spend_history.updSum`;
- `fullstats.sum` is campaign statistics spend and is not added to `updSum`;
- `fullstats.sum_price` remains campaign-attribution context and is not silently relabeled as whole-store revenue;
- `statistics_sales` remains preliminary operational sales, not final finance;
- “revenue/выручка” remains owner/business-defined as recorded by the preceding WB finance slice.

DRR is only computed when spend and the owner-selected revenue denominator are:
1. present and finite;
2. for an explicitly comparable period;
3. in a known matching currency;
4. denominator > 0.

Otherwise DRR is `null` / incomplete, never a fabricated zero or percentage.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-advertising-field-schema-slice-v1.json`

SHA-256:
`baf5c2f3fe0cab8d7a62470f3c2b20b1e1ba9e8ab500b0e74abee50321d35d45`

Validator:
`tests/regression/extension-core/wb-advertising-field-schema-slice.mjs`

SHA-256:
`91815907efe4c292c1a4bb556fd683891b6f278a87c67348571978b7a3ccc7b2`

Existing business coverage imports this bounded validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`

SHA-256 after import:
`2585c27b63e61882d14f88a77051f113ceb07dfd91073966ef49ccf2c8b116f0`

## Verification

Targeted:
- `node tests/regression/extension-core/wb-advertising-field-schema-slice.mjs` — PASS.
- Actual spend source asserted as `promo_spend_history`.
- Promotion currency in response: false; fail-closed external currency context required.
- Final revenue selected: false.
- Accepted operation mapping changed: false.

Whole business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation references;
- 137 WB operation references;
- 25 existing deterministic numeric cases;
- accepted readiness semantic projection unchanged.

The previous exact A candidate `0ffa7ad2` had a supervised full `extension_core` result of 131/131 PASS.
This slice changes only tests/fixtures/receipt and does not change product/runtime/package bytes, so that expensive package regression was not redundantly rerun. The new semantics are covered by the targeted validator plus the aggregate business-coverage check.

## Remaining concrete gaps

- promotion cost responses need a separate authoritative provider/account currency context;
- owner/business definition of the comparable revenue denominator is still required;
- live WB values and owner gold-set reconciliation remain open;
- spend/revenue timezone and period alignment must be explicit;
- campaign-attribution completeness requires the full applicable campaign universe and the endpoint's status/50-ID boundaries;
- if final finance revenue is required for `STD-17` or `STD-20`, the accepted operation mapping must be reviewed rather than silently relabeled;
- shared readiness TSV correction, if needed, is handed to C rather than taken over by A.

Evidence level: SOURCE only for these new provider semantics. This is not LIVE_WB, LIVE_OWNER, store acceptance or final business acceptance.

## Correction — 2026-10-04

Fresh reconciliation against the same pinned provider authority
`eslazarev/wildberries-sdk@5057bdb9bf16dea24000e3ca79e1934f7761d7fe`,
`specs/08-promotion.yaml` blob
`30ae48c8d1b67944b34cf51ac896ae4c2b2fa0d9`, corrected the historical
`promo_campaigns` response-field description used by this advertising slice.

For `GET /api/advert/v2/adverts`, campaign identity is top-level `id`;
payment model is `settings.payment_type`; campaign product membership is
`nm_settings[].nm_id`; `status` remains the top-level provider enum and
`currency` remains a top-level campaign currency field. Historical
`advertId/paymentType` promotion-row field names were stale evidence and are
now rejected. This does not alter `promo_spend_history`,
`promo_fullstats`, DRR rules, cost/revenue boundaries, or runtime execution.

Corrected machine-readable evidence:
- fixture SHA-256:
  `4633c5094a66cea2326b6bcc153ef5141cccf396a2d70644d88ea9b6c6198929`;
- validator SHA-256:
  `9a28e80fe8edfc884e43fa8d6ee891295903c11b86bc0134979bed23974d35ee`.

The corrected advertising validator cross-checks shared campaign identity,
product-membership, and currency field roles against the accepted
advertised-stock evidence. Focused advertising/campaign-status consumers and
the aggregate business-scenario suite PASS. No provider call, package,
browser, database, service, or live mutation was performed.

The earlier hashes above remain as historical identifiers of the superseded
pre-correction bytes.
