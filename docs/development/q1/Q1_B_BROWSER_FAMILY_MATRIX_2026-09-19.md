# Q1-B — browser-family matrix and MV3 differential

Work ID: `Q1-B-20260919-AVAILABLE-BROWSER-FAMILY-MATRIX-AND-MV3-DIFFERENTIAL`

Recommended disposition: `Q1B_PARTIAL_ENVIRONMENT_DEFERRED`. Codex does not
self-accept Q1-B. Q1-A remains architect-accepted and was not reopened.

## Git, host, and boundary

- Base HEAD/tree: `08c82f8fce913f7e580a0dd0573fb1ece1bfafa3` /
  `ddc3a91e9910103336ffeb848c522f2b276c8ed0`.
- Branch: `feature/q1-b-browser-family-matrix-2026-09-19`.
- Final HEAD/tree: recorded in the terminal report after the documentation
  commit; no production runtime or Stream-2 implementation drift occurred.
- Host: Ubuntu 22.04.2 LTS, Linux 5.15.0-186-generic, x86_64, 4 vCPU.
- Display: no ambient `$DISPLAY`; `/usr/bin/Xvfb` and `xvfb-run` available.
- Disk: 1.0 GB free at preflight; 574 MB after the official Playwright Firefox
  engine download; root filesystem remained 99% full.
- Network: DNS/HTTPS to GitHub and official browser download endpoints worked.
- Tooling: system Node 12.22.9; repository Node 24.20.0/pnpm 10.34.5 under
  `/root/.nvm`; Python Playwright present; `web-ext`, Snap, Xcode, `xcrun`,
  Safari absent.
- Remote refs fetched normally: `origin/main`
  `bc718cc5c677ad0eb4598e7de3ad766473ff0847`,
  `origin/integration/i1-c1-srv5-2026-09-16`
  `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`, and
  `origin/docs/roadmap-autonomy-correction-2026-09-18`
  `6a48af8cd19137aaa10688c36cb064d3c4b16969`.
- Stream-2 paths modified: none. No files under `apps/health-runner/**`,
  `packages/server/health/**`, or `tooling/api-watch/**` changed.
- Remote publication: `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`; no push,
  force-push, reset, rebase, or amend.

## Browser inventory

| Browser/engine | Version | Executable | Reality/source | Result |
|---|---|---|---|---|
| Google Chrome | 147.0.7727.116 | `/opt/google/chrome/chrome` | real branded vendor Chrome | launches; unpacked extension flags refused |
| Google Chrome wrapper | 147.0.7727.116 | `/opt/google/chrome/google-chrome` | real branded vendor wrapper | same binary |
| Playwright Chromium | 151.0.7922.34 | `/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` | test engine / Chrome for Testing | canonical reference PASS |
| Chrome headless shell | 151.0.7922.34 | `/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell` | test engine | not target acceptance |
| Chrome for Testing | 149.0.7827.155 | `/root/.agent-browser/browsers/chrome-149.0.7827.155/chrome` | test engine | not selected |
| Chromium | 146.0.7680.177 | `/root/.cloakbrowser/chromium-146.0.7680.177.5/chrome` | test engine | not selected |
| Opera | — | — | no executable in PATH, `/usr`, `/opt`, `/root`, or `/snap` | environment deferred |
| Yandex Browser | — | — | no executable in PATH, `/usr`, `/opt`, `/root`, or `/snap` | environment deferred |
| Firefox/ESR | — | — | no system package | environment deferred |
| Playwright Firefox | 153.0/build 1538 | `/root/.cache/ms-playwright/firefox-1538/firefox/firefox` | test engine only | ordinary launch smoke PASS; extension not loaded |
| Safari | — | — | Linux host; no macOS/Xcode/Safari | environment/owner deferred |

All discovered binaries are x86_64. Chrome 147 and Playwright Chromium support
headed Xvfb, headless, and persistent profiles for ordinary browser pages.

