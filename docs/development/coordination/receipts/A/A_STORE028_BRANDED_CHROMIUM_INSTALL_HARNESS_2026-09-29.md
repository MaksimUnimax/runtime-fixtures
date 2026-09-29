# A STORE 0.2.8 branded Chromium install harness — 2026-09-29

Status: `PASS_SOURCE_AND_INSTALLED_SYNTHETIC`

Scope: A-owned installed signed-out verification helper only. No product runtime bytes changed.

Exact release bytes:
- version: `0.2.8`
- source: `8c6ade801b7441f0b64eb850f46b86c4b61dc39e`
- Chromium ZIP SHA-256: `63943ebc63f37fa4c8718ae252149dfd2b90a1d9dbc4b9637d35023f0c15ae48`
- A branch base before this fix: `97df9152162ffbd02da427279e5a83a7b9887365`

## Reproduced harness defect

The old helper assumed every Chromium-family browser accepts `--load-extension` /
`--disable-extensions-except` and that the first observed service worker belongs
to Octoport.

Chrome 147 rejected the CLI install boundary; prior browser evidence records:
`--disable-extensions-except is not allowed in Google Chrome, ignoring.`
Yandex also exposes built-in extension workers, so taking `service_workers[0]`
can select a non-Octoport worker and open the wrong popup.

## Applied fix

`exact-store-signedout-controls.py` now:
- selects CDP `Extensions.loadUnpacked` for branded Chrome and Yandex;
- keeps the proven CLI path for Opera/Chromium;
- identifies CLI workers by exact Octoport manifest name + expected version;
- opens the installed popup before requiring the CDP-loaded MV3 worker;
- fails closed if CDP returns no extension id or the Octoport worker is absent;
- records install method, extension id and exact worker URL in evidence.

A source-only unit regression covers method selection, explicit override, the exact
CDP call/path, and missing-id failure.

## Validation

Source checks:
- Ruff: PASS.
- New install-method regression: 5/5 PASS.
- Existing exact-store helper guards: 22/22 PASS.
- Python compile: PASS.
- `git diff --check`: PASS.

Final installed-synthetic exact-package run:
- Opera 136.0.6008.22 — PASS, CLI install, manifest 0.2.8/MV3.
- Google Chrome 147.0.7727.116 — PASS, CDP install, manifest 0.2.8/MV3.
- Yandex 26.8.1.1111 — PASS, CDP install, manifest 0.2.8/MV3.
All three runs observed the Octoport service worker, kept the signed-out catalog
hidden, exposed the login and safe-support controls, generated a privacy-safe
support snapshot, and recorded zero HTTP(S) requests and zero page errors.

Evidence:
- `/root/octoport-control/logs/A/branded028-helper-fixed-r2/opera.json`
- `/root/octoport-control/logs/A/branded028-helper-fixed-r2/chrome.json`
- `/root/octoport-control/logs/A/branded028-helper-fixed-r2/yandex.json`
- `/root/octoport-control/logs/A/chromium-branded-028-extension-load-probe/result.json`
- historical Chrome diagnostic:
  `/root/octoport-control/logs/A/A03_CHROME147_HEADED_CDP_b34511e7_R1/browser.log`

## Boundaries still open

This is `INSTALLED_SYNTHETIC_EXACT_STORE_SIGNED_OUT`, not Chrome Web Store /
Opera Add-ons / Yandex catalog installation, authenticated server compatibility,
marketplace provider acceptance, or a genuine ChatGPT useful-response/H3 flow.

The authenticated exact-0.2.8 lifecycle still requires C to resume explicitly,
consume a fresh protected normal-device credential, and return compatibility
DONE. The earlier C credential expired and is not reused or reissued while C is
STOPPED.
