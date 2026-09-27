# A03 — Firefox 155 installed-synthetic Ozon + WB functional matrix R2 — 2026-09-27

Status: **REAL FIREFOX INSTALLED-SYNTHETIC WB+OZON FUNCTIONAL PASS / LIVE+STORE RELEASE OPEN**

Task: `A03_FIREFOX_FUNCTIONAL_MATRIX_R2`.
Parent product HEAD before this test-only block:
`30eb0af1f4eff83f11ed0503421453db5b7e27d1`.

Observed fresh `origin/main` before handoff:
`0208145336d75d10e2286fbcd8bd0c134215c815`.

This block closes the old Firefox functional-harness/control-method gate. It does not
change extension/runtime product behavior.

## Why the old gate could be closed now

The earlier Firefox functional attempt used a temporary add-on plus
`browser.runtime.reload()`. Reload destroyed the Marionette session before the real
Work/provider path could be exercised.

Firefox 149+ no longer requires a user gesture for `action.openPopup()` /
`browserAction.openPopup()`. The current Firefox 155 environment can therefore open
the actual extension action popup while preserving the real ChatGPT tab as the active
tab. The test verifies that browser-chrome popup URI is the installed extension popup;
it does not spoof `tabs.query()`, alter `location.hostname`, or weaken product host
checks.

Primary documentation checked:
https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/149
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/openPopup

## Test-only implementation

Changed A-owned test surfaces only:
- `tests/regression/extension-core/client-i1/firefox-functional-harness.py`;
- `tests/regression/extension-core/client-i1/firefox-functional-run.py`;
- `tests/regression/extension-core/client-i1/api-harness.ts`.

`api-harness.ts` gains a bounded fixture-only extension-version override; its default
remains `0.2.4`. This allows the disposable signed release fixture to match the current
composed `0.2.5` carrier instead of intentionally failing compatibility.

The Firefox functional harness:
- installs the generated Firefox carrier as a temporary real WebExtension via
  GeckoDriver/Selenium;
- uses Firefox 155.0.1 and the actual Gecko add-on ID;
- creates an ephemeral CA only inside a temporary Firefox profile;
- serves exact `https://chatgpt.com/c/...` fixture pages through a loopback
  CONNECT/TLS proxy with **no upstream connection implementation**;
- routes only allowlisted Ozon/WB provider hosts to local synthetic responses;
- lets loopback disposable API/portal traffic bypass the proxy;
- keeps optional Firefox `technicalAndInteraction` permission absent for the
  accepted run;
- opens the real action popup and proves the active ChatGPT tab is preserved.

NSS `certutil` is an Easyscript test-environment dependency only; it is not added to
the product/package dependencies.

## Accepted RUN14

Evidence root:
`/root/octoport-control/logs/A/A03_FIREFOX_FUNCTIONAL_MATRIX_R2_RUN14/`.

Summary SHA-256:
`3ad44b75e7106b6cff498a70b1033849111165232240d999013e042c8ec54943`.

Functional result SHA-256:
`19f1f6b3505ebe573cb7986e4a571ae610b1b99b14b9792387d9fe8f3eddc2ee`.

Generated local-development Firefox carrier:
- name: `SELLER_AGENTS_I1_C1_v0.2.5_FIREFOX_LOCAL_DEVELOPMENT.zip`;
- SHA-256: `0d191fea666077becca8dd794c7d78cab35a23c7d2d74d1f73c890f560a84a85`;
- profile contract: `control_plane_v2`;
- browser family: `firefox`;
- this carrier uses disposable fixture trust and is not the STORE/AMO package.

Real browser:
- Firefox: `155.0.1`;
- add-on ID: `seller-agents@example.test`;
- action popup: opened;
- active ChatGPT tab preserved;
- popup URI matched the installed extension popup;
- exact ChatGPT origin: true;
- disposable portal/control-plane authentication: true;
- optional technical permission mode: neutral/absent.

Wildberries cycle:
- store added through normal popup UI with synthetic-only credential material;
- independent ChatGPT conversation;
- Work reached `active_visible`;
- command: read-only `seller_info`;
- provider request: exactly one
  `GET https://common-api.wildberries.ru/api/v1/seller-info`;
- one WB result delivered;
- repeated action did not replay provider execution or AI delivery;
- harness waits for durable manual-operation completion before Finish;
- explicit Finish succeeded.

Ozon cycle, after WB Finish:
- separate Ozon store and separate ChatGPT conversation;
- Work reached `active_visible`;
- command: read-only `roles`;
- provider request: exactly one
  `POST https://api-seller.ozon.ru/v1/roles`;
- one Ozon result delivered;
- repeated action did not replay provider execution or AI delivery;
- harness waits for durable manual-operation completion before Finish;
- explicit Finish succeeded.

Network boundary:
- `liveProviderCalls=0`;
- proxy upstream connections: `0`;
- only ChatGPT fixture and the two allowlisted synthetic provider requests were served;
- Firefox background attempts to Mozilla update/settings hosts were blocked and counted,
  not forwarded upstream.

## Resource evidence

Resource receipt:
`/root/octoport-control/resource-jobs/d9a9e87811a446178b1dec45b9d5ebd7/receipt.json`.

- profile: browser + disposable DB;
- command exit: 0;
- systemd result: success;
- peak bytes: 1,773,142,016;
- OOM kills: 0;
- cleanup verified: true.

## Harness hardening history

Earlier R2 runs are retained as non-acceptance diagnostics.

- RUN11 exposed a test timing race while reading the newly created marketplace action
  label. The final harness bounded-waits for the expected marketplace label; a sustained
  wrong label still fails.
- RUN13 exposed a second harness ordering race: Finish could run after the result text
  appeared but before durable delivery confirmation. The final harness now waits for
  `manual_operation.status=completed` before Finish, matching existing accepted
  delivery/no-replay semantics.
- RUN14 is the accepted current-byte result.

No product/runtime fix was required by these harness races.

## Current file hashes

- `api-harness.ts`:
  `176847203a04f52e8c76805776e146f44b217b204a467d26a668ece2a524eca7`;
- `firefox-functional-harness.py`:
  `b8e75456fd929734c555a0e267a7080ad025ba5a8388434c6b299e8b341ff80f`;
- `firefox-functional-run.py`:
  `f8f9dc7019551c3ddba14756f1312aa52bd88a3ca68764544401a40a079e0a03`.

Syntax, TypeScript Prettier check and `git diff --check`: PASS.

## Evidence boundary / remaining A03 gates

This is **REAL FIREFOX INSTALLED_SYNTHETIC FUNCTIONAL** evidence. It is stronger than
the earlier runtime smoke and closes the Firefox Work/Ozon/WB harness gap for the
tested local-disposable environment.

It is not:
- LIVE_OWNER or live marketplace-provider acceptance;
- AMO submission, signature, approval, catalog installation or update;
- branded Chrome store-installed acceptance;
- Yandex stable/store-installed update acceptance;
- Safari/macOS acceptance;
- production deployment.

Those remaining items require their own real environment/store/owner evidence and
must not be inferred from this Firefox result.
