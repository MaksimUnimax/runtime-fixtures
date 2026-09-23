# A03 — real Firefox 155.0.1 installed smoke — 2026-09-23

Status: `REAL_VENDOR_INSTALLED_SMOKE_PASS / FUNCTIONAL_MATRIX_OPEN / A03_NOT_COMPLETE`

This receipt records real vendor Firefox package/install evidence only. It does not claim the Chrome/Opera C1 matrix transfers to Firefox, and it does not claim LIVE_OWNER, deployment, AMO publication, or full Firefox Work/Ozon/WB acceptance.

## Vendor browser identity

- Browser: Mozilla Firefox `155.0.1`, Linux x86_64 vendor release tarball.
- Source: Mozilla official release directory.
- Tarball SHA-256 from Mozilla `SHA256SUMS`: `642ab731354a5ca790b894d4556dfb5028c61d0c24eb10d10e10a111a69c89bf`.
- Downloaded tarball SHA-256: `642ab731354a5ca790b894d4556dfb5028c61d0c24eb10d10e10a111a69c89bf` — exact match.
- Browser binary: `/root/octoport-control/browsers/A/firefox-155.0.1/unpack/firefox/firefox`.
- Browser-reported version: `Mozilla Firefox 155.0.1`.
- Installation is isolated under `/root/octoport-control/browsers/A/`; no system Firefox package or production browser was changed.

## Firefox package

Built from the exact common A01 runtime used for the Opera evidence through `tooling/build/extension_firefox.py`.

- Firefox package: `SELLER_AGENTS_I1_C1_v0.2.4_FIREFOX_LOCAL_DEVELOPMENT.zip`.
- ZIP SHA-256: `52af41aad453cba0229e1bfe456c41bb4f3b1891be2b68ae2929492c85b95cfd`.
- Deterministic repeat archive match: PASS.
- Firefox carrier files: 40.
- `firefox_background.js` syntax check with Node 24.20.0: PASS.
- Packaging differences are limited to the documented Firefox boundary: MV3 `background.scripts`, Gecko ID, and generated flattened classic background graph; common product runtime is not forked.

Evidence:
`/root/octoport-control/logs/A/A03_FIREFOX155_PACKAGE_b34511e7_R1/firefox-composition-receipt.json`

## web-ext validation

- Tool: `web-ext 10.5.0` via pnpm dlx; repository lockfile was not changed.
- `web-ext lint`: **0 errors, 0 notices, 1 warning**.
- Warning: `MISSING_DATA_COLLECTION_PERMISSIONS` because `browser_specific_settings.gecko.data_collection_permissions` is absent.

The warning is retained as an explicit Firefox publication/manifest gate. No `none` declaration is invented here because a data-collection declaration must match the real privacy/data model and publication policy.

Evidence:
`/root/octoport-control/logs/A/A03_FIREFOX155_PACKAGE_b34511e7_R1/lint.json`

## Real temporary installation

A clean isolated Firefox profile was launched under Xvfb using the official vendor Firefox binary and Mozilla `web-ext run` temporary-add-on path.

The browser started its remote debugger, and `web-ext` received:

- `installTemporaryAddon` with add-on ID `seller-agents@example.test`;
- explicit success line: `Installed ... as a temporary add-on`.

The retained profile independently confirms Firefox assigned `seller-agents@example.test` a `moz-extension` UUID and stored the extension's declared host permissions.

The wrapper process exited `124` only because the test intentionally bounded `web-ext run` with a 35-second timeout after successful installation; that timeout is not an install failure.

Environment-only warnings observed after successful install:
- DBus/a11y machine-id warning under the disposable Xvfb environment;
- Firefox built-in BackupService empty-path JavaScript warning.

Neither prevented temporary installation and neither is accepted as product PASS/FAIL evidence.

Evidence:
- `/root/octoport-control/logs/A/A03_FIREFOX155_INSTALL_52af41aa_R1/web-ext-run.log`
- `/root/octoport-control/logs/A/A03_FIREFOX155_INSTALL_52af41aa_R1/profile/prefs.js`
- `/root/octoport-control/logs/A/A03_FIREFOX155_INSTALL_52af41aa_R1/profile/extension-preferences.json`

## Disposition

- Real vendor Firefox acquisition: **PASS**.
- Vendor artifact integrity against Mozilla SHA256SUMS: **PASS**.
- Deterministic Firefox package: **PASS**.
- Firefox temporary add-on installation: **PASS**.
- Firefox full functional Work/Ozon/WB/browser matrix: **OPEN / NOT CLAIMED**.
- Firefox AMO/publication manifest readiness: **OPEN** because the data-collection declaration warning must be resolved from authoritative product privacy semantics, not guessed.
- No evidence from Chromium or Opera is transferred to Firefox.
