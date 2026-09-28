# C — WB current registry authority assignment — 2026-09-28

Status: **SOURCE/PACKAGE PASS / CURRENT SHARED AUTHORITY OWNED BY C / NO DB SCOPE**

Base observed before implementation: `779d4b84dd240861b9c96e442970ae03f406bc2d`.

A's accepted SOURCE receipts establish two stale current-runtime aliases in the frozen WB donor:
- `banned_products_shadowed` → `GET /api/v1/analytics/banned-products/shadowed`;
- `analytics_item_rating_v1` → `POST /api/analytics/v1/item-rating`.

A already removed both aliases from current business-scenario mappings. Current WB API authority announced both methods disabled on 2026-07-30 and directs hidden-catalog/item-rating use to `POST /api/analytics/v2/item-rating`.

The frozen donor remains byte-immutable:
`migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js`.
It is historical import evidence and is not rewritten.

C is the single author for the shared current-runtime correction because the registry is consumed by both extension composition and C03 API-watch. B remains the sole DB/schema/migration author and has no file in this change.

Assigned implementation paths:
- `packages/marketplaces/wildberries/src/retired-analytics-registry-overlay.js` — new narrow fail-closed overlay;
- `apps/extension/composition.json` — load it after frozen `wb_operations.js` and before other WB consumers;
- `tooling/api-watch/src/product-registry.ts` — compute the same effective registry as the package;
- `tooling/api-watch/src/product-registry.test.ts` — parser/order/currentness regression;
- this C receipt.

Required effective order:
`frozen wb_operations.js` → `retired-analytics-registry-overlay.js` → `fbs-order-statuses-registry-overlay.js` → frozen `wb_contract.js` → contract overlay/guidance.

Required checks before integration:
1. both retired aliases are absent from effective runtime registry and v2/block/current alternatives remain;
2. exact method/path drift guards fail closed if the donor changes;
3. API-watch default registry applies both overlays in the same order as extension composition;
4. source + extracted package WB adapter regression remains green;
5. frozen donor hash/content is unchanged; no DB/schema/migration file changes.

Evidence boundary: SOURCE/PACKAGE only. This does not claim LIVE_WB or LIVE_OWNER values.
Consumer regression path additionally assigned to C for this bounded shared-authority change:
- `tests/regression/extension-core/wb-adapter.mjs` — assert retired aliases are absent from the composed SOURCE/PACKAGE contract and update exact effective-operation counts only.

## Implementation result

The effective runtime now retires exactly the two obsolete aliases before WBContract/guidance capture the registry. `banned_products_blocked` and `analytics_item_rating_v2` remain available. The frozen donor is unchanged at SHA-256 `08e8a2ad1f325a4bdc0a909b37220b7abaa0be1d94d6b53192666ed5f22c2c75`.

Verification on Node 24.20.0:
- C03 API-watch: 168/168 tests PASS; typecheck PASS;
- targeted lint/format/diff-check: PASS;
- extension-core source + extracted package: 131/131 gates PASS;
- WB adapter source and extracted-package regressions PASS with effective 170 enabled + 16 disabled operations and both retired aliases absent;
- supervisor `octoport-test-c-7ef9ada486c048edb187f9cbb17d3d6b.service`: exit 0, OOM 0, cleanup verified, peak 184,549,376 bytes;
- live provider calls: 0; installed acceptance: false.

The regression package produced here is a local development verification artifact (SHA-256 `5fe389687d06e742c8356d8d6cfe9cc89528e73b83fd27eb2f948f9c1a7eea0`). It does not replace or re-identify the separately accepted Opera STORE 0.2.5 ZIP.