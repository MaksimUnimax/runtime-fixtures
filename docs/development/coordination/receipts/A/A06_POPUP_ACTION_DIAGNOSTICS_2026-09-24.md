# A06 — popup action diagnostics — 2026-09-24

Status: **A-SIDE VERIFIED BLOCK / READY FOR C INTEGRATION REVIEW**
Task: `A06`
Role: `A`

Product commit:
`2aa02fb42de735426f7d7ee441218eca4db8003d`

## Scope

A bounded audit of actual popup actions found safe runtime failures that still fell through to the generic raw-code message.

Owner-facing guidance is now present for 15 actionable codes covering:
- N2 binding/Finish reconciliation;
- conversation mismatch/unbound state;
- Start/Resume already-active state;
- signed Work authority denial/refresh;
- invalid signed bootstrap snapshot;
- account change during backup;
- backup confirmation/explicit apply;
- invalid/obsolete credential-transfer request.

Internal delivery/actor/legacy-only codes were deliberately not exposed as new popup UX.
No authority, retry, sync, transfer, backup, storage, marketplace request, or server behavior changed.
## Verification

Exact-head evidence root:
`/root/octoport-control/logs/A/a06-popup-owner-actions-exact-2aa02fb`

Exact development package:
- ZIP SHA-256: `de4299d321838cf6804be2ef4711b2882042720e5be1b144b81f920182d797ee`;
- repeat archive match: PASS;
- source/extracted byte identity: PASS.

Both source and extracted package:
- `client-support-snapshot.mjs`: PASS;
- popup JavaScript syntax: PASS.

The regression extracts the actual composed popup `texts` object and asserts that all 15 actionable codes resolve to non-raw owner-facing text. Existing privacy-safe support snapshot and signed update advisory assertions remain PASS.

Build resource receipt:
`c415987ab42f455798be5d500ac5382a`
- exit 0; OOM 0; cleanup verified.

Focused resource receipt:
`cc488a01ff734750bcd445f3d28cee28`
- exit 0; OOM 0; cleanup verified.

## Boundary

This is UX/error explanation only. It does not enable N2 snapshot wire fields, change fail-closed decisions, close Firefox AMO privacy requirements, or claim LIVE_OWNER/store publication acceptance.
