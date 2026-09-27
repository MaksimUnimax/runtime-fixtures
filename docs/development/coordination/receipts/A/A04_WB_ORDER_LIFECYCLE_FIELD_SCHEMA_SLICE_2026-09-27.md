# A04 — WB order lifecycle field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / SHARED FBS BODY-REQUIREMENT METADATA GAP OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `c3ca3897d1817e8e2a9e25fb80f3ed2daf6f85f9`.
Observed `origin/main`: `3805f8b23655668556e1f1ef43d4ab3cef837413`.

## Scope

The accepted 45/45 operation mapping remains unchanged.
This slice narrows field, identity and event-family semantics for:
- `STD-11` — return/movement evidence without invented write-off causality;
- `CAP-09` — order rows versus current order status;
- `CAP-12` — cancellation/status versus buyer-return claims and goods-return movement.

No live WB request, marketplace credential, owner session, AI request, deployment, write action, or shared readiness TSV mutation was performed.

## Current official WB boundaries

Checked on 2026-09-27:
- https://dev.wildberries.ru/en/openapi/reports
- https://dev.wildberries.ru/en/docs/openapi/orders-fbs
- https://dev.wildberries.ru/en/openapi/orders-dbs
- https://dev.wildberries.ru/en/openapi/orders-dbw
- https://dev.wildberries.ru/en/openapi/user-communication
- https://dev.wildberries.ru/news/146

`GET /api/v1/supplier/orders` is preliminary operational data, updates every 30 minutes, uses one row per order item and `srid` as order identity, keeps at most 90 days guaranteed, and exposes `isCancel` / `cancelDate`. Its cursor continuation uses the final full `lastChangeDate` until an empty array.
For FBS, `GET /api/v3/orders` explicitly does **not** return current status. Current status is a separate `POST /api/v3/orders/status` read with `supplierStatus` and `wbStatus`; they remain distinct provider state dimensions.

For DBS, completed orders are returned separately from `POST /api/marketplace/v3/dbs/orders/status/info`, which provides per-order `supplierStatus`, `wbStatus` and lookup errors.

DBW remains a separate fulfillment family with its own order and status operations; this slice does not merge FBS/DBS/DBW states.

`GET /api/v1/analytics/goods-return` is a goods-return/movement report for periods up to 31 days and exposes fields such as `srid`, `orderId`, `nmId`, `returnType`, `status` and return lifecycle timestamps.

`GET /api/v1/claims` is a buyer-return-claim API. Current WB migration guidance requires the `is_archive` query as a string value and keeps claim identity/type/status separate from goods-return movement. A claim is not silently treated as an inventory movement or order cancellation.

## Shared registry finding

The active composed extension consumes the frozen WB operation registry from:
`migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js`.

For `fbs_order_statuses`, that frozen registry currently says `body_required=false`, while current official FBS documentation requires request body `orders` with 1..1000 assembly-order IDs.

This is a concrete shared metadata gap. It is **not** corrected in this A slice because `migration/reference/**` is outside A's OWNERSHIP allowlist and the assignment did not authorize rewriting the shared frozen reference. The fixture records the gap explicitly so it cannot be silently mistaken for complete request-schema proof.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-order-lifecycle-field-schema-slice-v1.json`

SHA-256:
`65b9c6d025c65fcf4c0db298d435eff85f40f6cddaac2c68a8239266963230d8`

Validator:
`tests/regression/extension-core/wb-order-lifecycle-field-schema-slice.mjs`

SHA-256:
`a53ace44fa09a8a6ec56f9fb9dff753443e4d8cbfa96d16ec3fe92a24c23b773`
Coverage validator import SHA-256:
`398405b99766fdcc5c48b626fa53d0529c7205cea4f4cd91cbb2a80d25489b3d`

The accepted `business-scenario-coverage-v1.json` operation mapping remains byte-unchanged.

## Enforced semantics

- An order-list row does not substitute for a current-status lookup.
- `supplierStatus` and `wbStatus` stay separate.
- Missing current status is `INCOMPLETE`, not guessed from an order row.
- Buyer-return claim and goods-return movement are separate event families even when they reference the same product.
- `statistics_orders.isCancel` is an operational cancellation signal, not a buyer-return claim.
- Return/movement status does not prove inventory write-off causality.
- This evidence slice contains read operations only; no cancellation/status mutation method is introduced.
- Missing data remains missing, never zero.

## Verification

Targeted exact validator:
- `node tests/regression/extension-core/wb-order-lifecycle-field-schema-slice.mjs` — PASS.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 137 WB operation refs;
- 25 deterministic numeric cases;
- accepted readiness semantic projection unchanged.

Full extension regression under the A supervisor:
`python3 tooling/coordination/control.py A heavy --profile browser --timeout-seconds 3600 -- env PATH=/root/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin python3 tooling/checks/extension_core.py --output /tmp/a04-wb-order-lifecycle-extension-core-20260927-r1`

Result:
- supervisor unit `octoport-test-a-cc8f10d811da46939f43821552ad171d.service`;
- 131/131 gates PASS;
- command exit 0, systemd result success;
- peak memory 183500800 bytes;
- OOM kills 0;
- cleanup verified true.
## Evidence boundary and next work

This is SOURCE field/schema evidence plus a clean SOURCE/PACKAGE regression. It is not LIVE_WB, LIVE_OWNER, installed-store acceptance, or final business acceptance.

Still open:
- shared-owner/C decision and correction for the frozen `fbs_order_statuses.body_required` metadata;
- live WB values and owner gold-set reconciliation;
- inventory movement/write-off causality beyond return movement status;
- full historical lifecycle across fulfillment schemes;
- claim-to-order linkage where the provider claim payload itself does not expose an order identifier.

Next independent A04 candidate is the direct price semantics family `CAP-10`: distinguish base `price`, `discountedPrice`, `clubDiscountedPrice`, currency and size-level pricing from seller discount percentages, using the current official Prices and Discounts API without changing the accepted operation map.
