# A03 — branded Chrome 147 environment gate — 2026-09-23

Status: `PACKAGE_READY / REAL_BROWSER_PRESENT / BRANDED_AUTOMATED_UNPACKED_INSTALL_ENVIRONMENT_DEFERRED`

This is browser-specific A03 evidence for branded Google Chrome only. Playwright Chromium evidence is not relabeled as Chrome.

## Identity

- Stream/task: `A / A03`.
- Exact package SHA-256: `b34511e7eec358fb398d304d5274fed788824438193ee5412b44d8b451f33017`.
- Real browser: Google Chrome `147.0.7727.116`.
- Executable: `/usr/bin/google-chrome`.
- Clean disposable Xvfb profile; native remote-debugging/CDP target inventory.

## Exact-package probe

Branded Chrome was launched with the exact Seller Agents runtime using the historical unpacked automation flags:

- `--disable-extensions-except=<runtime>`
- `--load-extension=<runtime>`

Browser stderr explicitly reports:

`--disable-extensions-except is not allowed in Google Chrome, ignoring.`

CDP exposed built-in extension targets plus `about:blank`, but **no Seller Agents target** and no URL ending in `service_worker_entry.js`.

Evidence:
- `/root/octoport-control/logs/A/A03_CHROME147_HEADED_CDP_b34511e7_R1/summary.json`
- `/root/octoport-control/logs/A/A03_CHROME147_HEADED_CDP_b34511e7_R1/browser.log`

## Disposition

- Product/package defect: **not proven**.
- Real branded Chrome present: **yes**.
- Current automated unpacked-registration route: **not available**.
- Chrome A03 status: `BRANDED_AUTOMATED_INSTALL_ENVIRONMENT_DEFERRED`.
- Chromium/Chrome-for-Testing installed evidence remains separate reference evidence and does not satisfy branded Chrome.
- Full branded Chrome browser matrix remains an open release gate until a legitimate controllable installed-package route is available.
- No security setting, native file picker, browser policy, store install, or owner interaction was bypassed/simulated.
