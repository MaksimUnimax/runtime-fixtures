# A03 — Firefox data-flow disclosure correction — 2026-09-24

Role: A
Task: A03 / FIREFOX_DATA_FLOW_DISCLOSURE
Status: SOURCE + PACKAGE + TEMPORARY_VENDOR_INSTALL CANDIDATE; AMO NOT CLAIMED
Controller assignment: ACTIVE-STREAM-AUDIT-20260924-0944

## Trigger

The frozen Firefox STORE package from accepted main `f079c2e7199250397259ea9ede10a4f72694f5c1`
declared only `authenticationInfo` and `personallyIdentifyingInfo`.
That was incomplete because Firefox disclosure covers data transmitted outside the add-on/local browser,
including selected marketplace response/report content delivered to the external AI.

Primary Mozilla references checked 2026-09-24:
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/add-on-policies/
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings

Mozilla's current documentation states that new AMO submissions must declare collected/transmitted data,
that transmission includes data handled outside the add-on/local browser, and that websiteContent includes
request/response information. Firefox desktop built-in consent is available from Firefox 140.

## Actual outbound data map

Own Octoport control plane:
- device authorization / refresh carries account-service authentication material => authenticationInfo;
- signed bootstrap/sync carries bounded account/device/session/installation/store identifiers => personallyIdentifyingInfo;
- bootstrap/Health carries the detected supported AI family/surface for the current dialogue => browsingActivity;
- browser family/version and extension version are also sent for compatibility; see the separate technical-data limit below.

Marketplace APIs:
- Ozon Seller/Performance and WB requests send their saved credentials only to their respective provider APIs => authenticationInfo;
- responses are locally bounded/sanitized and are not uploaded wholesale to the Octoport server;
- selected response/report content can then be explicitly delivered to the chosen external AI.

External AI delivery in the submitted read-only scope:
- marketplace API request/response/report content and generated/original report files => websiteContent;
- Ozon has 23 enabled finance operations and WB has 7 enabled finance operations, including balances,
  cash-flow/sales/acquiring/realization/transaction-style reports => financialAndPaymentInfo;
- Ozon has enabled chat-history/review/comment/question/answer reads and WB has enabled feedback/question reads;
  free-form communication content is delivered only through the existing personal-data gate where applicable
  but can leave the browser for the chosen AI => personalCommunications;
- Ozon exposes four enabled search-visibility operations returning marketplace search-query terms,
  which can be explicitly delivered to the chosen AI => searchTerms;
- provider/account/store/customer identifiers can be present in permitted results, with existing projection/gating,
  and are already covered by personallyIdentifyingInfo.

The required Firefox declaration is therefore:
`authenticationInfo`, `personallyIdentifyingInfo`, `browsingActivity`, `websiteContent`,
`searchTerms`, `financialAndPaymentInfo`, `personalCommunications`.

Not added:
- healthInfo, locationInfo, bookmarksInfo: no supported outbound flow was found in this scope;
- websiteActivity: no mouse/keyboard/scroll/click history stream is transmitted as product telemetry;
- technicalAndInteraction: Mozilla defines device/browser information as this category, but it cannot be required.
  Current shared control-plane auth/bootstrap requires browser family/version for compatibility.
  A cannot safely declare it optional without also gating/removing that transmission, which would require a
  cross-owner control-plane decision. This remains an explicit AMO review question/blocker rather than a false PASS.

## Source change

A-owned Firefox packaging only:
- `tooling/build/extension_firefox.py` emits the corrected required data categories;
- `firefox-package-contract.mjs` asserts the exact declaration;
- `store-package-contract.py` asserts the exact Firefox STORE declaration.

No Chromium builder/runtime, marketplace runtime, shared contract, backend, DB, migration or lockfile is changed.

## Frozen-runtime package evidence

To avoid pulling optional N6c into the first frozen store candidate merely for this correction, the rebuilt
Firefox carrier used the exact extracted Chromium STORE runtime from accepted main `f079c2e` as input.

Previous frozen Firefox STORE ZIP:
- SHA-256 `f794d225e2d6a4d18681c32293089536be8b2778b156717f35693d6a8a717626`.

Corrected frozen-runtime Firefox STORE ZIP:
- SHA-256 `81569955be8a84ff38342f39ae202218b0fd0e9c4b2b9d7cc1ae72ff9ffc5971`.

Archive comparison: PASS.
All 42 non-manifest files are byte-identical; only `manifest.json` changed.
Evidence: `/root/octoport-control/logs/A/A03_FIREFOX_DISCLOSURE_F079C2E_R1/package/archive-diff.json`.

Focused package verification:
- Firefox package contract: PASS;
- store package contract: PASS;
- `firefox_background.js` syntax: PASS;
- web-ext 10.5.0 lint: 0 errors, 0 notices, 1 retained Android-min-version warning;
- build resource job `91d18d055d384f31934f471c2c561b37`: exit 0, OOM 0, cleanup verified, peak about 721 MiB.

Real vendor Firefox 155.0.1 temporary installation of the corrected STORE runtime:
- `installTemporaryAddon` reported id `octoport@octoport.ru`;
- explicit temporary Installed proof present;
- 35-second wrapper exit 124 was the intentional observation bound;
- resource job `d4ebc86133df410dbb2c6aadeb67c7d4`: exit 0, OOM 0, cleanup verified, peak about 941 MiB.

Temporary installation bypasses ordinary AMO installation consent and therefore does not prove the real
built-in consent prompt, AMO acceptance, signing, store installation, publication, LIVE_OWNER or deployment.

## Remaining boundary

Firefox remains blocked from an AMO-ready claim until the `technicalAndInteraction` compatibility-metadata
question is resolved or proven not applicable under Mozilla's exact policy, and normal reviewer/account/store
submission evidence is obtained. Opera/Chromium first-submission work remains independent.
