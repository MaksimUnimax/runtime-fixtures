# A02 current-main durable transfer reconciliation — 2026-10-07

Status: **SOURCE/CURRENTITY PASS — historical INSTALLED_SYNTHETIC evidence preserved; NOT new installed/live/deployment acceptance**

Task: `A02-CURRENT-MAIN-DURABLE-TRANSFER-RECONCILIATION-R1-20261007`
Role: A
Exact current main: `19fc0ca6abbc09bec573a69ed8903cbbd445e3a1`
Tree: `05c05b63b6c99c1123a2a5a6d5a77b01da556e23`

## Why this result exists

PLAN A02 describes the historical MV3 failure mode where a recipient private key existed only in worker memory and disappeared when the service worker stopped. The accepted implementation no longer has that architecture: the non-extractable P-256 recipient key and request lifecycle are durably persisted in the extension-origin IndexedDB vault implemented by `packages/control-client/src/credential-transfer.js`.

The implementation and installed-synthetic restart evidence were accepted historically. This task is currentity reconciliation only: determine whether later client, popup, runtime or test-harness changes invalidate the accepted restart/replay semantics on the exact current main. It does not reimplement transfer, build a STORE release, perform browser acceptance or claim LIVE_OWNER/deployment behavior.

## Canonical prior evidence

The currentity decision preserves the evidence levels of these accepted receipts:

- `docs/development/coordination/receipts/A/A02_MV3_TRANSFER_RECOVERY_2026-09-23.md`
- `docs/development/coordination/receipts/C/C02_A02_B03_JOINT_RESTART_ACCEPTANCE_2026-09-27.md`
- `docs/development/coordination/receipts/A/A04_TWO_INSTALL_KEY_TRANSFER_2026-10-01.md`
- `docs/development/coordination/receipts/B/B03_CURRENT_MAIN_JOINT_ACCEPTANCE_RECONCILIATION_2026-10-04.md`

Those receipts remain historical evidence for durable key recovery, one-time receive/import/ACK behavior, replay fencing, restart handling, expiry/reset and account/device isolation at their exact accepted artifacts.

## Exact `19fc` currentity proof

Machine proof:

/root/octoport-control/logs/A/a02-current-main-durable-transfer-reconcile-20261007/MACHINE_PROOF_19FC_R2.json
SHA-256: `5e7fb81868778840519c1ca0214b7e112a1ed126395be5b7933a48edc1d5cb3c`

The two files that directly establish the original A02 MV3 persistence property are still byte-identical to the accepted A02 implementation:

| Path | Original A02 blob | exact `19fc` blob | Result |
| --- | --- | --- | --- |
| `packages/control-client/src/credential-transfer.js` | `2ab75f1cf157827e0a9559a373e1b382f47006be` | `2ab75f1cf157827e0a9559a373e1b382f47006be` | unchanged |
| `tests/regression/extension-core/client-i1/browser_transfer_vault_restart.py` | `ee395ef56da6b976a52e28070eeee491e6b4dacc` | `ee395ef56da6b976a52e28070eeee491e6b4dacc` | unchanged |

The five B03 protocol/server blobs remain byte-identical to the publication-backed accepted reconciliation:

- `packages/server/credential-transfer/src/index.ts` — `db519266951c79c962aa143ad4f09ba103910184`
- `packages/server/credential-transfer/src/credential-transfer.test.ts` — `2e28d6526d2cf61a5ec905b7702aa83798af9c39`
- `apps/api/src/credential-transfer-routes.ts` — `6d26c7503a2050717cf32e7bdcaa30eaba99c706`
- `apps/api/src/credential-transfer-routes.test.ts` — `85b871311d4433fb18818e8fee4a68c4e46da2fd`
- `packages/control-client/src/credential-transfer.js` — `2ab75f1cf157827e0a9559a373e1b382f47006be`

## Drift from the previous `e0cb` reconciliation

The earlier accepted-source reconciliation was written against `e0cb3944e2fa734ad502a905c1a1a042215f18a0`. Comparing its transfer-semantic inventory with exact `19fc` shows no product-semantic drift in the tracked credential-transfer client/popup/runtime/protocol paths. Two adjacent changed paths are classified explicitly rather than omitted:

1. `tooling/checks/extension_core.py`
   - `e0cb` blob: `20f1d966df8b483dc70c476125f0d71ba935301a`
   - `19fc` blob: `429c35ad09a35d2caf586dc32d046a2b047ef8bd`
   - classification: **unrelated provider-neutral test-runner registration**
   - the diff only adds four provider-response differential runners (policy, verifier, disposition and retention) before the existing composition flow; it does not change credential-transfer/recipient wiring or focused A02 semantics.

