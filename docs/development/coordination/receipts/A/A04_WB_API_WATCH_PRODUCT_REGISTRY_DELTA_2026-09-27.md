# A04 — WB api-watch product-registry consumer delta — 2026-09-27

Status: **DEPENDENCY REPORTED TO C / A DOES NOT OWN CONSUMER**

Controller notice: `STREAMS-AUDIT-20260927-0743`.
Observed A head before this docs-only handoff: `b1433f9e94624615fad36e2a43c2189041152974`.
Observed `origin/main`: `fe31e4ac80d0ffb3b7cc7f25772b2e1d30b4e712`.

## Exact delta

The frozen WB donor is intentionally immutable:
`migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js`
SHA-256: `08e8a2ad1f325a4bdc0a909b37220b7abaa0be1d94d6b53192666ed5f22c2c75`.

Its `fbs_order_statuses` row still has:
- `POST /api/v3/orders/status`;
- `body_required=false`.

The effective extension runtime does not use that field unchanged.
`apps/extension/composition.json` loads
`packages/marketplaces/wildberries/src/fbs-order-statuses-registry-overlay.js`
immediately after the frozen operation registry and before `WBContract`.
The overlay keeps the donor immutable and changes only the effective
`fbs_order_statuses.body_required` to `true`.
Overlay SHA-256:
`72d4573a0f5208183a894e26952bf205b1e56414c33510e08fecb13b34a4c774`.
Composition SHA-256:
`bd35880326944c506de5532b87e4c369733f19e12f97ee38dfbad95951a75f22`.

## C-owned consumer

`tooling/api-watch/src/product-registry.ts` is outside A ownership.
It defines `WB_PRODUCT_REGISTRY_PATH` directly as the frozen donor path and
`extractProductRegistry({sourceFamily:"WILDBERRIES"})` statically parses the donor
`raw` array. Therefore its `providerMetadata` currently observes
`body_required=false` for `fbs_order_statuses`, while the effective composed
runtime observes `true`.

Current consumer SHA-256:
`8ef96a05b605eb82b4c60123cfcc28ec239493268e9695f2ce260614e7940845`.
Current consumer test SHA-256:
`fd7a15b7f42327b8e53a03853a4cf95db1493fbcef39363de036eb8243c709c5`.
## Required handoff boundary

C owns reconciliation of this monitoring/product-registry view.
A does not edit:
- `tooling/api-watch/src/product-registry.ts`;
- `tooling/api-watch/src/product-registry.test.ts`;
- the frozen donor.

The C-side result must make monitoring reason about the effective runtime
metadata for this composed override, or otherwise explicitly model the override,
without mutating historical donor bytes.

This is a narrow metadata-consumer dependency only. It does not authorize
a new shared contract, live WB request, deployment, or donor rewrite.

## Evidence level

This receipt reports SOURCE behavior and ownership only.
The A runtime correction itself remains covered by the existing SOURCE/PACKAGE
tests and the exact authority reconciliation in
`A04_WB_FBS_ORDER_STATUSES_REQUIRED_BODY_2026-09-27.md`.
No live provider, owner-session, store-install or deployment acceptance is claimed.
