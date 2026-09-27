# Ozon Bridge 0.1.21.3 — DOM lifecycle and native guest submit compatibility

Scope: standalone Ozon Bridge package and corresponding composed-runtime overlays. No main integration or release-store promotion.

Reproduced on 0.1.21.2: replacing main or detaching the button overlay leaves zero usable buttons. The document observer, stale-record repair and shadow-host repair close these cases. CODE_BLOCK_SCAN records only counts/flags, not command text or credentials.

A separate real guest test exposed a report returning while the bridge remained busy. The exact mobile-composer-prompt native Send control now enters the existing one-shot submit-completion path. The pre-existing committed-click condition remains required. A disabled nonempty composer and an active Stop control do not qualify as completion. No worker/parser/provider/queue redesign or automatic request was added.

Verification boundaries:
- Standalone installed native Chromium + synthetic pages: 39/39 source and 39/39 extracted archive.
- Real guest ChatGPT in server Chromium 151.0.7922.34: actual toolbar popup Bind/Show/Hide, one Ozon click, one local supplies_fbo report, buttons ready again, Finish. PASS. No ChatGPT login or readiness/binding stubs.
- Real Ozon business requests: 0. No seller credentials used.
- Composed 0.2.4 development source and extracted package: native application fixture PASS, including SPA main/overlay recovery. This is not standalone/live equivalence evidence.
- Owner's local browser was not inspected; its exact root cause is not claimed closed.

Standalone ZIP SHA-256: 710b534eed1654c2753ba3be39dac11b91f8f44d4acd0c1f30d1a4800db37eca
Runtime tree SHA-256: a253072fba9b2b38209c1abf4b038dc56a0aa18cafc05ae547d9db387b824696
Standalone content_script.js SHA-256: 48a120c9e8f4121ef965a271442a58988c86df492f168643d350d778bf773790

All 34 delivered runtime files match installed and archive-extracted bytes. All 31 JavaScript files pass syntax checks. Frozen imported donor files remain unchanged. Public frontend assets, browser profiles, credentials and fixture private keys are excluded from the release and Git.

Reproduce the standalone matrix with an extracted standalone package, not the composed application:
`OZ_TEST_RUNTIME=/absolute/standalone-runtime OZ_TEST_OUTPUT=/absolute/test-output python3 tests/regression/extension-core/standalone-ozon-dom.py`

Server evidence: /root/octoport-diagnostics/ozon-button-release-20260927-r3/{QA_SUMMARY.json,evidence-release,evidence-extracted,live-native-complete,final-package-manifest.json}.
