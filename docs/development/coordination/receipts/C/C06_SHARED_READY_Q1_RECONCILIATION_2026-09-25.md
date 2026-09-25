# C06 shared-ready Q1 reconciliation — 2026-09-25

Status: CANDIDATE / EVIDENCE BOOKKEEPING ONLY / NOT LIVE / NOT DEPLOYED

Base accepted main:
`395d7625f87ea7daf5c42f7f8c593e5837c116c9`.

Reviewed patch:
- source worktree `/root/octoport-control/worktrees/C/c06-shared-ready-q1-r2`;
- patch SHA256 `e43cee421b226a85074e6a267c7eec2331e135dd15da0a4e761ee2896649d003`;
- only `docs/product/readiness/OWNER_Q1_CROSSWALK.tsv` changes;
- exactly three `Статус_новой_сборки` cells change.

No product/runtime/package/schema/live/store behavior changes.

## Reconciled rows

### Q1C-EXT-03 — extension authorization/device binding

New bounded status:
`PASS_REAL_BROWSER_DISPOSABLE_DEVICE_AUTH__LIVE_OWNER_LOGIN_BINDING_OPEN`.

Evidence:
- accepted A03 real Opera 136 + disposable API parity;
- identified device authorization/exchange completed;
- fixture-only account/OTP/signing material;
- signed RESOLVED v2 bootstrap;
- no LIVE_OWNER/provider/deployment claim.

The owner-authenticated login/binding check remains explicitly open.

### Q1C-AUTH-02 — logout/re-login invalidation

New bounded status:
`PASS_AUTOMATED_SESSION_INVALIDATION__LIVE_OWNER_RELOGIN_AND_NEW_SESSION_VALIDITY_OPEN`.

Evidence:
- current P2.4 PostgreSQL auth/token-core suite: 12/12 PASS;
- refresh rotation/replay expiry and durable account/session/device authority fail closed;
- accepted client authority evidence covers logout/reset/revocation/account/device/session mismatch invalidation.

The owner mailbox re-login and proof that the new live session is valid remain explicitly open.

### Q1C-EXPORT-25 — export/import owner UX

New bounded status:
`PASS_INSTALLED_SYNTHETIC_EXPORT_IMPORT__LIVE_OWNER_UX_OPEN`.

Evidence:
- A24 is `ACCEPTED_BOUNDED_AUTOMATED`;
- EX-01..EX-74;
- installed source/generated and extracted/package export/import journeys;
- same-account clean-profile import;
- zero mandatory server/provider/AI calls for the local backup route.

The owner-driven live export/import UX remains explicitly open.

## Independent review

First Luna read-only review:
- Q1C-EXT-03: accepted as written;
- Q1C-EXPORT-25: accepted as written;
- one Medium on Q1C-AUTH-02 because the first label did not explicitly preserve the criterion that the new session must be valid;
- final verdict: `NEEDS_CHANGES`.

Correction:
- Q1C-AUTH-02 changed to
  `PASS_AUTOMATED_SESSION_INVALIDATION__LIVE_OWNER_RELOGIN_AND_NEW_SESSION_VALIDITY_OPEN`.

Second Luna read-only review:
- High: none;
- Medium: none;
- Low: none;
- final verdict: `READY_TO_APPLY`.

The review confirmed no LIVE_OWNER, store, deployment, provider or production acceptance is implied.
