# A03 — browser matrix bounded disposition — 2026-09-23

Status: `PARTIAL_ENVIRONMENT_DEFERRED / BOUNDED_A03_RESULT / NOT_FULL_BROWSER_RELEASE_ACCEPTANCE`

This receipt aggregates browser-specific evidence without transferring results between browser families.

## Exact A line

- Current stream: `A / work/a-extension`.
- A01 product fix: `5f2c8d97b9c68930f1b38b229c7efb7e9adca6b8`.
- Main was merged after A01 with zero overlap across the 103 package-composition inputs used by the exact A01/Opera package.
- Common Chrome/Opera/Yandex package SHA-256 used for A03 evidence: `b34511e7eec358fb398d304d5274fed788824438193ee5412b44d8b451f33017`.
- Firefox package SHA-256 after privacy-manifest correction: `5d81918c08599b7810731fa7d240e7a071acdfb210fdb289c270891164f47919`.

## Browser-by-browser result

| Browser | Real environment | Package/install | Browser-specific result | Remaining gate |
|---|---|---|---|---|
| Opera 136.0.6008.22 | real vendor browser on Linux | exact common package loaded | `BR-C1-01..38`: **38/38 source + 38/38 extracted PASS** using ten clean-profile shards | broader release scenarios outside this C1 matrix remain separate A04/release work |
| Google Chrome 147.0.7727.116 | real branded Chrome on Linux | package ready; branded command-line unpacked route refused/ignored | **no Seller Agents target**; product defect not proven | legitimate controllable branded-Chrome installed route required |
| Yandex Browser 26.8.1.1111-1 | real vendor browser on Linux | package ready; current automated load-flags route registers no Seller Agents target | headless enumeration: **0 service workers**; headed CDP: **0 `chrome-extension://` Seller Agents targets** | legitimate Developer-Mode/installed route required; do not bypass browser controls |
| Firefox 155.0.1 | real Mozilla vendor tarball on Linux, SHA verified | deterministic Firefox carrier; rebuilt privacy-manifest carrier `5d81918c…`; `web-ext` temporary install **PASS** | real add-on ID `seller-agents@example.test` installed; Firefox package declares required `authenticationInfo` + `personallyIdentifyingInfo` | full Firefox Work/Ozon/WB functional matrix OPEN; AMO/publication itself NOT PERFORMED |
| Safari | no real Safari on Linux | no local Safari packager/runtime | **NOT TESTED** | real macOS/Xcode/Safari environment required |

## Important method findings

### Opera long-context instability

A single long Opera context previously accumulated browser/Playwright instability and produced intermittent BR-C1-24/28 plus later popup/driver crashes. Re-running all 38 cases in ten bounded clean-profile shards preserved every scenario while producing **76/76 PASS** across source and extracted runtimes. Therefore the long-context failures are retained as harness/browser stability evidence and are not treated as independent product defects.

### Chrome and Yandex

The absence of Seller Agents targets occurs before product runtime execution. Chromium/Opera success is not transferred. Both are environment/install-route gates, not product PASS and not product FAIL.

### Firefox

Real vendor Firefox installation is proven independently. The current Chromium-oriented browser acceptance harness cannot simply be pointed at stock Firefox: Playwright's Firefox automation transport is not a valid substitute for an unmodified vendor Firefox browser. A new Firefox-specific functional control harness would be an architectural/tooling expansion and is not silently invented inside this bounded A03 pass.

The missing Firefox data-collection declaration was resolved from Mozilla's built-in-consent taxonomy and the actual Octoport outbound contract. The rebuilt desktop carrier declares required `authenticationInfo` and `personallyIdentifyingInfo`, raises desktop `strict_min_version` to `140.0`, and retains only the expected `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` lint warning because Android is not a supported A03 target. AMO/public publication itself remains unperformed.

## Evidence receipts

- `docs/development/coordination/receipts/A/A03_OPERA_REAL_BROWSER_MATRIX_2026-09-23.md`
- `docs/development/coordination/receipts/A/A03_YANDEX_ENVIRONMENT_GATE_2026-09-23.md`
- `docs/development/coordination/receipts/A/A03_CHROME147_ENVIRONMENT_GATE_2026-09-23.md`
- `docs/development/coordination/receipts/A/A03_FIREFOX155_INSTALLED_SMOKE_2026-09-23.md`
- `docs/development/coordination/receipts/A/A03_FIREFOX155_PRIVACY_MANIFEST_2026-09-23.md`
- `docs/development/coordination/receipts/A/A03_SAFARI_ENVIRONMENT_GATE_2026-09-23.md`

## A03 disposition

A03 has a complete **bounded browser-family accounting** for the currently reachable environments, but it is **not full browser-release acceptance**:

- Opera C1 installed-synthetic matrix: PASS.
- Chrome: environment/install-route deferred.
- Yandex: environment/install-route deferred.
- Firefox: real installed smoke PASS on rebuilt privacy carrier; functional matrix open; AMO/public publication not performed.
- Safari: real macOS environment deferred.

No browser family is accepted based on another browser's evidence. Remaining environment gates stay visible for release planning and owner/controller review.
