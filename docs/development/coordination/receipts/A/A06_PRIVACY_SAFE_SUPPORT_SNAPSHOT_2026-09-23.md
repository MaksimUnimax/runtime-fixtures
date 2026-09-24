# A06 — privacy-safe support snapshot and owner-facing diagnostics

Status: **A-SIDE VERIFIED BLOCK / READY FOR C INTEGRATION REVIEW**  
Task: `A06`  
Role: `A`

This receipt covers one bounded A06 support/diagnostics block. It does **not** claim that all installation/update UX is complete, and it does not claim LIVE_OWNER, deployment, store publication, or browser-family acceptance.

## Scope

Feature commit: `536439cdce5d2caf93e147091ea413f417db56f2`.

Fresh-main merge after verification: `d59aafb272cf27f30edcf9992a8763e601594bd8`.

The A06 runtime/test diff SHA-256 was identical before and after the docs-only main merge:
`9b211229f5edef37a78f260d36536af305d0cbf74fd07fce286a1b1033f5c796`.

Changed A-owned surfaces:

- popup support section with explicit manual generation;
- privileged `SA_SUPPORT_SNAPSHOT` runtime message;
- fixed whitelist support schema;
- owner-facing explanations for existing browser/transfer failure codes;
- source+package regression in `extension_core`.

No backend/shared contract, DB, migration, lockfile, marketplace payload, live service, or publication flow changed.
## Privacy and browser-claim boundary

The snapshot is generated only after the user presses the support button. The extension does not automatically send it anywhere.

Included fields are intentionally bounded to:

- extension version/environment;
- actually observed browser family/version, labeled `OBSERVED_RUNTIME_ONLY`;
- boolean auth/work state and safe error/status codes;
- detected AI family/status;
- bounded work/pending state;
- aggregate Ozon/WB store counts.

The regression explicitly seeds synthetic private store names, Ozon API key material, WB token material, store UUIDs and normal account/device/session UUID-bearing fixture state. The serialized support snapshot must contain none of those values and no UUID at all.

The snapshot explicitly declares that account, device/session, store, conversation, credentials and marketplace payload are not included.

Observed browser identity is diagnostic metadata only. It is **not** presented as proof of official support and does not transfer Opera/Chromium/Firefox evidence to Chrome, Yandex, Safari or another browser family.

## User-facing diagnostics

Existing safe runtime failures now have Russian owner-facing explanations instead of exposing only raw codes, including:

- unsupported/incompatible browser/profile;
- unsupported AI surface;
- source-offline transfer;
- transfer vault unavailable/persist/clear failures;
- missing transfer key;
- transfer account mismatch;
- expired/replayed transfer.

These messages do not alter retry, authority, transfer, replay or safety behavior.
## Verification

Focused privacy regression on the composed runtime from the first A06 build:

- source runtime: **PASS**;
- extracted runtime: **PASS**;
- scope: `A06_PRIVACY_SAFE_SUPPORT_SNAPSHOT`;
- browser evidence marker: `OBSERVED_RUNTIME_ONLY`;
- synthetic store counts: total 2, Ozon 1, WB 1;
- executionAuthority: false.

Final acceptance root:
`/root/octoport-control/logs/A/A06_SUPPORT_SNAPSHOT_R2/`

Final `python3 tooling/checks/extension_core.py`:

- stage: `D2.4`;
- status: **PASS**;
- gate processes: **116**;
- live provider calls: `0`;
- installed acceptance: `false`;
- source support-snapshot: **PASS**;
- extracted support-snapshot: **PASS**;
- repeat archive identity: **PASS**;
- source↔extracted byte identity: **PASS**.

A06 package SHA-256:
`bf10373a308673ca216ba0217a5b2589f38d3d154b9ffa959b9daa2f136fa32b`.

## Remaining A06 boundary

This block closes privacy-safe diagnostics and a bounded set of beta-support error explanations. Broader installation/update UX and later real beta feedback remain separate work and must use their own evidence.

No production/package publication action was performed.
