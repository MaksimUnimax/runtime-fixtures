# A06 — popup action diagnostics — 2026-09-24

Status: **A-SIDE VERIFIED BLOCK / READY FOR C INTEGRATION REVIEW**
Task: `A06`
Role: `A`

Product commits:
- `2aa02fb42de735426f7d7ee441218eca4db8003d` — explicit owner guidance for the audited popup-facing failures;
- `3ff3f2ac40d470d96cafb8f3761d776a52cbd034` — safe common fallback for unmapped popup/auth/verification error codes.

## Scope

A bounded audit of actual popup actions found safe runtime failures that still fell through to a raw-code-only message.

Explicit owner-facing guidance is present for 15 actionable codes covering:
- N2 binding/Finish reconciliation;
- conversation mismatch/unbound state;
- Start/Resume already-active state;
- signed Work authority denial/refresh;
- invalid signed bootstrap snapshot;
- account change during backup;
- backup confirmation/explicit apply;
- invalid/obsolete credential-transfer request.

The follow-up adds one shared `ownerErrorText()` fallback for unmapped codes:
- known audited codes still use their specific guidance;
- an unknown code is accepted only if it matches `^[A-Z0-9_]{1,80}$`;
- the owner gets a generic recovery instruction plus the sanitized code for support;
- an unsafe/arbitrary string is replaced by `UNKNOWN`, so it is not reflected into popup text;
- auth last-error, provider verification rows, and normal popup request failures use the same helper.

Internal delivery/actor/legacy-only codes were deliberately not promoted into new dedicated owner messages.
No authority, retry, sync, transfer, backup, storage, marketplace request, or server behavior changed.

## Verification

Exact current product-head evidence root:
`/root/octoport-control/logs/A/a06-popup-safe-fallback-exact-3ff3f2a`

Exact development package:
- ZIP SHA-256: `69038665befe80e2b92007857cf96867a96567bd763244d61f0adc377b65af55`;
- repeat archive match: PASS;
- source/extracted byte identity: PASS.

Both source and extracted package:
- `client-support-snapshot.mjs`: PASS;
- popup JavaScript syntax: PASS.

The regression extracts the actual composed popup `texts` object and `ownerErrorText()` helper. It proves:
- all 15 audited actionable codes resolve to non-raw owner-facing text;
- a mapped N2 code returns the specific message;
- an unmapped safe code returns generic guidance plus its support code;
- unsafe arbitrary text is not reflected and becomes `UNKNOWN`;
- auth-status, provider verification, and request-error paths use the helper;
- existing privacy-safe support snapshot and signed update advisory assertions remain PASS.

Build resource receipt:
`32dd2a37c9124ee18f13091d6ae556b0`
- exit 0; OOM 0; cleanup verified.

Focused resource receipt:
`ba4aeb74430e42348c9571d3cc802092`
- exit 0; OOM 0; cleanup verified.

## Boundary

This is UX/error explanation only. It does not enable N2 snapshot wire fields, change fail-closed decisions, close Firefox AMO privacy requirements, or claim LIVE_OWNER/store publication acceptance.
