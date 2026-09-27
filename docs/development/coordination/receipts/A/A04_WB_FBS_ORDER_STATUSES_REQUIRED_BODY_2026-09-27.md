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

Checked 2026-09-27 against the current machine-readable mirror of the Wildberries Orders FBS OpenAPI maintained at `eslazarev/wildberries-sdk`.
Its `generation.yaml` points `03-orders-fbs.yaml` directly at the official upstream `https://dev.wildberries.ru/api/swagger/yaml/ru/03-orders-fbs.yaml?region=ru`; current mirror blobs observed were `generation.yaml=43ac4287e0afe98f273fd00f1a89bdf6c6229565` and `specs/03-orders-fbs.yaml=7965dedd6851edf0e37b3109149d9d323e32e710`.

For `POST /api/v3/orders/status`, that current mirrored upstream schema requires `orders`: an array of integer order IDs with `minItems: 1` and `maxItems: 1000`. The provider example uses `{"orders":[5632423]}`.

Direct automated retrieval of the official WB page/raw YAML returned HTTP 498 on this server, including through real Opera, so this receipt does not mislabel the mirror as a live official-page fetch. No live marketplace request was used to infer this schema.
## Correction

Composition now loads a narrow registry overlay immediately after frozen `wb_operations.js`, before `WBContract` captures the registry:
- only `fbs_order_statuses.body_required` changes to `true`;
- method/path/other aliases remain inherited from the frozen authority;
- a drift guard fails if the frozen source no longer has the expected old shape.

A second narrow contract overlay loads after frozen `wb_contract.js` and before guidance captures the contract.
For `fbs_order_statuses` it requires:
- object body;
- exactly the `orders` field;
- 1..1000 entries;
- every entry a JavaScript safe integer.

Invalid commands fail locally before provider transport. Other WB aliases use the existing contract unchanged.

Because guidance is built after both overlays, its operation card now reports required `body`, `template_runnable:false`, and `template:null`; help and execution therefore agree.

## Focused verification

The forward correction restores the FBS runtime/test inputs byte-for-byte to the previously validated `d8ff3bad` 1000-ID implementation:
- contract overlay SHA-256: `3d920a1b24eeeabdb9c21f6020b1f1b77ca858cbf6f39a0ee132a091f6faff55`;
- registry overlay SHA-256: `72d4573a0f5208183a894e26952bf205b1e56414c33510e08fecb13b34a4c774`;
- composition SHA-256: `bd35880326944c506de5532b87e4c369733f19e12f97ee38dfbad95951a75f22`;
- WB adapter regression SHA-256: `0645ad4c6c51dcc4e75f53e45ed0100958550315131ff6000df739122622803c`;
- validated package archive SHA-256: `78ac291975b2ff9836e2f238b0030ddeaf9d1cf0d3331c6846a89adafe3d7465`.

`wb-adapter.mjs` runs on both composed source runtime and extracted package:
- 23/23 scenarios PASS;
- new `WB-01b-fbs-statuses-required-body-help-and-predispatch` PASS;
- empty/missing body or orders: local rejection, zero provider calls;
- malformed order IDs: local rejection, zero provider calls;
- 1001 IDs: local rejection, zero provider calls;
- unsupported extra body field: local rejection, zero provider calls;
- valid two-ID request: one fake transport call with the exact JSON body;
- guidance card cannot emit an empty runnable template.

The test transport is local/synthetic. `live_provider_calls=0`; this is not LIVE_WB or LIVE_OWNER acceptance.

## Full changed-runtime regression

The restored 1000-ID runtime is byte-identical to the final frozen-byte run already completed before the erroneous 100-ID follow-up:

`python3 tooling/coordination/control.py A heavy --profile browser --timeout-seconds 3600 -- env PATH=/root/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin python3 tooling/checks/extension_core.py --output /tmp/a04-wb-fbs-required-body-extension-core-20260927-r2`

Result:
- resource job `78383589f22b432faa239dc067174c29`;
- command exit 0;
- `131/131` gates PASS;
- source `core-source-wb-adapter` PASS;
- extracted-package `core-package-wb-adapter` PASS;
- cleanup verified;
- OOM kills: 0;
- peak accounted bytes: 181403648;
- package SHA-256: `78ac291975b2ff9836e2f238b0030ddeaf9d1cf0d3331c6846a89adafe3d7465`.

Current worktree focused rerun against both that source runtime and extracted package is again `23/23 PASS`.
The published intermediate commit `78e96213` that reduced the maximum to 100 is therefore a superseded implementation error and is corrected forward; history is not rewritten.
## Evidence boundary

This correction proves local contract/guidance/predispatch behavior in SOURCE and extracted PACKAGE.
It does not prove:
- a real WB account response;
- live owner business usefulness;
- installed store acceptance;
- deployment or production.

No marketplace credentials, private sessions or raw client data were used or recorded.

Next independent A04 work may continue after exact candidate handoff. The open controller review remains the authority for integration/acceptance; this receipt does not self-accept the candidate.