Acquisition was bounded by the 99%-full filesystem and absent configured
official Opera/Yandex sources. No random mirror, browser-store agreement,
owner account, or production system was used. Opera’s official Linux package
is at [opera.com/download](https://www.opera.com/download); Yandex documents a
signed DEB/repository path at
[Yandex installation](https://www.yandex.com/support/browser/en/about/install).

## Package strategy and semantic parity

The unchanged Chrome/Chromium package is the exact Q1-A artifact:

- `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`;
- 2,076,757 bytes, SHA-256
  `93ba77f6fcac9932e991c94eded2d9638bb38c9990b8fcefd826d737aaf8d476`;
- 39 runtime files, 39 extracted files, 39 ZIP entries.

Chrome, Opera, and Yandex use this same MV3 `background.service_worker`
package when their real environments become available. No Opera or Yandex
package was falsely generated or accepted.

Firefox cannot use the Chrome package as its final artifact: Firefox does not
support `background.service_worker`. `tooling/build/extension_firefox.py` now
copies the common runtime, flattens its static `importScripts` graph into
`firefox_background.js`, changes the manifest to `background.scripts`, and
adds Gecko identity metadata. This is a packaging boundary, not a product
fork. Mozilla documents the distinction in its [background manifest
reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
and [Gecko metadata reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).

Firefox package receipt:

- `SELLER_AGENTS_I1_C1_v0.2.4_FIREFOX_LOCAL_DEVELOPMENT.zip`;
- 40 ZIP entries: the common 39 plus `firefox_background.js`;
- 3,886,114 bytes, SHA-256
  `25fc632d4638d4cf5d81e58fb9409cc1dde01e573b52641f8981606859208b5b`;
- repeated archive byte match: PASS; generated background `node --check`: PASS;
- copied common-file hashes: PASS.

The Firefox package preserves supported marketplaces, authority, Work,
C3E/C3F, P1/P2/P3, transfer, A24, replay, local storage, and privacy model.
No browser-specific server mode, weaker offline authority, alternate Work
state, or secret/raw-report persistence was introduced.

Safari has no package/conversion output in this Linux checkout. Apple’s
required boundary is the macOS/Xcode
`xcrun safari-web-extension-packager` flow, which creates an Xcode app project;
no fake Safari shim was added. See [Apple packaging
documentation](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari).

## Chrome 147 differential and root cause

The exact accepted ZIP runtime was tested with clean persistent profiles using
Playwright headless default, `--headless=new`, headed Xvfb, the existing
`--disable-extensions-except`/`--load-extension` route, `--load-extension`
alone, removal of Playwright’s standard `--disable-extensions` default, direct
Chrome logging, and a clean remote-debugging/CDP process.

The failure is deterministic and occurs before the manifest is loaded. Chrome
stderr says:

```text
--disable-extensions-except is not allowed in Google Chrome, ignoring.
--load-extension is not allowed in Google Chrome, ignoring.
```

The same Chrome process launches and persistent profiles work, but no Seller
Agents extension target, service-worker target, popup URL, extension ID, or
manifest error exists because the package is never loaded. CDP’s
`Extensions.loadUnpacked` is unavailable (`Method not available`). The Chrome
Extensions UI can toggle Developer mode, but its Load unpacked action opens a
native picker that this executor’s Playwright route cannot control; no manual
owner action was substituted.

Classification: `BRANDED_CHROME_FLAG_CHANGE` / `BROWSER_ENVIRONMENT_DEFECT`,
with headed-without-display separately corrected by Xvfb. This is not a
manifest defect, service-worker discovery defect, or product runtime defect.
Chrome BR-01..BR-24 are therefore all `ENVIRONMENT_DEFERRED`, not PASS.

## Matrix results

| Browser | BR-01..BR-24 |
|---|---|
| Chrome 147 | all `ENVIRONMENT_DEFERRED` after package load was refused at BR-01 |
| Opera | all `ENVIRONMENT_DEFERRED`; no actual executable |
| Yandex Browser | all `ENVIRONMENT_DEFERRED`; no actual executable |
| Playwright Chromium 151 | bounded Q1-A installed evidence PASS; never relabeled as a branded target |

BR-01..24 cover install/load, MV3 worker, popup, Ozon/WB switching and stores,
synthetic Start/rebind, Ozon/WB commands and sequence, UNKNOWN/429 no replay,
binary/file handling, worker/browser restart, offline grace, A24,
transfer, zero ordinary control/delivery calls, and privacy. A deferred row is
not inferred from Chromium.

The canonical compact verifier was rerun on source and extracted runtimes in
Playwright Chromium 151: worker/signed bootstrap, account binding, and tamper
rejection all PASS. The accepted Q1-A receipt remains authority for the full
synthetic Start, Ozon, WB, file, restart, A24, transfer, replay, and privacy
matrix.

## Firefox and Safari evidence

Real system Firefox/Firefox ESR is unavailable. Official Playwright Firefox
153 was downloaded and launched under Xvfb; its `about:blank` engine smoke
passed. It is explicitly `PLAYWRIGHT_FIREFOX_ENGINE_ONLY`. The attempted
`--install-addon` launch did not produce a usable extension target, so no real
Firefox popup/background/file/update/Work acceptance is claimed. Firefox is
`BROWSER_PACKAGE_READY_RUNTIME_ENVIRONMENT_DEFERRED`.

Safari is `ENVIRONMENT_DEFERRED-Q1B-SAFARI`: this is Linux, with no `xcrun`,
Xcode, Safari, or supported macOS runtime. Future work must run Apple’s
packager, review manifest warnings, build/enable the generated Xcode app, and
run BR-01..24 on Safari. Store publication remains out of scope.

## Update/package, safety, failure batch, and regression

Playwright Chromium Q1-A evidence covers fresh load, persistent storage,
worker/browser restart, files, A24, transfer, and privacy on the accepted ZIP.
Chrome 147 reached clean browser/profile startup only; package install,
reload/update, storage migration, and files were not reached. Firefox is
static-package-ready only. Opera, Yandex, real Firefox, and Safari did not
reach BR-01.

Complete reachable failure batch:

| Area | Classification | Disposition |
|---|---|---|
| Chrome extension flags | `BROWSER_ENVIRONMENT_DEFECT` / branded flag change | no product fix; defer real Chrome install route |
| Chrome headed without display | `BROWSER_LAUNCH_HARNESS_DEFECT` | Xvfb corrected launch; flags still refused |
| Chrome UI picker/CDP | `PLATFORM_LIMITATION` | no owner/manual evidence substituted |
| Firefox package | implementation gap | resolved by deterministic Firefox builder |
| Real Firefox | `ENVIRONMENT_DEFERRED` | no system executable; engine-only smoke |
| Opera/Yandex | `ENVIRONMENT_DEFERRED` | no executable/source; disk constrained |
| Safari | `PLATFORM_LIMITATION` / `OWNER_DEFERRED_TEST` | Linux lacks macOS/Xcode/Safari |
| Existing C1 reference attempt | `BROWSER_LAUNCH_HARNESS_DEFECT` | fixture authority did not survive its restart assertion; Q1-A evidence unchanged |

No browser-specific mandatory server dependency, control call, marketplace
credential persistence, raw seller report persistence, replay/resend, or
privacy regression appeared. No common production extension/server/contract/
schema code changed; package-only regression was limited to deterministic
build, common-file parity, and syntax checks.

## Deferred procedures and support statuses

- **Chrome 147 / Linux:** use a disposable Xvfb profile, exact Chrome ZIP
  SHA, and a controllable native local-install route or supported Chrome test
  binary; capture stderr, command line, extension ID, worker, popup, errors;
  run BR-01..24 plus replacement/profile migration. No owner account needed.
- **Opera / Linux x86_64:** install the official Opera DEB, verify source,
  launch real `opera`/`opera-stable`, load the unchanged Chrome package, and
  run BR-01..24 plus update/profile/file checks. Only real Opera evidence can
  convert the status to PASS.
- **Yandex / Linux x86_64:** install the official Yandex stable DEB using its
  Ubuntu procedure, launch real `yandex-browser`, load the Chrome package, and
  run BR-01..24 plus permission/update/profile/file checks.
- **Firefox / supported Linux:** install real Firefox/ESR, use only the
  Firefox ZIP SHA above with Gecko ID `seller-agents@example.test`, capture
  event-page errors and popup, then run the Firefox BR-equivalent,
  file/update/profile, restart, offline, A24, transfer, and privacy matrix.
- **Safari / macOS:** run
  `xcrun safari-web-extension-packager <extension-directory>`, review warnings,
  build/enable the generated app, record macOS/Safari/Xcode versions and run
  BR-01..24. A supported Mac is required; live AI/store publication is not.

Current exact support statuses:

| Target | Status |
|---|---|
| Playwright Chromium 151 | `BROWSER_ACCEPTED_BOUNDED_AUTOMATED` (reference only) |
| Google Chrome 147 | `BROWSER_PACKAGE_READY_RUNTIME_ENVIRONMENT_DEFERRED` |
| Opera | `ENVIRONMENT_DEFERRED` |
| Yandex Browser | `ENVIRONMENT_DEFERRED` |
| Firefox | `BROWSER_PACKAGE_READY_RUNTIME_ENVIRONMENT_DEFERRED` |
| Safari | `ENVIRONMENT_DEFERRED` / `OWNER_DEFERRED_TEST` for supported Mac |

Q1-B is therefore `Q1B_PARTIAL_ENVIRONMENT_DEFERRED`, not ready for full
architect acceptance and not rework-required. The next independent Stream-1
lane is architect review of this bounded disposition, then the separately
scheduled Q1-D admin/preprod/release lane. Q1-C, Q1-E, S1.2, deployment,
publication, and monetization were not started.
