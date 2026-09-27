# STORE-1 0.2.5 reviewer / pre-submission R8 — 2026-09-28

Status: **PACKAGE + EXACT OPERA SIGNED-OUT UI PASS / DEPLOYMENT + LIVE REVIEWER OPEN / NOT SUBMITTED**

This supersedes R7 only for current STORE-0/STORE-1 submission assets and
readiness bookkeeping. R7 remains the deployment/reviewer sequence authority.

## Exact package authority

- source: `68f1621376be4d7aeeff44bc76cc326f8cc64954`;
- tree: `8eb20bbc19bbbaaa73ca1a9ba139efa90194ea9a`;
- version: `0.2.5`;
- contract: `control_plane_v2`;
- Chromium/Opera ZIP SHA-256:
  `33cbf1ad9ec4669abe3a65e24cfbaead4c7c3a1fa711261b2d186d107c33aea1`;
- ZIP size: 2,217,404 bytes;
- C01 external-authority release preflight: PASS;
- B14 exact 0.2.5 STORE1 rebind: focused 47/47 PASS plus disposable PostgreSQL
  5/5 PASS.

The historical 0.2.4 candidate remains HOLD only and is not reused as current
submission authority.

## Exact Opera signed-out UI asset

Real Opera 136 loaded the exact extracted 0.2.5 STORE ZIP in a fresh disposable
browser profile using the legitimate development-extension load route.

Observed:
- evidence class: `INSTALLED_SYNTHETIC_EXACT_PACKAGE_UI`;
- manifest name: `Octoport — Ozon + Wildberries`;
- manifest version: `0.2.5`;
- manifest_version: 3;
- authenticated: false;
- popup document ready: complete;
- page errors: 0;
- external request count: 0;
- no owner/reviewer credential, OTP, cookie, marketplace secret or live provider
  request was used.

Screenshot:
- path:
  `/root/octoport-control/logs/C/opera-submission-images-68f16213/01-opera-popup-612x408.png`;
- SHA-256:
  `6e8bfa3d29cf21d3451a075a6aa98266b59efb082760e6ab3f4f0bb5ef49065e`;
- 32,402 bytes;
- PNG IHDR 612×408, 8-bit RGB, non-interlaced.

The SHA is byte-identical to the earlier 0.2.4 signed-out screenshot, proving
the visible signed-out popup did not change. Unlike that historical evidence,
this run is bound to exact 0.2.5 bytes.

Supervisor:
`octoport-test-c-5275f93e72cc4843a5a323ac10c9fc67.service`;
exit 0, peak 650 MiB, cleanup verified.

## Exact package metadata checks

Manifest permissions:
- `storage`;
- `alarms`;
- `tabs`;
- `unlimitedStorage`.

The accepted product justification remains account/store local state, bounded
local report/file and recovery state, bounded expiry/maintenance, and binding
work to the exact active supported AI tab.

Manifest-declared icons exist in exact package bytes:
- 16×16 PNG RGBA, non-interlaced;
- 48×48 PNG RGBA, non-interlaced;
- 128×128 PNG RGBA, non-interlaced.

Exact extracted-package search found:
- zero HTML remote `<script src="http...">` references;
- zero remote `importScripts("http...")` references.
The popup loads its packaged local `popup.js`; marketplace/API HTTPS origins
remain data/network endpoints, not remotely hosted executable code.

Public pages were read-only checked:
- `https://octoport.ru/privacy` → HTTP 200;
- `https://octoport.ru/support` → HTTP 200;
- `https://octoport.ru/install` → HTTP 200.

## Refreshed Opera acceptance boundary

Official Opera extension acceptance/publishing guidance was rechecked on
2026-09-28:
- https://help.opera.com/en/extensions/acceptance-criteria/
- https://help.opera.com/en/extensions/publishing-guidelines/

Relevant current requirements remain aligned with the prepared candidate:
one clearly stated purpose; accurate metadata; useful extension behavior;
quality similar-style icons/screenshots; non-interlaced PNG; no external
JavaScript; reviewable non-obfuscated code; no unnecessary/redundant
permissions; authorized handling of private information; and dashboard
submission metadata.

Prepared listing facts:
- product name: Octoport;
- category candidate: Productivity, to verify against actual dashboard choices;
- early limited beta statement;
- public support contact: `support@octoport.ru`;
- RU summary/description and privacy/permission explanation from the accepted
  STORE listing draft.

C does **not** invent a license/EULA selection. The repository currently has no
declared root license value. If the publisher dashboard requires a mandatory
license choice, that is a concrete publisher/legal field to resolve at the real
submission boundary.

## Backend/reviewer boundary

Deployment target remains exact accepted
`62024d192a8572c11aafab91653330d1f996699f`.

Its deployment paths are unchanged by later A03/A04 test/evidence intake.
The immutable release verifier passes and C05 candidate→floor→candidate
recovery remains applicable.

Prepared operational runbook:
`/root/octoport-control/logs/C/PREPROD_DEPLOYMENT_RUNBOOK_62024D19_R7_2026-09-27.md`.

Prepared protected reviewer preflight template:
`/root/octoport-control/logs/C/store1-reviewer-025/operator-input.example.json`,
mode 0600. It contains placeholders only and is intentionally unusable as an
auth bypass.

## Ordered remaining gates

1. Explicitly authorized owner-test/preprod deployment-only operation for exact
   `62024d19...`.
2. Ordinary dedicated reviewer portal/device authentication.
3. Exact 0.2.5 read-only STORE1 preflight.
4. Separate catalog activation only if the read-only plan requires it.
5. Exact 0.2.5 Opera reviewer useful-flow via normal product paths and a
   sanitized in-action screenshot.
6. Actual Opera publisher dashboard upload, mandatory metadata and Submit under
   the standing early-store authorization.

Monitoring C04 and dedicated authenticated Health H3 do not block STORE-1.

No deployment, catalog mutation, reviewer login, marketplace/provider call or
store Submit is claimed by this receipt.
