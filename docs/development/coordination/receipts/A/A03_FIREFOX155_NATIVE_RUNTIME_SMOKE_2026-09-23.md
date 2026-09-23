# A03 — Firefox 155 native runtime smoke and functional-harness boundary — 2026-09-23

Status: **REAL VENDOR RUNTIME SMOKE PASS / FULL WORK-OZON-WB MATRIX OPEN**
Role/task: `A / A03`
Exact A product head: `0755f7c75db7f78e0c6d8ae9591665f63e61ee59`

This receipt strengthens the earlier Firefox package/install smoke with actual popup-to-background runtime execution. It does not claim the full Work/Ozon/WB matrix, LIVE_OWNER, AMO publication, deployment, or production acceptance.

## Exact Firefox carrier

The post-A06 exact common runtime was converted through the existing deterministic Firefox carrier builder.

Evidence:
`/root/octoport-control/logs/A/A03_FIREFOX155_NATIVE_0755f7c/`

Firefox package SHA-256:
`35483dd34080d27e3d772be23384eb8c63dbee555cd0bf1f83fb0d44118ae9f2`.

Browser:
- Mozilla Firefox `155.0.1`;
- existing official Mozilla vendor artifact already SHA-verified in the earlier Firefox receipt;
- isolated executable under `/root/octoport-control/browsers/A/firefox-155.0.1/`.

## Native runtime smoke

Selenium 4.49.0 / GeckoDriver temporary-add-on installation was run inside the A browser cgroup. Firefox 138+ system-access requirements were respected by the driver configuration; browser security checks were not bypassed.

Result: **PASS**.
- browser-reported version: `155.0.1`;
- installed add-on ID: `seller-agents@example.test`;
- real `moz-extension://` popup loaded;
- popup successfully communicated with the Firefox background runtime;
- expected signed-out account state was returned.

Result file:
`/root/octoport-control/logs/A/A03_FIREFOX155_NATIVE_0755f7c/native-smoke-result.json`.

Resource receipt:
`/root/octoport-control/resource-jobs/e5ba142efd1f4577a10ac7e39c89ed6b/receipt.json`
— exit 0, peak 708 MiB, cleanup verified.

## Functional-harness investigation

A separate synthetic-trust Firefox carrier was prepared only for installed-synthetic functional probing:
- common synthetic-trust package SHA-256: `a5e4a25774f0278d4e115b0e84023f469a5bd9723db079df176803bc4d83da77`;
- Firefox carrier SHA-256: `c052066f8adfd01af97401e30d4b9298bb89f3ebd1d23ab93cf05698ecf22c54`;
- private synthetic signing key remained local, mode 0600, and is not part of Git/evidence text.
Three bounded attempts did not reach marketplace import:
1. Cross-realm popup→background objects were rejected by strict canonical JSON as `INVALID_CANONICAL_VALUE`. This was classified as a harness realm issue, not product failure.
2. After realm-safe cloning, storage seeding succeeded, but the already initialized `SellerAgentsControlClient` remained signed out because it restores persisted state once at background startup. This matched the existing Chromium harness requirement to restart the extension context after seeding.
3. Calling `browser.runtime.reload()` for the temporary Firefox add-on tore down the active Marionette session and Selenium returned `Failed to decode response from marionette`.

The third attempt was stopped under the project three-attempt rule. No product check was weakened and no failure was relabeled as PASS.

Relevant local evidence root:
`/root/octoport-control/logs/A/A03_FIREFOX155_FUNCTIONAL_0755f7c/`.

Resource jobs for failed harness attempts completed with their own cgroup cleanup. No provider/business request was used.

## Disposition

Proven at exact `0755f7c`:
- real Firefox 155.0.1 starts;
- exact Firefox carrier installs under its real Gecko add-on ID;
- actual popup executes and talks to the Firefox background runtime.

Still open:
- full Firefox Work/Ozon/WB installed-synthetic matrix;
- a harness method that preserves/restarts the temporary add-on while retaining controllable automation;
- signed AMO/self-distributed release route and real update;
- LIVE_OWNER acceptance.

The open functional-matrix item is a harness/control-method gate after three bounded attempts, not evidence of a Firefox product defect.
