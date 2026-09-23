# A03 — Firefox 155 privacy manifest and rebuilt install smoke — 2026-09-23

Status: `CANDIDATE_READY_FOR_C / FIREFOX_PACKAGE_AND_INSTALLED_SMOKE_PASS / FUNCTIONAL_MATRIX_OPEN`

This receipt resolves the Firefox `data_collection_permissions` packaging gate discovered by the earlier real-vendor installed smoke. It does **not** claim full Firefox Work/Ozon/WB browser acceptance, LIVE_OWNER, AMO publication, deployment, Android support, or production acceptance.

## Product/privacy classification

The Firefox carrier now declares the data categories actually transmitted outside the browser by the current Octoport control-plane contract:

- `authenticationInfo` — device authorization, account-service registration/exchange/refresh data and bearer-authenticated control-plane operation;
- `personallyIdentifyingInfo` — account/device/store identifiers and the bounded store metadata synchronized by `seller_agents_sync_v1`.

The declaration deliberately does not claim `websiteContent`, `personalCommunications`, browsing history, search terms, location, health, or financial/payment data. Marketplace credentials and raw seller reports remain local under the product privacy boundary. `technicalAndInteraction` is not declared as required: Mozilla permits it only as optional data collection and the current product does not implement telemetry/metrics consent as an optional feature.

Mozilla's built-in data-collection consent is available on Firefox desktop 140+. The Firefox carrier therefore raises `browser_specific_settings.gecko.strict_min_version` from `121.0` to `140.0` instead of inventing a custom legacy-consent flow. No `gecko_android` block is added; Android is not an A03 supported target.

Primary-source basis reviewed during implementation:

- Mozilla Extension Workshop: Firefox built-in consent for data collection and transmission (desktop 140+, taxonomy, legacy-version choices).
- MDN `browser_specific_settings`: `data_collection_permissions` schema and desktop/Android version boundary.

## Changed A-owned files

- `tooling/build/extension_firefox.py`
  - emits required Firefox data collection categories;
  - sets desktop `strict_min_version` to `140.0`;
  - records the declaration in the deterministic composition receipt.
- `tests/regression/extension-core/firefox-package-contract.mjs`
  - asserts Firefox background carrier, Gecko ID, desktop minimum version, exact required collection categories, and generated background presence.

No backend, shared contract, DB, migration, lockfile, marketplace runtime, or production service change is included.

## Deterministic package evidence

Source runtime: exact common A01 runtime already used by the real Opera acceptance.

Rebuilt Firefox package:

- file: `SELLER_AGENTS_I1_C1_v0.2.4_FIREFOX_LOCAL_DEVELOPMENT.zip`;
- SHA-256: `5d81918c08599b7810731fa7d240e7a071acdfb210fdb289c270891164f47919`;
- repeat archive identity: PASS (builder receipt);
- `firefox_background.js` Node syntax: PASS;
- permanent `firefox-package-contract.mjs`: PASS;
- required data collection: `authenticationInfo`, `personallyIdentifyingInfo`.

Evidence root:
`/root/octoport-control/logs/A/A03_FIREFOX155_PRIVACY_R2/`

## web-ext validation

Tool: `web-ext 10.5.0` via `pnpm dlx`; repository lockfile unchanged.

Result:

- errors: `0`;
- notices: `0`;
- warnings: `1`;
- only warning code: `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`.

The prior desktop warning is gone. The remaining warning is retained, not suppressed: the carrier is intentionally desktop-only and no `gecko_android` support claim is added merely to silence lint. Firefox Android is outside the supported browser matrix for this product task.

Evidence:
`/root/octoport-control/logs/A/A03_FIREFOX155_PRIVACY_R2/package/lint.json`

## Real vendor Firefox installed smoke on rebuilt package

Browser:

- Mozilla Firefox `155.0.1`, official Linux x86_64 release tarball;
- official Mozilla SHA-256 and downloaded tarball both `642ab731354a5ca790b894d4556dfb5028c61d0c24eb10d10e10a111a69c89bf`.

Using the rebuilt runtime and a fresh isolated profile, `web-ext run` recorded:

- Firefox devtools server startup;
- `installTemporaryAddon` for `seller-agents@example.test`;
- `Installed ... as a temporary add-on` for the rebuilt runtime.

The wrapper exit `124` is the intentional 35-second bound after successful temporary installation, as in the previous smoke; the acceptance script required the explicit install proof before returning success.

Evidence:
`/root/octoport-control/logs/A/A03_FIREFOX155_PRIVACY_R2/install/web-ext-run.log`

## Remaining A03 Firefox boundary

- Real Firefox carrier acquisition/integrity: PASS.
- Firefox packaging/privacy declaration: PASS for desktop carrier semantics.
- Real Firefox temporary installation of the rebuilt package: PASS.
- Full Firefox functional Work/Ozon/WB/browser matrix: OPEN / NOT CLAIMED.
- AMO/public release: NOT PERFORMED; publication remains outside this prompt.

## Post-recovery deterministic readback

After a transient worktree-state turnover, the exact verified builder/test patch was restored and rebuilt from the same common runtime under a fresh evidence root:

`/root/octoport-control/logs/A/A03_FIREFOX155_PRIVACY_REBUILD_R3/`

Readback results:

- rebuilt ZIP SHA-256: `5d81918c08599b7810731fa7d240e7a071acdfb210fdb289c270891164f47919` — exact match with the previously installed R2 carrier;
- repeat archive identity: PASS;
- permanent Firefox package contract: PASS;
- `web-ext lint`: 0 errors, 0 notices, 1 warning;
- sole warning: `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`, retained because this carrier is desktop-only and no Android support claim is added.

Because R2 and R3 package SHA-256 values are identical, the R2 real Firefox `installTemporaryAddon` evidence applies to the exact committed carrier bytes without rerunning an identical installation.