2. `apps/extension/src/application/popup.css`
   - `e0cb` blob: `934171ad7a9f1a70db8321c16498bbcad78e4fc7`
   - `19fc` blob: `f0a841fd4eff86cbcc6b3a30f9f21e78da3c34fe`
   - classification: **presentational hover styling only, outside A02 transfer semantics**
   - this is the separately accepted/published hover-cascade fix from `A04-BUTTON-HOVER-CASCADE-FRESH-MAIN-R2-20261007`; it adds hover styling for the primary and selected marketplace buttons and changes no JavaScript, credential-transfer state, request/ACK flow or recipient-vault behavior.

`MACHINE_PROOF_19FC_R2.json` records both classes and leaves no unclassified A02-relevant drift.

## Exact-current focused verification

A fresh local-development composition was generated from exact `19fc` only for source/currentity checks. It is not installed acceptance.

Composition evidence:

`/root/octoport-control/logs/A/a02-current-main-durable-transfer-reconcile-20261007/COMPOSITION_RECEIPT_19FC.json`
SHA-256: `0f75be51b5266b3528159c943f86fd0b5974e553760abaa03f68c0c3291c5c1b`

### Recipient recovery matrix

Evidence:

`/root/octoport-control/logs/A/a02-current-main-durable-transfer-reconcile-20261007/TRR_19FC.log`
SHA-256: `7e2ce72d7db77f98b330d8c2b213c21383d6f8ac9789061ae947e886e1e476e4`

Result: **PASS**, 14 cases, failures empty.

The matrix covers vault failure before POST, worker restart/private-key recovery, durable import before ACK, lost ACK/create response recovery, reset, expiry pruning, concurrent receive/idempotency, reauth fencing, source-store selection and empty-packet failure.

### Popup transfer receive

Evidence:

`/root/octoport-control/logs/A/a02-current-main-durable-transfer-reconcile-20261007/POPUP_TRANSFER_19FC.log`
SHA-256: `6c49e0fd7ad2d1422c96466f0a96d0a2db1055212eba26f1bf49e9d3ccd97358`

Result: **PASS**, 9 cases.

### Auth/network correctness for transfer

Evidence:

`/root/octoport-control/logs/A/a02-current-main-durable-transfer-reconcile-20261007/NETWORK_CORRECTNESS_19FC.log`
SHA-256: `578280d79a716474f095afb7e20d9bb0e9cfe7e2a6165f02c9eda08e6e51b244`

Result: **PASS**.

The current client keeps bounded refresh/retry semantics fail-closed and preserves the transfer request path after access-token refresh.

## Why no new heavy browser/DB rerun is justified

The A02 property that motivated the original repair — persistence of the non-extractable recipient private key across MV3 worker/browser-context restart — still uses the exact accepted vault implementation and exact accepted restart harness. The five bounded B03 protocol/server blobs are also unchanged.

The wrapper drift that existed at the earlier `e0cb` reconciliation is exercised by the current source-level recovery, popup and network regressions. Between `e0cb` and `19fc`, no tracked transfer product input changed. The only classified adjacent drift is the unrelated provider-response runner registration in `extension_core.py` and the separately published `popup.css` hover-style correction; neither changes transfer state or dataflow.

Repeating the historical installed/browser scenario therefore adds no new A02 dimension. A future change to the vault implementation, restart harness, B03 protocol slice or transfer semantics must trigger re-evaluation.

## Historical publication blocker is closed

The obsolete registration `b7c9746d5178d5e6bf6ffb27c9bb87e37a3e387d36d7dafcf93fb95a43c8a678` for the old `e0cb` receipt candidate was governed-retired after proving it had never started a push and its exact task ref was absent.

Final state: **CLOSED**
Retirement outcome: `NEVER_PUBLISHED_CONFIRMED_ABSENT`
Close receipt SHA-256: `02a6bde6dd8993fdc272a034c023be38f7ec0f6f0e093d53cb1a6bf3b9212fd8`

That lifecycle closure removes the stale publication blocker. It is not product/source acceptance and does not authorize replaying the old task-ref push.

## Evidence boundary

This receipt establishes only:

- **SOURCE/CURRENTITY PASS** for the A02 durable-transfer boundary on exact main `19fc0ca6…`;
- the durable vault and restart harness remain exact accepted bytes;
- all five B03 protocol/server blobs remain exact accepted bytes;
- current popup/client/auth wrapper behavior is covered by focused source regressions;
- historical installed-synthetic evidence remains historical evidence for its exact artifacts.

This receipt does **not** establish fresh installed package acceptance, STORE acceptance, LIVE_OWNER acceptance, deployment or production behavior. It does not authorize browser/UI/QA actions or transfer marketplace credentials.

## Disposition

**PASS — SOURCE/CURRENTITY only.**

No A02 product-source change is required on exact `19fc`. No heavy browser/DB rerun is justified by the inspected drift. This refreshed one-path receipt requires independent exact review and the normal governed publication/strict-completion route before the task is DONE.
