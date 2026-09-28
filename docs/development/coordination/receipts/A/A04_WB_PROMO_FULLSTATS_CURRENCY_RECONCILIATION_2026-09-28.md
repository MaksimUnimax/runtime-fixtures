# A04 — WB promo fullstats currency reconciliation — 2026-09-28

Status: **SOURCE CONSISTENCY PASS / ACTUAL-COST + MEDIA CURRENCY/LIVE GATES OPEN**

Task: `A04_WB_PROMO_FULLSTATS_CURRENCY_RECONCILIATION`.
Parent A head: `04ec00b1de58d58bd99efecfd7791b62f9c27390`.
Observed `origin/main`: `5f7940dee5a2caa1f8dea6fc5df07c720f437d4c`.

## Defect closed

Two active A04 validators encoded contradictory current facts for
`GET /adv/v3/fullstats`:

- the older advertising fixture still asserted `currencyField=null`;
- the newer pinned CAP-18 OpenAPI slice proved that `promo_fullstats`
  exposes `currency` as the promotion-statistics ISO-4217 currency.

Because both validators are imported by the same aggregate business-coverage
gate, one current test run could report both `promotionCurrencyInResponse=false`
and `promotionCurrencyExplicit=true`.

This slice reconciles the active source fixtures to the newer pinned authority.
The older receipt is preserved as historical evidence; it is not treated as the
current schema after this reconciliation.

## Boundaries preserved

This change does **not** collapse different money sources:

- `promo_fullstats.sum` is promotion-statistics spend and now carries the
  response `currency`;
- `promo_spend_history.updSum` remains the selected actual promotion-cost
  ledger for the earlier actual-spend rule;
- `/adv/v1/upd` still has no response currency field in the accepted evidence,
  so actual-cost currency requires separate authoritative account/provider
  context;
- `fullstats.sum_price` remains campaign-attributed order value, not whole-store
  revenue;
- the owner/business revenue denominator remains unresolved for DRR;
- WB Media `media_stats.expenses` still has no explicit currency-code evidence,
  and successful media response ↔ campaign correlation remains unproven.

No accepted operation list, runtime, package, provider call, live account, shared
registry, or readiness TSV changed.

## Source authority

The reconciliation reuses the already accepted/pinned current CAP-18 source
evidence in:
`tests/regression/extension-core/fixtures/wb-advertising-stats-grain-field-schema-slice-v1.json`.

Pinned authority recorded there:
- mirror repository: `eslazarev/wildberries-sdk`;
- commit: `5057bdb9bf16dea24000e3ca79e1934f7761d7fe`;
- spec: `specs/08-promotion.yaml`;
- blob: `30ae48c8d1b67944b34cf51ac896ae4c2b2fa0d9`.

The active older advertising fixture now requires its
`campaignStats.currencyField` to equal the newer pinned
`currencyFieldCurrentOpenapi` value.

## Machine-readable evidence

Updated active advertising fixture:
`tests/regression/extension-core/fixtures/wb-advertising-field-schema-slice-v1.json`

SHA-256:
`eb5231244548c1d7438ef04c92741179e5d7fe748dded2e7fb577b3f551fd85a`

Updated advertising validator:
`tests/regression/extension-core/wb-advertising-field-schema-slice.mjs`

SHA-256:
`f2ef3aeb1e4c8dc4b4258213bd4da6dc9b82fec2231d2314617789b636a4647c`

Updated CAP-18 cross-fixture validator:
`tests/regression/extension-core/wb-advertising-stats-grain-field-schema-slice.mjs`

SHA-256:
`6b8460a7ab0de044610920d47d23789777bd08809377451a4464651232979b93`

## Verification

Exact Node: `v24.20.0`.

- `node tests/regression/extension-core/wb-advertising-field-schema-slice.mjs`
  — PASS; `promotionCurrencyInResponse=true`.
- `node tests/regression/extension-core/wb-advertising-stats-grain-field-schema-slice.mjs`
  — PASS; `promotionCurrencyExplicit=true`,
  `mediaCampaignJoinResolved=false`, `mediaCurrencyResolved=false`.
- `node tests/regression/extension-core/business-scenario-coverage.mjs`
  — PASS; 45/45 rows, 101 Ozon refs, 133 WB refs, 58 numeric cases.
- `git diff --check` — PASS.

No full extension/package/browser suite was rerun because product/runtime/package
bytes are unchanged.

## Remaining gates

- authoritative currency context for actual promotion cost history;
- owner/business definition of comparable revenue for DRR;
- explicit period/timezone alignment for spend/revenue comparison;
- media response campaign correlation and media expenses currency;
- live WB advertising values and owner gold-set reconciliation.

Evidence level: **SOURCE only**. No LIVE_WB, LIVE_OWNER, installed-store,
publication, deployment, or production acceptance is claimed.
