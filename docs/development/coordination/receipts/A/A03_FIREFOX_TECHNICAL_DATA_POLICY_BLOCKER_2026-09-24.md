# A03 — Firefox technical-data policy blocker — 2026-09-24

Role: A
Task: A03 / FIREFOX_TECHNICAL_DATA_POLICY
Status: **CROSS-OWNER CONTRACT BLOCKER CONFIRMED / NO FALSE MANIFEST FIX APPLIED**

## Current Mozilla policy checked

Primary Mozilla sources checked on 2026-09-24:
- Firefox built-in consent for data collection and transmission:
  https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- Add-on Policies:
  https://extensionworkshop.com/documentation/publish/add-on-policies/

Mozilla classifies device/browser information as `technicalAndInteraction`.
That data-collection permission cannot be required; it must be optional.
Mozilla policy also requires that add-on functionality not be restricted when the user declines transmission of technical/user-interaction data.

Therefore declaring `technicalAndInteraction` as optional is only truthful if the runtime actually stops transmitting this data when permission is declined and still preserves normal add-on functionality.

## Current Octoport dependency

Firefox builder:
- `tooling/build/extension_firefox.py`
- current `data_collection_permissions.required` declares the already-audited business/auth data categories;
- it does not declare `technicalAndInteraction`.

A-owned control client:
- `packages/control-client/src/client.js`
- device authorization sends `browserFamily`, `browserVersion`, and `extensionVersion`;
- bootstrap sends mandatory `browser: { family, version }`;
- cache binding and Work authority validation also bind to local browser family/version.

Shared C-owned contract:
- `packages/contracts/src/index.ts`
- `BootstrapRequestShape.browser` is mandatory and requires both family and version.

Server/B-owned bootstrap path:
- `packages/server/bootstrap/src/index.ts`
- bootstrap policy resolution and AI profile resolution consume the browser object;
- Health authority follows the same bootstrap browser dependency.

This means the current implementation transmits Firefox browser metadata as a functional prerequisite. A cannot truthfully make `technicalAndInteraction` optional in the manifest while leaving that transmission mandatory.

## Current integrated-store evidence

C built the current-main Firefox STORE package from `4ae52bb7d79ca02487cf70f9966dac5530c14e8f`:
- package: `/root/octoport-control/logs/C/store-release-4ae52bb/OCTOPORT_v0.2.4_FIREFOX_STORE.zip`;
- SHA-256: `713e2a857974da3a3b94bcf6d66fe226e46e8de64c55ae4815d0e2fc19ff8ece`;
- its `manifest.json` declares only required `authenticationInfo` and `personallyIdentifyingInfo`; it does not declare `technicalAndInteraction`;
- the composition receipt explicitly records `installed_acceptance: false`.

The current source still makes browser metadata mandatory in the relevant control-plane path: `packages/control-client/src/client.js` sends browser family/version for device authorization and bootstrap, while `BootstrapRequestShape.browser` in `packages/contracts/src/index.ts` requires both `family` and `version`. Therefore the freshly composed STORE package does not remove this blocker and must not be treated as AMO-ready/publication acceptance.
## Required cross-owner decision / acceptance

A requests controller/C assignment for one bounded shared-contract change.

Acceptance must prove all of the following:

1. Firefox can decline technical-data transmission and the client then omits browser family/version from outbound control-plane requests covered by Mozilla's technical-data category.
2. Declining that transmission does not by itself disable normal Octoport functionality.
3. Unsupported/unknown local browsers still fail closed locally; privacy opt-out must not become a browser-support bypass.
4. Shared bootstrap/device-authorization schemas and server policy have an explicit reviewed browser-metadata-absent path rather than invented placeholder values.
5. Signed Work authority, cache binding, compatibility and AI profile selection remain deterministic and fail closed for malformed/unknown state.
6. Chromium/Opera/Yandex behavior remains unchanged unless the shared design intentionally generalizes the privacy control.
7. After the shared change is accepted, A can wire Firefox's built-in optional `technicalAndInteraction` permission and local opt-out behavior, then repeat Firefox package/install tests.
8. No raw user data, marketplace payload, credentials, cookies or conversation content are added to the control plane.

A must not modify C-owned shared contracts or B-owned server/bootstrap files without assignment.

## Current disposition

Firefox source/package/temp-install evidence remains valid for the previously tested scope, but AMO-ready/publication acceptance remains **OPEN**.

No manifest change was made in this step because adding an optional declaration without implementing a real opt-out would misrepresent runtime behavior.

Independent A product work has now exhausted the currently ready queue:
- N2 client read rollout is integrated in `main` at `4ae52bb7d79ca02487cf70f9966dac5530c14e8f`;
- Opera reviewer assets are already prepared and must not be regenerated;
- ordinary installed owner marketplace import requires owner-authenticated profile access;
- Yandex stable/store update route is external;
- Firefox full functional matrix remains a previously recorded harness/install-route gate;
- Firefox AMO technical-data compliance now requires the cross-owner contract decision above.
