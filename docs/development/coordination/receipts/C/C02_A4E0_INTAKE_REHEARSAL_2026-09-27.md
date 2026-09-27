# C02 intake rehearsal — A exact 4e0c6a5c on accepted B main — 2026-09-27

Status: **REHEARSAL PASS / EXACT A CANDIDATE PRESERVED / NOT YET PUBLISHED FROM C**

## Exact boundary

- accepted parent base: `84c3ba00a2c7f60f17bda414e0292f285cfd734e`;
- exact A candidate: `4e0c6a5c14d09a2d339e5071c0b3578161c9f725`;
- A submission base: `3805f8b23655668556e1f1ef43d4ab3cef837413`;
- isolated rehearsal merge: `22ba15c14f76741241d8c07290bb67b0a6d07634`.

The exact A candidate is ahead of its submitted base with no missing parent commits. The rehearsal merge is conflict-free and changes only A receipts/tests/fixtures: 27 files, no extension product/runtime source and no server/DB source.

## Verification on the combined tree

- `docs:check`: PASS;
- `business-scenario-coverage.mjs`: PASS, 45/45 rows, 101 Ozon refs, 137 WB refs, 25 deterministic numeric cases;
- full `extension_core.py`: PASS, 131 gates;
- Node: 24.20.0;
- live provider calls: 0;
- installed acceptance: false;
- package SHA-256 remains `2b3525d5e952b31306828dc173a6a19153e55c2cb59d62dc1048023d158b6530`;
- source/extracted package bytes match;
- `git diff --check`: PASS.

This validates the newest submitted A boundary including the restart transfer evidence, STORE-1 useful reviewer rehearsal, update-storage preflight and the bounded WB field/schema slices. It does not convert any SOURCE/PACKAGE evidence into LIVE_WB, LIVE_OWNER or store acceptance.

## Known WB FBS request-metadata gap

The A order-lifecycle slice correctly keeps one shared issue open: the active frozen registry entry `fbs_order_statuses` for `POST /api/v3/orders/status` has `body_required=false`, while current WB API documentation requires an `orders` request body.

C does not silently relabel that gap as complete. It is also not changed in this intake because the registry file is a composed extension package input and STORE-1 currently has a separately frozen exact Opera package/reviewer authority. Changing package input here would create a new package identity and need renewed STORE evidence for a scenario that does not depend on FBS status lookup.

The gap remains an explicit next-version/package-input repair with its own regression and package authority. It must be corrected before claiming complete current FBS status request-schema support.

## Publication boundary

This rehearsal is not a main publication receipt. Parent C may merge the exact A SHA only after the prior `84c3ba00...` post-main five-workflow boundary is complete. The resulting new C SHA must then receive its own five required branch workflows before `ready-main`.

## Newer controller ownership note

STREAMS-AUDIT-20260927-0701 assigns STORE-1 signature-preflight implementation to B09 and reserves the A03 reviewer-sequence documentation for a controller patch. C will not implement a competing signature helper and will not edit the reserved A03 receipt. This A intake preserves the exact submitted A source; later controller documentation is consumed through a separate normal boundary.
