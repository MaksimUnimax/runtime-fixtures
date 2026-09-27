# A04 — WB FBS order-status required-body correction — 2026-09-27

Status: **SOURCE/PACKAGE PASS / LIVE WB NOT RUN**

Task: controller-assigned `A04_WB_FBS_REQUIRED_BODY_AND_CONTINUE`.
Parent A head: `10d8e6903c1bc2446502251bde1f33a4f2dbe718`.
Observed `origin/main`: `84c3ba00a2c7f60f17bda414e0292f285cfd734e`.

## Defect

The frozen WB donor marks `fbs_order_statuses` (`POST /api/v3/orders/status`) as `body_required:false`.
That made local guidance publish a runnable empty template and allowed `normalizeCommand({operation:"fbs_order_statuses", params:{}})` to pass toward provider dispatch.

The donor under `migration/reference/wildberries-v0.3.0/**` remains byte-unchanged.

## Current provider authority

Checked 2026-09-27 against the current official Wildberries Orders FBS documentation:
`https://dev.wildberries.ru/en/docs/openapi/orders-fbs?locale=ru`.

For `POST /api/v3/orders/status`, the request body requires `orders`: an array of integer order IDs with documented cardinality 1..100. The provider example uses `{"orders":[5632423]}`.

No live marketplace request was used to infer this schema.
## Correction

Composition now loads a narrow registry overlay immediately after frozen `wb_operations.js`, before `WBContract` captures the registry:
- only `fbs_order_statuses.body_required` changes to `true`;
- method/path/other aliases remain inherited from the frozen authority;
- a drift guard fails if the frozen source no longer has the expected old shape.

A second narrow contract overlay loads after frozen `wb_contract.js` and before guidance captures the contract.
For `fbs_order_statuses` it requires:
- object body;
- exactly the `orders` field;
- 1..100 entries;
- every entry a JavaScript safe integer.

Invalid commands fail locally before provider transport. Other WB aliases use the existing contract unchanged.

Because guidance is built after both overlays, its operation card now reports required `body`, `template_runnable:false`, and `template:null`; help and execution therefore agree.

## Focused verification

Composed development package after correcting the official cardinality to 1..100:
- archive SHA-256: `c0bdcbb1d3acff410ceaf8fdcebd3cf51ac1958a55daa4335890942226411124`;
- `repeat_archive_match=true`;
- `source_extracted_bytes_match=true`;
- composed runtime and extracted package are built from the same final product bytes.

`wb-adapter.mjs` runs on both composed source runtime and extracted package:
- 23/23 scenarios PASS;
- new `WB-01b-fbs-statuses-required-body-help-and-predispatch` PASS;
- empty/missing body or orders: local rejection, zero provider calls;
- malformed order IDs: local rejection, zero provider calls;
- 101 IDs: local rejection, zero provider calls;
- unsupported extra body field: local rejection, zero provider calls;
- valid two-ID request: one fake transport call with the exact JSON body;
- guidance card cannot emit an empty runnable template.

The test transport is local/synthetic. `live_provider_calls=0`; this is not LIVE_WB or LIVE_OWNER acceptance.

## Full changed-runtime regression

Final frozen-byte run after correcting the official cardinality from the stale 1000 assumption to 100:

`python3 tooling/coordination/control.py A heavy --profile browser --timeout-seconds 3600 -- env PATH=/root/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin python3 tooling/checks/extension_core.py --output /tmp/a04-wb-fbs-100-extension-core-20260927-r1`

Result:
- resource job `ac8007ae06cb40c29d493d3d42094bd9`;
- command exit 0;
- `131/131` gates PASS;
- source `core-source-wb-adapter` PASS;
- extracted-package `core-package-wb-adapter` PASS;
- summary `status=PASS`;
- `live_provider_calls=0`;
- `installed_acceptance=false`;
- cleanup verified;
- OOM kills: 0;
- peak accounted bytes: 183500800;
- package SHA-256: `c0bdcbb1d3acff410ceaf8fdcebd3cf51ac1958a55daa4335890942226411124`.

The earlier commit-level run with a 1000-ID maximum is superseded by this corrected source/package evidence and must not be used as the provider-cardinality authority.
## Evidence boundary

This correction proves local contract/guidance/predispatch behavior in SOURCE and extracted PACKAGE.
It does not prove:
- a real WB account response;
- live owner business usefulness;
- installed store acceptance;
- deployment or production.

No marketplace credentials, private sessions or raw client data were used or recorded.

Next independent A04 work may continue after exact candidate handoff. The open controller review remains the authority for integration/acceptance; this receipt does not self-accept the candidate.
