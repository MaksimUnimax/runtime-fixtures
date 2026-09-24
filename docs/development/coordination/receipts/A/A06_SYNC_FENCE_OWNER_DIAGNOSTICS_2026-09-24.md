# A06 — owner-facing N2 sync fence diagnostics — 2026-09-24

Status: **A-SIDE VERIFIED BLOCK / READY FOR C INTEGRATION REVIEW**
Task: `A06`
Role: `A`

Product commit:
`e54b799556830c4d7a7e55fddd94b7c9b3738e28`

## Problem

After the N2 reconciliation work, three legitimate fail-closed outcomes could reach the popup as raw `SYNC_*` codes. That is technically correct but not usable beta UX for a non-programmer owner.

The bounded fix maps only these existing codes to owner-facing Russian guidance:
- `SYNC_EXPLICIT_BINDING_CONFLICT`: another installation has a conflicting dialogue binding; automatic store switching stays blocked and the owner is told to verify the store and explicitly Start again;
- `SYNC_SERVER_FINISH_FENCE`: a newer server-confirmed Work Finish exists; the owner is told to explicitly Start again;
- `SYNC_NEWER_BINDING_FENCE`: a newer server-confirmed dialogue binding exists; the owner is told to verify the store and explicitly Start again.

No decision, retry, reconciliation, authorization, storage, sync wire, marketplace request, or server contract changed.
## Verification

Exact-head evidence root:
`/root/octoport-control/logs/A/a06-sync-fence-owner-diagnostics-e54b799`

Deterministic development package:
- ZIP SHA-256: `123f2b3b336fff778188035f1e730ac51f6355d7d605355050cfd6b6d2c2252b`;
- repeat archive match: PASS;
- source/extracted byte identity: PASS.

On both source runtime and extracted runtime:
- `client-support-snapshot.mjs`: PASS;
- popup JavaScript syntax: PASS;
- the regression extracts the real popup `texts` map and proves all three N2 codes have non-raw actionable owner text.

Focused resource receipt:
`59f0b1640fcf41e082028020391b974b`
- exit: 0;
- OOM: 0;
- cleanup verified: true.

Build resource receipt:
`6b127593c9e549c1ba37870a0bcad546`
- exit: 0;
- cleanup verified: true.

## Boundary

This block does not enable N2 snapshot wire fields and does not close the separate Firefox AMO optional-technical-data gate. It makes already-existing safe N2 fences understandable in the popup only. No publication or LIVE_OWNER action was performed.
