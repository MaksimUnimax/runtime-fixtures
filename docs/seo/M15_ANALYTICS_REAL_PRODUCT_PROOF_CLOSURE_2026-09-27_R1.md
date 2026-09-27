# Octoport SEO — M15 analytics real-product proof closure — 2026-09-27 R1

Status: **PASS / ANALYTICS_PROOF_DEMO CLOSED / SOURCE-BACKED REAL LIVE EVIDENCE**
WORK_ID: `OCTOPORT_SEO_M15_ANALYTICS_REAL_PRODUCT_PROOF_2026-09-27_R1`

## 1. Requirement being closed

Current M12 proof authority:

`ANALYTICS_PROOF_DEMO = PROOF_REQUIRED_BEFORE_PRODUCTION`

Requirement:
at least one real sanitized demonstration or source-backed product example must prove the central seller-owned analytics value before production.

Acceptable evidence:
real extension/API result with sanitized non-secret data, or approved product screenshot.

Forbidden substitute:
mock customer case, invented screenshot, synthetic performance result.

## 2. Historical real-live authority found in GitHub

Private historical repository:
`MaksimUnimax/blood_sand`.

Evidence snapshot used for review:
`be5862fca8cd8e9781194a038af3d07eada2e3c3`
(`docs/ozon-llm-regression-2026-09-12` lineage).

### Primary gate terminal ledger

Path:
`tooling/llm-api-bridges/ozon-seller/research/product/OZON_AI_WORKER_PRIMARY_GATE_LIVE_RESULTS_TABLE_2026-09-02.md`

Blob:
`5cabdb166ba058d60c72c257b5adb33072993a31`

Authority state:
```text
AUTHORITATIVE_TERMINAL_SOL_RESULTS__44_OF_44_ROWS_COMPLETE
STD = 20/20 complete
CAP = 24/24 complete
PENDING primary rows = 0
FROZEN primary rows = 0
```

The terminal ledger explicitly preserves provider failures, rate limiting, entitlement boundaries,
operator intervention and partial outcomes instead of converting them into fake clean PASS.

### Detailed real API evidence A — seller sales analytics

Path:
`tooling/llm-api-bridges/ozon-seller/research/product/OZON_AI_WORKER_STANDARD_LIVE_BENCHMARK_V2_2026-09-02.md`

Blob:
`0ca1a41ca4b47f74efb8127d3ef46a35fe2062a3`

The preserved STD-01 record proves:
- a real Seller API `analytics_data` read;
- exact seller-owned aggregate sales dimensions/metrics;
- external request execution;
- one physical business request per explicit run;
- entitlement observed as supported/entitled;
- real provider HTTP responses;
- transient 429 failures preserved honestly;
- later exact explicit request succeeded;
- the real response contained aggregate revenue and ordered-unit values from a seller account.

Public-safe proof statement:
> On real seller-owned Ozon data, Octoport's historical Bridge path obtained aggregate daily sales
> metrics from the Seller API and supplied enough factual data for the AI to answer a sales-analysis
> question. Absolute seller values and request identifiers are intentionally not copied into this
> public repository.

No synthetic value is substituted for the redacted business values.

### Detailed real API evidence B — cross-surface ads × stock analysis

Path:
`tooling/llm-api-bridges/ozon-seller/research/product/live-runs/CAP_19_POST_REPAIR_FINAL_2026-09-06.md`

Blob:
`010810021cab1ae9922fa6119c75a92e76955e06`

The preserved CAP-19 run proves:
- a real Performance API campaign-products read;
- a real Seller API current-stock read;
- a product identifier returned by one provider surface was carried into the second;
- both calls were actual external HTTP 200 provider executions;
- the worker did not ask the operator to enumerate SKU manually;
- the stock provider omitted the requested row;
- the worker correctly classified the result as `UNKNOWN / OMITTED`, not stock zero;
- it therefore refused to invent an evidence-free out-of-stock advertising conclusion.

