# C STORE 0.2.9 release candidate — 2026-09-29

Status: **SOURCE + PACKAGE PASS / INSTALLED RETEST PENDING / NOT PUBLISHED**

## Why 0.2.9

Frozen STORE 0.2.8 remains immutable. After C completed exact 0.2.8 compatibility, A reproduced an installed Start failure when the optional Health observation returned HTTP 503 `BOOTSTRAP_UNAVAILABLE`. Exact A candidate `0ae5bbe7fd4fff13c6831896dda6c282eb131ea1` adds the bounded availability classification and a focused regression; C independently re-ran source/extracted online-work, signed-Health and offline-lifecycle checks before intake.

Because product runtime bytes changed, the fix is released as a new patch version instead of rebuilding or relabelling 0.2.8.

## Exact release-source identity

- source HEAD: `74882ec31433ef1840cdea111f2ac6246d5ce3bb`
- source tree: `63c4e76e4d1bb2f8b29a585ca2d46b105b5dd19e`
- parent accepted A candidate: `0ae5bbe7fd4fff13c6831896dda6c282eb131ea1`
- product version: `0.2.9`
- contract: `control_plane_v2`
- migration level: `54`
- release authority SHA-256: `ec1bdbc7313ea1c727199649f96625fa805e99cc12f5598d7ad6f728d3addb1c`

The release-source worktree deliberately branches before source-only B0055. This prevents the 0.2.9 package authority from falsely requiring migration 55 while live owner-test PostgreSQL remains on the accepted level 54. B0055 remains a separate source-only intake and is not applied live.

## Frozen package bytes

Chromium / Opera-family STORE package:

- path: `/root/octoport-control/logs/C/store-release-029-74882ec3/candidate/OCTOPORT_v0.2.9_CHROMIUM_STORE.zip`
- SHA-256: `f409e35fb714139cc5eefd6c3b390d5d2ca89fb9567a58cb3b68157e1f62eeae`
- bytes: `2273193`
- inventory entries: `44`

Firefox STORE package:

- path: `/root/octoport-control/logs/C/store-release-029-74882ec3/candidate/OCTOPORT_v0.2.9_FIREFOX_STORE.zip`
- SHA-256: `be2d603f34c43c5c95aa4e7e83b5c842d39b5ac7590ebb49464fec46f2396542`
- bytes: `4214684`
- inventory entries: `45`

Both archives are deterministic. Chromium runtime/extracted bytes match their declared inventory; Firefox is the existing common-runtime derivative with the established MV3 event-page/data-disclosure packaging differences.

## Independent C verification

Pre-commit release identity verification:

- `tooling/b1/release-safety.test.mjs`: **42/42 PASS**
- `tests/regression/extension-core/store-package-contract.py`: **PASS**
- exact STORE technical package identity: **7/7 PASS**
- deterministic development composition: **PASS 0.2.9**
- resource job: `ffad250cb60d4b7da3683dbcff6c063a`, exit 0, OOM 0, cleanup verified

Exact STORE package generation / package gate:

- B1 prepare: **PREPARED**
- B1 preflight: **PASS / PACKAGE**
- target migration level: **54**
- STORE C1 online-work admission on source runtime: **PASS**
- STORE C1 online-work admission on extracted Chromium ZIP: **PASS**
- resource job: `d4df29fa566e4a5fbdef4cff23025c1e`, exit 0, OOM 0, cleanup verified
- summary: `/root/octoport-control/logs/C/store-release-029-74882ec3/store029-package-summary.json`

A handoff:
`/root/octoport-control/peer-handoffs/A/C-A-STORE029-EXACT-PACKAGE-20260929.request.json`

## Current boundaries

- Frozen 0.2.8 is not modified and remains REWORK_REQUIRED for the installed Start boundary.
- 0.2.9 is SOURCE+PACKAGE only until A retests the exact changed installed Start/visibility/Finish boundary.
- 0.2.9 compatibility release/policy/config is not activated by this receipt.
- No live migration 0055 was applied.
- No provider call, AI send, store submission, production deployment or external acceptance is claimed.
- Current C integration may contain source-only B0055, but that does not change the frozen package authority above.
