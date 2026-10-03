# A06 — exact STORE 0.2.12 signed-out control matrix R2 — 2026-10-03

## Scope and verdict

**PASS — INSTALLED_SYNTHETIC_EXACT_STORE_SIGNED_OUT_CONTROL_MATRIX.**

This receipt consolidates already accepted exact branded 0.2.12 evidence. No browser, auth, marketplace, provider or live action was rerun for this R2 reconciliation.

- current main at evidence readback: `41186f2b751cd63f37b8d7b2eb2dc32dc0551dc1`
- accepted branded source successor: `1616a88e35766a1d17055216d1348def50989b9f`
- accepted branded browser-smoke successor: `42cdf3715dcfa1d85f212d7d1fb4a1999d8cdb9c`
- Chromium STORE SHA256: `44870cd7260dd109168680d6aa17252fafef7e894c0d9b48a8ceff90b29265df`
- Firefox STORE SHA256: `27e995a37d3b48f3a93b6ece6e01b68d8d98f1640dc5b34476ad935398c78dd2`
- control count: **45 unique controls**
- matrix evidence SHA256: `ebb7d999c1f9208882f2d3b9617a193672f6b88e03c952ba3d52d40b9faf3b12`

R1 task `A06-0212-SIGNEDOUT-CONTROL-MATRIX-20261003` was correctly blocked because its self-authored acceptance said 46 controls. The current accepted harness contains 45 unique `CONTROL_IDS`; R2 corrects only that task-spec count.

## Deterministic source/evidence checks

- harness `tests/regression/extension-core/client-i1/exact-store-signedout-controls.py` SHA256 `a61bf85e622c386f467dc71c7d75d00123741188161d22804f0c1777842b9dde`
- popup markup `apps/extension/src/application/popup.html` SHA256 `2e7ccc9157ca899af6995d14243edff5372507ad3f28a7e7a9b2999f9fe4b02d`
- popup script `apps/extension/src/application/popup.js` SHA256 `f47ba3271e6e282924a012044df8f852f3fa52d84f472e2046378b0c9e7da202`
- all 45 harness IDs exist in current popup markup; no duplicate control IDs
- each exact Opera/Chrome/Yandex raw record has exactly the same 45 state keys
- all 45 hidden/disabled/visible/text states are identical across Opera/Chrome/Yandex
- signed-out visible controls are exactly: `auth-start, support-generate`
- `auth-start`: visible/enabled only; auth action was not clicked
- `support-generate`: visible/enabled and safe support-snapshot action verified
- authenticated catalog/work/transfer/backup controls remain hidden signed-out
- Opera/Chrome/Yandex: external HTTP(S) request count 0; page-error count 0
- support snapshot: `authenticated=false`, `workAllowed=false`, sensitive inclusion flags all false
- Firefox155: technicalAndInteraction consent/support transition `WITHHELD → INCLUDED → WITHHELD`; no forbidden product/provider attempt
- Firefox evidence does **not** establish full 45-control parity

## Exact raw evidence

- opera: `/root/octoport-control/logs/A/a03-0212-branded-chromium-signedout-opera-20261003.json` — SHA256 `c6063ac8fc7531e88c4b528bdaa789ae42f7717e7bb07dec60c531058822c2cf` — `136.0.6008.22` — install `cli`
- chrome: `/root/octoport-control/logs/A/a03-0212-branded-chromium-signedout-chrome-20261003.json` — SHA256 `809998a2449bda755830634e8f84253aa2d9f8a50fc70c7e24eaecb580860aaf` — `Google Chrome 147.0.7727.116` — install `cdp`
- yandex: `/root/octoport-control/logs/A/a03-0212-branded-chromium-signedout-yandex-20261003.json` — SHA256 `b5e094afe2e4b6592f7d6c81d4be53cf31b3748869ed02ef090eae3e119b298f` — `find_ffmpeg failed, using the integrated library.
Yandex 26.8.1.1111 stable` — install `cdp`
- Firefox consent/support: `/root/octoport-control/logs/C/a03-0212-branded-firefox-signedout-20261003/EVIDENCE.json` — SHA256 `7abbb7d49d6282b6455d4390269f051464ee6743b8080b4bb4d746453a2bad1f` — Firefox `155.0.1`

## Control matrix

| Control | Signed-out Chromium state | Action evidence | Firefox-specific evidence |
| --- | --- | --- | --- |
| `auth-start` | VISIBLE_ENABLED_ONLY | ACTION_NOT_VERIFIED | — |
| `auth-open` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `auth-cancel` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `auth-reset` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `firefox-technical-grant` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | FIREFOX_CONSENT_EVIDENCE |
| `firefox-technical-revoke` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | FIREFOX_CONSENT_EVIDENCE |
| `ozon` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `wildberries` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `stores` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `add` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `edit` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `remove` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `name` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `seller-id` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `seller-key` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `performance-id` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `performance-key` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `clear-performance` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `token` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `personal` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `save` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `cancel` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `check-seller` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `check-performance` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `check-token` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `start` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `work-resume` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `visibility` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `finish` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `resume` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `transfer-consent` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `transfer-create` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `transfer-discover` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `transfer-receive` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `backup-password` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `backup-password-confirm` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `backup-export` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `backup-file` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `backup-import-password` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `backup-preview` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `backup-import` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `support-generate` | VISIBLE_ENABLED_ONLY | SAFE_SUPPORT_SNAPSHOT_ACTION_VERIFIED | — |
| `support-snapshot` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `confirm` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |
| `reject` | HIDDEN_SIGNED_OUT | ACTION_NOT_VERIFIED | — |

## Counts

- `VISIBLE_ENABLED_ONLY`: 2
- `HIDDEN_SIGNED_OUT`: 43
- safe action verified: 1 (`support-generate`)
- actions intentionally not verified: 44
- Firefox consent-evidence rows: 2

## Explicit limitations

- No browser rerun was performed in this reconciliation; it reuses accepted exact-hash evidence.
- auth-start was not clicked; ordinary authentication remains unverified by this matrix.
- Hidden signed-out controls were not action-tested.
- Firefox evidence covers consent/support, not full 45-control parity.
- Development/temporary exact-package installation is not browser-store installation.
- No marketplace credential/provider/signed-profile/minimum-browser/LIVE_OWNER/READY_FOR_OPERATOR/deployment/production claim.
- This matrix does not promote either 0.2.12 operator candidate beyond `PREPARING`.

## Reproducibility

- Deterministic machine result: `/root/octoport-control/logs/A/a06-0212-signedout-control-matrix-r2-20261003/RESULT_R2.json`
- R1 blocked-count evidence: `/root/octoport-control/logs/A/a06-0212-signedout-control-matrix-20261003/BLOCKED_ACCEPTANCE_COUNT.json`
