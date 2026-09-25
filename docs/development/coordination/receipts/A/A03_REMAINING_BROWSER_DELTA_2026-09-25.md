# A03 — remaining browser delta after RESOLVED-v2 repair — 2026-09-25

Status: **YANDEX BETA REAL_BROWSER + DISPOSABLE_API PASS / BRANDED CHROME CURRENT ENVIRONMENT GATE / NOT LIVE**

## Boundary

Controller queue: `CONTINUOUS-ROADMAP-20260925 / A03_REMAINING_BROWSER_DELTA`.

Accepted server/client repair main:
`e7d66152bdb77918b65115486c9829ef7a634e69`.

A integrated boundary under browser checks:
`0c5acb8ce0809360c1632a307087220226fc2cc1`.

The repair changes generic identified profile validation from rejecting signed current `control_plane_v2` profiles to accepting the signed envelope contract, while retaining legacy identified v1 and rejecting unsupported v3. Therefore old C1 browser matrices do not by themselves prove the repaired RESOLVED-v2 path.

## Yandex Browser Beta — affected path exercised

Real vendor binary:
- Yandex Browser Beta package `26.8.1.1101-1`;
- executable `/root/octoport-control/browsers/A/yandex-beta-26.8.1.1101-1/unpack/opt/yandex/browser-beta/yandex-browser-beta`;
- browser reports `Yandex 26.8.1.1101 beta`;
- runtime identity is `yandex_chromium 26.8.0.0`.

Accepted evidence:
`/root/octoport-control/logs/A/A03_RESOLVED_V2_REAL_BROWSER_PARITY_20260925_R12_YANDEX/result.json`.
SHA-256: `7d7b6dafaecbc1988628361c68763ab1c98ca68bf5bd6f0ce6d6ad1bd413eff4`.

Result: **PASS**.
- real Yandex Beta loaded the exact current common runtime;
- role-A disposable PostgreSQL + actual loopback API/portal modules were used;
- device authorization/exchange completed with fixture-only identity/OTP/signing material;
- signed bootstrap returned HTTP 200 `RESOLVED`;
- profile contract is `control_plane_v2`;
- profile browser family is exactly `yandex_chromium`;
- runtime `canWork = true`;
- identified bootstrap body contains the expected browser/extension metadata fields;
- live provider calls = 0.

Safe network evidence stores only method/path/status/request-body field names; authorization UUIDs are normalized and fixture email values are omitted.

R11 did not reach browser execution: the new harness still compared fixture browser families to the earlier Opera/Firefox constant. It exited before the browser with `FIXTURE_PROFILE_BROWSER_MISMATCH`, cleanup verified, and is not product evidence. R12 is the corrected accepted run.

## Branded Google Chrome — current affected path environment gate

Real browser: Google Chrome `147.0.7727.116`.

Current-runtime probe used the common runtime built from A boundary `0c5acb8c...` and a clean disposable profile through the same bounded automated unpacked route used by prior Chrome A03 investigation.

Evidence:
`/root/octoport-control/logs/A/A03_CHROME147_CURRENT_E7D_R1/summary.json`.
SHA-256: `386df94ec9e2bb793010b477c8649c3a2934f17fbc48ce461fa907931a4836d7`.

Result: **PASS_ENVIRONMENT_GATE**, not product PASS and not product FAIL.
- Seller Agents target count: `0`;
- browser exposed two unrelated built-in extension targets;
- Chrome explicitly logged `--disable-extensions-except is not allowed in Google Chrome, ignoring.`;
- therefore the repaired RESOLVED-v2 runtime never executed inside branded Chrome in this route.

The previously retained Developer Mode UI probe still shows the `Load unpacked` control, but automated activation did not expose a controllable file chooser or install a Seller Agents target. No native picker, browser policy, security control, store installation, or owner interaction was bypassed. Repeating that same UI experiment has no information gain.

Thus the current branded-Chrome missing scenario remains a legitimate installed-route environment gate. Chromium/Opera evidence is not relabeled as Chrome.

## What was deliberately not repeated

- Yandex BR-C1 `38/38 source + 38/38 extracted` matrix remains historical accepted evidence for unchanged C1 behavior and was not rerun.
- Opera R8 and Firefox R10 RESOLVED-v2 parity are already accepted and were not repeated.
- Chrome full matrix was not started because no Seller Agents runtime target exists in a legitimate controllable branded-Chrome environment.
- No marketplace/provider credential, owner session, live API, deployment, store upload or production mutation was used.

## Disposition

The newly affected RESOLVED-v2 browser path now has real-browser/disposable-API proof for Opera, Firefox and Yandex Beta. Branded Chrome remains explicitly environment-gated rather than silently inferred from Chromium.

Still external/release-specific:
- legitimate branded-Chrome installed/store route;
- Yandex stable/store-installed route and update path;
- LIVE_OWNER marketplace acceptance;
- store moderation/publication and deployment.

Next A queue item: `A04_BUSINESS_COVERAGE` under `CONTINUOUS-ROADMAP-20260925`.
