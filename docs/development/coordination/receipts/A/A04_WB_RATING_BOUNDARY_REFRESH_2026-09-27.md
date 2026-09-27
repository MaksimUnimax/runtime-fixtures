# A04 — WB rating / FBS-error-index boundary refresh — 2026-09-27

Status: **SOURCE RATING BOUNDARY PASS / WB FBS ERROR-INDEX EQUIVALENT ABSENT**

Task: `A04_CAP15_WB_RATING_BOUNDARY_REFRESH`.
Parent A head before this slice: `327995a78702821e9471901f5b77ac9c13521d97`.
Observed `origin/main`: `2a734899810c540e9597e56c531be247f7065fb4`.

## Defect corrected

Pinned current mirror `eslazarev/wildberries-sdk@5057bdb9bf16dea24000e3ca79e1934f7761d7fe`
records in its changelog that obsolete `POST /api/analytics/v1/item-rating`
was removed on 2026-08-15. The frozen project WB registry still marks
`analytics_item_rating_v1` current, so CAP-15 removes that stale alias from the
current business-scenario mapping without editing the shared migration/reference.

Corrected CAP-15 WB mapping:
- `analytics_item_rating_v2`;
- `measurement_penalties`.

No exact WB analogue for Ozon `seller_fbs_error_index` is claimed.

## Pinned source semantics

Current item-rating v2:
- supports Personal/Service tokens;
- requires a current period and supports optional past comparison;
- supports filters of up to 50 product/subject/brand/tag IDs;
- supports offset pagination with limit up to 1000;
- exposes seller rating plus product-grain `nmId`, card `rating`,
  feedback metrics, excluded-feedback count and `isShadowed`.

Current measurement-penalties:
- returns product `nmId` and measurement `dimId`;
- describes measured dimensions and difference percentage;
- exposes optional `penaltyAmount`/`reversalAmount` and measurement validity;
- represents dimension-measurement penalties, not an order-fulfillment error index.

Therefore rating and penalty fields remain separate provider metrics.
Neither one is relabelled as an FBS execution/error index.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-rating-boundary-refresh-v1.json`
SHA-256: `c0507740aad64c9b9f3899a7aa5c2c834f4c7b55880289195c36792d8faef939`.

Validator:
`tests/regression/extension-core/wb-rating-boundary-refresh.mjs`
SHA-256: `489817cb1cb3ee20fefc01004d2378cb62ac0d4c9be4e749ef5550e4fcd69210`.

Coverage manifest:
`tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json`
SHA-256: `97d6dabf848959a69a54587422a874b1dcb6e476ae43e4288a643fb6d27b5b0d`.

Numeric fixtures after executable `rating_boundary` cases:
`tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json`
SHA-256: `19a2d1a9561979a739c650ec07a8b72f170f1c9de58b9d04cb3a9dd6e6e4a8f3`.

Aggregate validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `125d013a262fbfc9e6e52d8fcfbbbd91844c12557d01d83153a0be72e401b597`.

## Verification

Node `v24.20.0`:
- `node tests/regression/extension-core/wb-rating-boundary-refresh.mjs` — PASS;
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- aggregate: 45/45 scenarios, 101 Ozon refs, 134 WB refs, 44 numeric cases;
- deleted v1 alias is detected as frozen-registry drift but excluded from CAP-15;
- known/missing rating and measurement-penalty cases preserve `fbsErrorIndex=null`;
- `git diff --check` — PASS.

No full extension/package/browser suite was rerun because this slice changes only
source evidence/tests/business mapping and no product/runtime bytes.

## Remaining gates

Open:
- live WB rating/measurement values and owner gold-set reconciliation;
- no exact WB FBS error-index equivalent is identified by this source family;
- complete measurement-penalty offset pagination when used;
- frozen WB registry still contains deleted `analytics_item_rating_v1` and requires
  separate shared-authority regeneration ownership.

Evidence level: SOURCE only. No LIVE_WB, LIVE_OWNER, installed-store,
publication or production acceptance is claimed.
