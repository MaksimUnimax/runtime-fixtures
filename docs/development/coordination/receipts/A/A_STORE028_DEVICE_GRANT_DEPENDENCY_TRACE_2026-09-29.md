# A — STORE 0.2.8 device-grant dependency trace — 2026-09-29

Status: **SOURCE TRACE PASS / NO PRODUCT CYCLE / OPERATOR CREDENTIAL PATH STILL BLOCKED**

Task: `A_EXACT_TECHNICAL_LIFECYCLE_REMAINDER_20260929`.

## Authority and scope

This is source-only dependency evidence requested by
`A-L2-CURRENT-DELIVERY-BLOCKER-20260929T0926Z`.

No browser authentication, live device authorization, provider request, AI send,
catalog POST, secret extraction, token export, or production mutation was executed.

Source basis before this receipt commit:

- A HEAD: `352b17157a4debb5dd412efc49d872b4ce5be884`
- current main observed: `3f56c947bff1268af70e7625852e930b1a0f6d69`
- C release/preflight head: `c55186907a050d70b0118194e5e084ae9d36aee4`

The relevant source blobs are byte-identical across all three identities:

| Path | Blob |
|---|---|
| `packages/control-client/src/client.js` | `c5a6f878593534ef93b9ed71bdc8c01234df67d1` |
| `apps/api/src/device-authorization-routes.ts` | `efe86e18854bf60ef3c0d7325e19b59fd4ab911b` |
| `apps/api/src/device-management-routes.ts` | `766efadc46d9bc2d9d542770d76857fd63c905a9` |
| `packages/server/device-auth/src/index.ts` | `af99192e0e1171e062edf6a441d74def80e06475` |
| `packages/server/device-management/src/index.ts` | `35a49758074136e7dcbd1f8d92917ad01f070efb` |
| `packages/server/db/src/device-management-repository.ts` | `d34cdf984bad0a87e55a7b4ad242df25df45a7fe` |
| `packages/server/db/src/device-authorization-repository.ts` | `2223185d52e1c058c9b6a40bb279b134c0ac9574` |
| `apps/api/src/main.ts` | `0e90acf55d00af156678f35e16dcfb6d5c34aa5b` |
| `apps/api/src/bootstrap-routes.ts` | `5e5c8a92a75aa49f217a32c7545a09ef5c6e2559` |
| `packages/server/bootstrap/src/index.ts` | `03044c8501697a71446ae161cb0bdbe3daee007d` |
| `packages/server/remote-config/src/index.ts` | `48d88f777217c8c5472a6e28e2bc8b83dc43083c` |

## Finding

**Normal device grant does not require the target STORE 0.2.8 compatibility
release/policy/config to be active.**

The product order is:

1. The extension starts normal device authorization with
   `POST /v1/device-authorizations`.
2. Portal approval validates the authenticated portal session, CSRF, user code,
   active account and OWNER membership.
3. `POST /v1/device-authorizations/token` exchanges the approved device code.
   The device-management path validates authorization state, beta/commercial
   admission and active-device limits, then creates the device/session and issues
   access + refresh credentials.
4. Only after credentials are committed does the client invoke
   `POST /v1/bootstrap`.
5. The versioned V2 bootstrap then resolves config + compatibility, including
   `findExtensionRelease(extensionVersion)`, compatibility policies, browser
   support and config material.

Therefore the missing target 0.2.8 catalog entries cannot be the reason a fresh
normal 0.2.8 device bearer cannot be issued. They can affect the **subsequent
bootstrap/work authority**, not the grant/token-exchange itself.

## Exact source evidence

### Client ordering

`packages/control-client/src/client.js` performs the token exchange first.
After a valid exchange it commits `credentials` and only then calls
`bootstrap({ context: bootstrapContext })`.

The same client deliberately keeps access/refresh credentials in privileged
extension storage. The existing A technical-auth helper uses the normal device
flow but intentionally does not serialize bearer or refresh-token bytes.

### Device authorization start + approval

`DeviceAuthorizationService.start()` creates only the pending authorization
record and client metadata.

`DeviceAuthorizationService.approve()` and the DB repository require:
- valid user code;
- live authorization state/TTL;
- active portal user;
- active account;
- OWNER membership;
- rate limits.

They do not query compatibility release, compatibility policy, config release,
AI profile, assignment, or bootstrap policy.

### Token exchange

`DeviceManagementService.exchange()` and
`createDeviceManagementRepository().exchange()` require:
- approved device authorization;
- account/user still active;
- beta or commercial admission;
- active-device limit;
- exchange rate/idempotency/replay rules.

They then create the device/session/refresh record and issue the bearer.

The resolver wired in `apps/api/src/main.ts` uses beta admission or commercial
subscription/device admission. It does not call the compatibility catalog.

### Bootstrap is the later compatibility boundary

`/v1/bootstrap` first authenticates the already-issued extension bearer.

For identified V2 bootstrap, `BootstrapService.issueV2()` calls the bootstrap
policy resolver. `resolveP3BootstrapPolicy()` reads the V2 config release,
compatibility policy revisions and the extension release for the requested
extension version before producing the signed compatibility snapshot.

That is the first target-version compatibility/catalog dependency in this chain.

## Current delivery implication

There is **no product-level circular dependency** of the form
“publish 0.2.8 catalog before a normal 0.2.8 device can receive credentials.”

The current C blocker is instead an **operator/tooling safety boundary** around
producing a fresh protected `reviewerDeviceBearerFile` for the Store1 preflight.

A verified:
- current Store1 preflight requires a separate protected mode-0600 reviewer bearer file;
- A technical-auth does not export bearer bytes from its protected browser profile;
- no supported profile-to-bearer exporter exists in the current accepted tooling;
- historical protected 0.2.6/0.2.7 bearer files have prior-version device receipts
  and expired access-token windows and must not be reused.

A will not extract secrets from extension storage, reuse historical bearer
material, invoke temporary low-level C issuance scripts as a workaround, or add
a new secret-export path without the C/controller-approved security design.

## Release boundary

Per `C-L2-RELEASE-BOUNDARY-20260929T0926Z`, unrelated site-only main movement
does not restart the already accepted STORE 0.2.8 delivery boundary. The frozen
package remains:

- package source: `8c6ade801b7441f0b64eb850f46b86c4b61dc39e`
- source tree: `d2dcd6adc4c96f9fa9a7b743a0d1abd82485740f`
- Chromium SHA-256:
  `63943ebc63f37fa4c8718ae252149dfd2b90a1d9dbc4b9637d35023f0c15ae48`
- package authority SHA-256:
  `8efaca0baed645410513fe0ce1bf7193a06b6de7c9872b43d483b1c882f0ad43`

## Next

C/controller must provide or authorize a supported secure path that creates a
fresh normal 0.2.8 reviewer device bearer without exposing it and without
bypassing tool safety. Then C can perform signed read-only preflight, bounded
ordinary-admin activation and final bootstrap.

After C sends compatibility DONE, A immediately runs the already prepared exact
installed lifecycle and closes the 31-row PASS/FAIL/NOT_TESTED matrix.
