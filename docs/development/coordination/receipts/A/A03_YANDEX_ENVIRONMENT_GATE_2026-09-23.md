# A03 — Yandex Browser environment gate — 2026-09-23

Status: `PACKAGE_READY / REAL_BROWSER_PRESENT / AUTOMATED_UNPACKED_INSTALL_ENVIRONMENT_DEFERRED`

This is browser-specific A03 evidence for Yandex Browser only. It is not a product FAIL and does not transfer Opera/Chromium evidence to Yandex.

## Identity

- Stream/task: `A / A03`.
- Current A line contains A01 product commit `5f2c8d97b9c68930f1b38b229c7efb7e9adca6b8` plus synchronized main.
- Exact package under test SHA-256: `b34511e7eec358fb398d304d5274fed788824438193ee5412b44d8b451f33017`.
- Package runtime files: 39; deterministic archive and source↔extracted parity already PASS.
- Browser package: `yandex-browser-stable 26.8.1.1111-1`.
- Executable: `/usr/bin/yandex-browser` -> `/opt/yandex/browser/yandex-browser`.

## Automated package-load evidence

### Standard browser harness smoke

A bounded real-Yandex `BR-C1-01` attempt using the exact package did not reach the case body. The harness encountered a service worker without Seller Agents globals and failed at authority seeding with:

`SellerAgentsBootstrapVerifier is not defined`

This by itself is not classified as a product failure because the harness historically selected `context.service_workers[0]`, while Yandex can expose browser-owned workers.

Evidence:
`/root/octoport-control/logs/A/A03_YANDEX_BR01_b34511e7_R1/yandex-br01.log`

### Clean-profile service-worker enumeration

A separate clean headless profile enumerated all Playwright-visible service workers for 12 seconds after launching Yandex with the exact runtime through `--disable-extensions-except` + `--load-extension`.

Result: **0 service workers**. No Seller Agents worker or globals appeared.

Evidence:
`/root/octoport-control/logs/A/A03_YANDEX_WORKER_ENUM_b34511e7_R1/result.json`

### Headed Xvfb + native CDP

A clean headed Xvfb profile launched real Yandex with the same exact runtime and a native remote-debugging port. CDP target inventory contained browser UI and `about:blank`, with **0 `chrome-extension://` targets**.

Browser verbose logs show only Yandex/component extension registration; there is no Seller Agents extension ID or manifest/runtime failure because the package was not registered through this automation route.

Evidence:
- `/root/octoport-control/logs/A/A03_YANDEX_HEADED_CDP_b34511e7_R1/summary.json`
- `/root/octoport-control/logs/A/A03_YANDEX_HEADED_CDP_b34511e7_R1/browser.log`

## Platform boundary

Current Yandex Browser support documentation states that extensions from unverified sources can be disabled and development testing uses the browser extension UI / Developer Mode with explicit user enablement. The tested command-line unpacked-load route is therefore not treated as a supported acceptance mechanism when the browser registers zero extension targets.

No security setting was bypassed, no browser profile was reused, and no owner action was simulated.

## Disposition

- Product/package defect: **not proven**.
- Real Yandex browser present: **yes**.
- Automated unpacked registration with current legal test route: **not available**.
- Yandex A03 status: `AUTOMATED_INSTALL_ENVIRONMENT_DEFERRED`.
- A full Yandex matrix must not run until an actual Seller Agents extension target/service worker exists in a legitimate environment.
- A03 continues independently with branded Chrome and real vendor Firefox; Safari remains a macOS/Xcode gate.