Public-safe proof statement:
> On real seller-owned advertising and stock data, Octoport's historical Bridge path joined a
> real advertised-product result with a real current-stock read and preserved provider omission as
> unknown instead of fabricating zero. Campaign ID, product ID/name, spend and request identifiers
> are intentionally omitted from this public proof.

This directly demonstrates the central analytics value of combining permitted seller-owned
information while preserving uncertainty.

## 3. Current-product authority compatibility

Current repository:
`MaksimUnimax/runtime-fixtures`

Current Ozon registry:
`apps/extension/src/imported/ozon-v0.1.22/shared/ozon_operation_registry.js`

Current blob:
`8e91dba347075d910621078692716494de77b9d7`

The current registry still declares:

### `analytics_data`
- provider: Seller API;
- path: `POST /v1/analytics/data`;
- effect: READ;
- `execution_enabled: true`;
- `currentness: current`;
- `safety_class: READ_SAFE`;
- `privacy_policy: safe_projection`;
- cluster: `sales_analytics`;
- purpose: period sales analytics by metrics/groupings.

### `performance_campaign_products`
- provider: Performance API;
- effect: READ;
- `execution_enabled: true`;
- `currentness: current`;
- `safety_class: READ_SAFE`;
- `privacy_policy: safe_projection`;
- purpose: campaign-product membership without hidden autopagination.

### `stocks_current`
- provider: Seller API;
- path: `POST /v4/product/info/stocks`;
- effect: READ;
- `execution_enabled: true`;
- `currentness: current`;
- `safety_class: READ_SAFE`;
- `privacy_policy: safe_projection`;
- purpose: current product stock.

Therefore the real historical examples are not examples of a data family that the current product
has removed.

## 4. Current readiness cross-reference

Current:
`docs/product/readiness/BUSINESS_SCENARIOS.tsv`
blob `4191015a969d8a27c65e78ab458a13afbbde6928`

The current readiness matrix carries forward the historical Ozon evidence classification for the
business scenarios and names the same historical evidence authorities.

The user's remembered "44 tests" is accurate for the terminal primary gate:
20 Standard business rows + 24 capability rows.

The later CAP-25 SEO-card optimization is a separate extension beyond that terminal 44-row gate and
is not required to prove the central seller-owned analytics page value.

## 5. Sanitization boundary

This public proof intentionally does NOT reproduce:
- seller credentials;
- request IDs;
- campaign IDs;
- SKU/product IDs;
- product names;
- exact private seller revenue, balance, spend or stock values;
- buyer/customer information;
- raw provider response bodies.

The private historical Git evidence retains the exact originals.

No fake or normalized invented performance number is used in their place.

## 6. Proof conclusion

The M12 requirement allows a real extension/API result with sanitized non-secret data.

The evidence above proves at least two real seller-owned analytics workflows:
1. seller sales analytics;
2. cross-surface advertising × stock reconciliation with uncertainty preservation.

Both are directly within the current public page's bounded promise:
- permitted data of the seller's own store;
- analysis/explanation;
- read-only;
- no external competitor-intelligence promise;
- no accounting guarantee;
- no automatic business-state mutation.

Therefore:

```text
ANALYTICS_PROOF_SCOPE = SATISFIED_FOR_CURRENT_GENERIC_PAGE_COPY
ANALYTICS_PROOF_DEMO = SATISFIED_SOURCE_BACKED_REAL_LIVE_EVIDENCE
ANALYTICS_PROOF_BOUNDARY = SATISFIED_CURRENT_AUTHORITY

REAL_SANITIZED_DEMO_GATE = CLOSED
FAKE_ANALYTICS_PROOF = 0
```

This closure does not claim that every one of the historical 44 scenarios is a current release
acceptance test. It closes only the M12 production-proof requirement for the current generic
`/seller-analytics` page.
