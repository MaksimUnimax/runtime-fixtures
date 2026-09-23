# C02 A03 Firefox intake receipt — 2026-09-23

Role: C
Evidence level: SOURCE + PACKAGE + INSTALLED_SYNTHETIC / real vendor temporary-install evidence from exact A carrier bytes.
LIVE_OWNER, AMO publication, deployment and production acceptance: NOT CLAIMED.

## Exact intake

- A submitted candidate: `c7301c15d837784bd5d0b966eb8089b9102b38f4`.
- Candidate base: `de45ce6c6b9dc99c79c4140e28043e17f10fdda5`.
- A01 `5f2c8d97b9c68930f1b38b229c7efb7e9adca6b8` is an ancestor of A03 and had already been integrated separately; merge did not duplicate or substitute later A work.
- A03 was merged exact into C without conflicts.
- Integration HEAD immediately after A03 intake: `f65f4692a34a0b9fa8aa6d9dc9082d34f561fa9e`.

## Scope reviewed

Runtime changes after the already-reviewed A01 fix are limited to the Firefox carrier:
- `tooling/build/extension_firefox.py`;
- `tests/regression/extension-core/firefox-package-contract.mjs`;
- bounded A03 browser-family evidence receipts.

The builder now:
- emits Firefox MV3 `background.scripts`;
- declares Gecko ID `seller-agents@example.test`;
- raises desktop `strict_min_version` to `140.0`;
- declares required data-collection categories `authenticationInfo` and `personallyIdentifyingInfo`;
- records the declaration in the deterministic carrier receipt.

## C read-back verification

C rebuilt the committed Firefox carrier from the exact preserved common runtime used by A:
`/root/octoport-control/logs/A/A01_PENDING_LOCK_FIX_R1/package/runtime`.

Result:
- ZIP SHA-256: `5d81918c08599b7810731fa7d240e7a071acdfb210fdb289c270891164f47919`;
- exact match to A03 R2/R3 carrier SHA used for the real Firefox temporary-install evidence;
- repeat archive identity: PASS;
- `firefox_background.js` Node syntax: PASS;
- permanent `firefox-package-contract.mjs`: PASS;
- required data collection: exactly `authenticationInfo`, `personallyIdentifyingInfo`.

Because the rebuilt bytes exactly match the A-installed carrier, A's real Firefox 155.0.1 `installTemporaryAddon` proof refers to the exact committed carrier bytes.

## Remaining browser boundaries

A03 remains a bounded disposition, not full browser-release acceptance:
- Opera C1 installed-synthetic matrix: PASS per A evidence.
- Chrome branded installed route: environment gate OPEN.
- Yandex installed/developer-mode route: environment gate OPEN.
- Firefox full Work/Ozon/WB functional matrix: OPEN.
- Safari real macOS/Xcode/Safari gate: OPEN.
- AMO/public publication: NOT PERFORMED.

No browser family is accepted from another family's evidence.
