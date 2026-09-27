# A04 — WB current-stock field/schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / LIVE VALUES AND FULL-CATALOG COMPLETENESS OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE` after the accepted 45/45 operation mapping.
Parent head before this slice: `47a8e799578ebcb97d48439b6e1f538b043982c4`.
Current `origin/main` observed before commit: `7600f3ceb555c32ff798aac48f6c9613e8124ab2`.

## Scope

This slice does not rewrite the accepted 45/45 operation map.
It adds field/grain/unit evidence for the minimum useful current-stock scenarios:
- `STD-08` — current stock by warehouse;
- `CAP-04` — current stock by warehouse awareness.

Both WB fulfillment schemes stay separate:
- WB warehouses: Analytics endpoint;
- seller/FBS warehouses: Marketplace warehouse list + per-warehouse inventory endpoint.

No live marketplace request, credential use, AI request, owner session, or shared readiness TSV mutation was performed.
## Current official WB sources

Checked on 2026-09-27:
- https://dev.wildberries.ru/en/openapi/analytics
- https://dev.wildberries.ru/en/openapi/work-with-products
- https://dev.wildberries.ru/en/release-notes

Official Analytics documents `POST /api/analytics/v1/stocks-report/wb-warehouses` as current WB-warehouse inventory:
- Personal or Service token;
- data updated every 30 minutes;
- one response row = one item size in one WB warehouse;
- offset pagination, response limit up to 250000 rows;
- response sample fields `nmId`, `chrtId`, `warehouseId`, `warehouseName`, `regionName`, `quantity`, `inWayToClient`, `inWayFromClient`.

The March 2026 WB release note states that this method replaces deprecated `GET /api/v1/supplier/stocks`, scheduled for disablement on 2026-06-23.
The current pinned registry already points `wb_warehouse_stocks` at the replacement endpoint.

Official Product Management documents:
- `GET /api/v3/warehouses` for seller warehouses;
- `POST /api/v3/stocks/{warehouseId}` for seller-warehouse inventory;
- inventory response rows contain `chrtId` and `amount`.
The method page does not state an inventory freshness SLA/timestamp for this seller-warehouse read, so none is invented here.
## Machine-readable evidence

New fixture:
`tests/regression/extension-core/fixtures/wb-stock-field-schema-slice-v1.json`

SHA-256:
`f1d89b9ca8899471410823a9cf677d305116e7ce3e6539c33f28be8063ebd5bb`

New validator:
`tests/regression/extension-core/wb-stock-field-schema-slice.mjs`

SHA-256:
`19647af29b64ef08ca886cf5b31b9ec24a88decd70cd07f35cc2b5716a32fcd2`

Existing 45/45 validator now imports the slice:
`tests/regression/extension-core/business-scenario-coverage.mjs`

SHA-256 after one-line import:
`4e8dd2ce9cb60a904873e152493b943873dabd4a74eabe0e501cb52044b05267`

The accepted `business-scenario-coverage-v1.json` operation mapping itself is unchanged.
## Enforced semantics

The validator fails closed if current registry metadata drifts from:
- `wb_warehouse_stocks` -> Analytics POST `/api/analytics/v1/stocks-report/wb-warehouses`;
- `seller_warehouses` -> Marketplace GET `/api/v3/warehouses`;
- `fbs_stocks` -> Marketplace POST `/api/v3/stocks/{warehouseId}`.

WB-warehouse row grain is explicit: `nmId + chrtId + warehouseId`.
`quantity` is the current on-hand stock field used by this slice.
`inWayToClient` and `inWayFromClient` are transit fields and are not added to on-hand stock.
Warehouse totals are sums of `quantity` only after complete offset pagination.

Seller/FBS stock is joined by `seller_warehouses.id -> fbs_stocks path warehouseId`.
`stocks[].chrtId` is the size identifier and `stocks[].amount` is current on-hand inventory.
A missing warehouse response is `INCOMPLETE`, never zero.
FBW and FBS results are not silently merged into one provider scheme.
## Completeness boundary

This slice proves field/schema interpretation, not a complete live warehouse total.

For WB warehouses, completeness requires consuming complete offset pagination.
For seller/FBS warehouses, the read accepts caller-supplied `chrtIds`; therefore full-catalog completeness requires a complete size-ID input set for every seller warehouse.
That size-ID enumeration dependency is intentionally left explicit rather than inferred from the operation name.

The existing 45/45 operation mapping is reused as instructed.
No scenario is upgraded to live/business PASS from this source-only evidence.

## Verification

Final exact schema/test bytes:
- targeted `wb-stock-field-schema-slice.mjs`: PASS;
- `business-scenario-coverage.mjs`: PASS, 45/45 scenarios, 101 Ozon operation refs, 137 WB operation refs, 25 deterministic numeric cases;
- `core-contracts.mjs` against composed source runtime: 9/9 PASS;
- `core-contracts.mjs` against extracted package runtime: 9/9 PASS;
- final focused supervisor job: exit 0, cleanup verified.
A full `tooling/checks/extension_core.py` source+package run immediately before the final fail-closed fixture/assertion tightening completed PASS:
- 131 gate processes;
- live provider calls: 0;
- installed acceptance: false;
- source/extracted package bytes matched.

After that full run, runtime/product bytes were not changed; only this test fixture/validator was tightened.
The final exact test bytes were then rerun against both already-built source and extracted runtimes as listed above.

## Remaining gates

Still open and not relabeled:
- live WB values and owner gold-set agreement;
- complete seller/FBS `chrtIds` enumeration proof for full-catalog warehouse totals;
- field-level schemas for the other 43 business scenarios;
- historical movement/write-off causality;
- buyer-specific delivery availability;
- seller-warehouse freshness SLA, because the current method documentation used here does not state one.

Shared readiness TSV ownership remains with C. This receipt is evidence for normal C intake, not a `PASS_FEATURE` claim.
