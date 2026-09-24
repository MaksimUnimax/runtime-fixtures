# A06 — deterministic legacy backup import identity — 2026-09-23

Status: **A-SIDE VERIFIED BLOCK / READY FOR C INTEGRATION REVIEW**
Task: `A06`
Role: `A`

## Defect

The supported legacy Ozon/Wildberries adapters generated a fresh random `storeId` and `credentialRevision` on every decode.
Popup preview and explicit apply decode the same backup independently, so preview and apply could describe different local identities. Re-importing the same historical file could also appear as a new store instead of `SAME_CURRENT`.

The owner intake was inspected only for non-secret format metadata. Relevant actual formats are:
- Ozon `ozon-bridge-credentials-backup` v2, with Seller + Performance present;
- Wildberries `wildberries-bridge-seller-credentials-backup` v2.
No raw credential values were copied to Git, evidence, or chat.

## Fix

Legacy identity is now deterministic and account-scoped.
It is derived from canonical non-secret immutable export metadata: Seller Agents account id, marketplace, legacy format/version, exported timestamp, legacy extension version and extension id.
Credential material is not an identity input.
The original legacy export timestamp is retained as the imported payload creation time.
This preserves fail-closed conflict behavior:
- same legacy file + same Seller Agents account -> same store identity and credential fence;
- same legacy file + another Seller Agents account -> different identity;
- changed credentials under the same legacy metadata do not silently overwrite an existing local store because catalog comparison still detects credential-content mismatch.

## Verification

Focused command:
`node tests/regression/extension-core/client-i1/client-d3s2-a24-export-import.mjs`

RED before fix: deterministic legacy identity assertion failed because two decodes returned different `storeId` values.
GREEN after fix: all 10 A24 grouped cases PASS.

Regression covers:
- historical Ozon seller-only v1;
- Ozon Seller+Performance v2 matching the owner intake format;
- Wildberries seller-token v2 matching the owner intake format;
- independent preview-plan decode followed by independent apply decode;
- repeated same-file plan -> `SAME_CURRENT`;
- cross-account identity separation;
- prior encryption, tamper, bounds, conflict, atomic-write and privacy cases.

Syntax: `node --check packages/bridge-core/src/stores/backup.js` PASS.
Ownership guard: only A-owned `backup.js` and A24 regression changed before this receipt.

Full source+package gate:
- evidence: `/root/octoport-control/logs/A/A06_LEGACY_IMPORT_IDENTITY_CORE_R1/summary.json`;
- status: PASS;
- gate processes: 118;
- live provider calls: 0;
- installed acceptance: false;
- package SHA-256: `f9fb2065688d36ee0a2febe0f53a7a455e5c0f8dbcd5e97f15ca7e6d7a2a2762`;
- repeat archive match and source/extracted byte identity: PASS.

Resource receipt:
`/root/octoport-control/resource-jobs/91813c4dcd0d440eac1ee6861f609195/receipt.json`
Peak: 182452224 bytes; OOM: 0; cleanup_verified: true.

No LIVE_OWNER import, provider mutation, browser release acceptance, store publication, deployment, or production action was performed.
