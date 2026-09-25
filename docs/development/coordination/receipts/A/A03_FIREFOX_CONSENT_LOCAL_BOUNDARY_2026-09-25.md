# A03 — Firefox consent/local request projection boundary — 2026-09-25

Role: A
Task: A03 / FIREFOX_CONSENT_DISCLOSURE
Status: **LOCAL SOURCE + COMPOSED PACKAGE CANDIDATE; ACTIVE NETWORK WIRING NOT ENABLED; AMO NOT READY**

Baseline reconciled: `origin/main=c520015cfa2a4630d06b3013b9cd78aafde352da`.
Owner resumed A directly in the new dialogue under `STREAMS-AUDIT-20260925-0126`.
N2 is already integrated and was not changed or repeated.

## Actual outbound data map

| Flow | Destination / actual fields | Firefox category / disposition |
|---|---|---|
| Device authorization | Octoport `POST /v1/device-authorizations`: `browserFamily`, `browserVersion`, `extensionVersion`; device auth exchange separately carries device/auth material | browser/extension metadata = `technicalAndInteraction`; auth material = `authenticationInfo` |
| Bootstrap | Octoport `POST /v1/bootstrap`: `contractVersion`, `extensionVersion`, `browser.family/version`, `deviceId`, `lastConfigVersion`, optional `detectedAi` | technical metadata + `personallyIdentifyingInfo`; detected AI family/surface = `browsingActivity` |
| Health authority | Octoport `POST /v1/health-authority`: embeds the same bootstrap body plus signed bootstrap envelope | same categories as bootstrap; no separate uploaded diagnostic stream found |
| Sync metadata | Octoport `POST /v1/sync`: installation/device id plus bounded store/conversation/delivery metadata | primarily `personallyIdentifyingInfo`; current journal projection does not add browser/extension version |
| Marketplace APIs | Ozon/WB fixed provider hosts receive their saved provider credentials and allowlisted request data | credentials = `authenticationInfo`; provider responses remain local until explicit delivery |
| Explicit AI/report delivery | selected marketplace response/report text and explicit report files go to the chosen external AI surface | `websiteContent`; finance data can be `financialAndPaymentInfo`; permitted message/review/question data can be `personalCommunications`; search-visibility terms can be `searchTerms`; provider/account ids can be PII |

The reconciled required declaration from the earlier bounded candidate remains supported by current source:
`authenticationInfo`, `personallyIdentifyingInfo`, `browsingActivity`, `websiteContent`,
`searchTerms`, `financialAndPaymentInfo`, `personalCommunications`.
Current `origin/main` still declares only `authenticationInfo` and `personallyIdentifyingInfo`;
A keeps the previously reviewed disclosure correction instead of silently accepting that stale manifest.

`technicalAndInteraction` is deliberately **not** added to the manifest yet. Firefox makes this category optional,
while the current strict server contract still requires the metadata. Declaring it optional while continuing
unconditional transmission would be a false privacy fix.

## Local seam implemented

New `packages/control-client/src/technical-data-consent.js`:
- recognizes only the Firefox family through the existing packaged browser identity;
- treats Firefox `permissions.getAll().data_collection` as the source of truth;
- treats missing API, missing `data_collection`, or permission-query failure as **not granted**;
- exposes an explicit `requestFromUserGesture()` path and a `revoke()` path;
- stores no parallel consent bit and therefore survives restart by re-reading Firefox permission state;
- re-queries consent on every `projectControlRequest(...)`, so revocation is observed before the next projection;
- projects three exact future request shapes: device authorization, bootstrap, and health authority;
- removes browser family/version and extension version only in the projected Firefox opt-out body;
- preserves Chromium/Opera/Yandex behavior without even querying Firefox permissions.

The module is included in `apps/extension/composition.json` so source and extracted runtimes carry the seam.
It has no startup side effects.

## Safety boundary

`packages/control-client/src/client.js` is **not wired to this projection yet**.
Existing request bodies therefore remain byte/shape compatible with the current strict endpoints.
No malformed metadata-free request was enabled and no server/shared schema was changed.
The Firefox builder also does not yet declare optional `technicalAndInteraction`.

This is intentional: local implementation can be reviewed independently while C/B finish the server-first contract.
## Exact interface requirement handed to C/B

C owns the shared wire/signature decision; B owns the server implementation.
For A to wire the local seam safely, the accepted contract must provide a deterministic privacy-neutral path where:

1. Firefox device authorization accepts technical metadata being absent instead of requiring placeholder/null values.
2. Bootstrap and Health's embedded bootstrap accept `browser` and `extensionVersion` being absent on opt-out.
3. Declining technical metadata does not by itself disable normal Octoport functionality.
4. Unsupported/unknown browsers still fail closed locally; opt-out is not a browser-support bypass.
5. Compatibility/profile/bootstrap authority remains deterministic and signed without inferring undisclosed browser/version.
6. Chromium/Opera/Yandex request shapes stay unchanged unless C intentionally generalizes the contract.
7. No new raw report/chat/credential material is added to Octoport control-plane requests.
8. A may then wire the projection immediately before each relevant send, add optional Firefox manifest permission,
   add the explicit user-gesture UI, and prove real grant/decline/revoke behavior in Firefox.

## Tests

Focused Node 24.20.0 seam test:
- grant: PASS;
- decline: PASS;
- missing permission shape: fail-closed PASS;
- permission-query failure: fail-closed PASS;
- restart reads Firefox permission again: PASS;
- revoke before next projection: PASS;
- Chromium unchanged/no Firefox permission query: PASS;
- bootstrap/Health technical-field projection and input immutability: PASS.

Supervised full `extension_core` after adding the seam to composition:
- status: PASS;
- Node: `v24.20.0`;
- gate processes: 123;
- source consent gate: PASS;
- extracted-package consent gate: PASS;
- store package contract: PASS;
- live provider calls: 0;
- installed acceptance: false;
- resource job exit: 0; peak 136 MiB; cleanup verified.

Evidence: `/root/octoport-control/logs/A/A03_FIREFOX_CONSENT_LOCAL_20260925_R3/summary.json`.
## Remaining acceptance

Firefox remains **NOT READY FOR AMO/publication**.

After C/B provide the compatible server-first contract, A still must:
- wire the pre-send projection into the real control client;
- add `technicalAndInteraction` as an optional Firefox data-collection permission, not required;
- provide an explicit Firefox user-gesture grant/decline/revoke UX without a second authorization system;
- prove normal product functionality after decline;
- prove no forbidden technical metadata leaves the browser after decline/revoke;
- run deterministic Firefox package checks, web-ext lint, and real Firefox grant/decline/revoke installed evidence.

The previous temporary-install/package evidence does not satisfy these remaining gates.
Mozilla references rechecked for this boundary:
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/add-on-policies/
