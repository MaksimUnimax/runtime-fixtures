# A — WB retired-alias changed-boundary acceptance — 2026-09-28

Status: **SOURCE + EXTRACTED PACKAGE PASS / INSTALLED+LIVE+STORE OPEN**

Task: `A_WB_RETIRED_ALIAS_CHANGED_BOUNDARY_ACCEPTANCE`.
Controller notice: `STREAMS-AUDIT-20260928-0309`.

Current accepted main consumed before this task:
`4f3aa29b8954eff19b20df2930524be805b3c882`.

C-owned shared-authority fix:
`23f3d9707ce249637aa2ec0ea66de4439dfd65c7`.

A merged current main normally before validation. Product/package bytes were not changed by this A task; A added only a focused regression in:
`tests/regression/extension-core/wb-adapter.mjs`.

## Reused current validation

The already-running A verification required by the controller was reused rather than duplicated:
`/tmp/a-wb-retired-authority-20260928/summary.json`.

Result:
- D2.4 PASS;
- 131 gate processes;
- source/extracted byte identity PASS;
- repeat archive identity PASS;
- live provider calls 0;
- installed acceptance false.

Local-development package from that full validation:
SHA-256 `076ddeb72da0917517e7197155cb94a3c5c7bf4313b25a8d589dd2d87fd00090`.

Resource receipt:
`/root/octoport-control/resource-jobs/1848d56d4c90455e9727bbc0698b5c1b/receipt.json`.
Supervisor exit 0, OOM 0, cleanup verified, peak 190840832 bytes.

## New focused changed-boundary regression

New scenario:
`WB-01a-retired-analytics-aliases-fail-before-fetch-and-help`.

It proves for both retired aliases:
- public API command parsing returns `UNSUPPORTED_OPERATION`;
- batch execution records a pre-execution error;
- provider network count remains zero;
- legacy HELP `describe` returns an unknown operation card;
- WB_HELP_V2 analytics/direct guidance does not advertise either retired alias.

The same scenario also proves current alternatives remain visible:
- `banned_products_blocked`;
- `analytics_item_rating_v2`.

A supported useful flow remains intact:
`seller_info` executes successfully and produces exactly one request to
`https://common-api.wildberries.ru/api/v1/seller-info`.

Focused R1 failed only because the new test passed an already-invoked IIFE to
`worker.call()`, whose harness invokes the supplied function itself. No product/runtime
failure was observed. The test call shape was corrected and the same bounded scenario
was rerun.

Focused R2:
- SOURCE: 24/24 WB adapter scenarios PASS;
- EXTRACTED PACKAGE: 24/24 WB adapter scenarios PASS;
- new retired-alias scenario PASS on both;
- live provider calls 0;
- installed acceptance false;
- source result SHA-256:
  `92d7ef12f17ae50e2788a2346f164dd7ab68ed7c34479305c5b7c28cff54d11e`;
- extracted result SHA-256: identical;
- final test SHA-256:
  `b587afaab5ca508cc558b0141da194bb3da5a881ed2b5405efe66467d423a78b`.

Focused resource receipt:
`/root/octoport-control/resource-jobs/c71d3a5845224ee49e61a00c5bbe7e60/receipt.json`.
Exit 0, OOM 0, cleanup verified, peak 97517568 bytes.

## Evidence boundary

This closes the controller-requested changed consumer boundary at SOURCE and extracted
PACKAGE only. It is not installed-browser, LIVE_WB, LIVE_OWNER, store, deployment or
production acceptance.

## Remaining store/external boundary

The historical Opera/Chromium STORE 0.2.5 ZIP
`33cbf1ad9ec4669abe3a65e24cfbaead4c7c3a1fa711261b2d186d107c33aea1`
still contains both retired aliases as current+enabled and is not a repaired Submit
candidate.

Current main differs from that artifact's source in package inputs:
- `apps/extension/composition.json`;
- `packages/marketplaces/wildberries/src/retired-analytics-registry-overlay.js`.

C owns the new exact STORE version/artifact, release metadata, packaging and store
reviewer path. A must not mutate C's release candidate concurrently.

Remaining A evidence gates after a new exact C package exists are the already-recorded
real branded/store-installed and same-item update/Windows UX boundaries. Live owner/provider
gold-set and beta feedback remain genuine external evidence, not synthetic substitutes.
