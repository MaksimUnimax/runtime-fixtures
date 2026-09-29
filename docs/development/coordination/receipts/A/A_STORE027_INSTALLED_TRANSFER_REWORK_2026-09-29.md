# A — STORE 0.2.7 installed transfer rework — 2026-09-29

Status: **SOURCE FIX VERIFIED / PATCHED INSTALLED_SYNTHETIC PASS / OFFICIAL STORE 0.2.7 TRANSFER NOT_ACCEPTED / OFFICIAL STORE 0.2.7 RESET-REAUTH PASS / NEW VERSIONED PACKAGE REQUIRED**

Task: `A_EXACT_TECHNICAL_LIFECYCLE_REMAINDER_20260929`.

## Accepted dependency and exact official bytes

C handoff `A-C-STORE027-BOOTSTRAP-COMPAT-20260929-0349-R2` is DONE.
Accepted C operator source is `1914cd415e62fa5024272d4abb7822800c6193fd`;
branch CI and post-main CI are both 5/5 SUCCESS.

The authoritative Chromium STORE 0.2.7 candidate remains:
- source `ce7685b7a534015923116576262e41958915afbb`;
- tree `d95d93ae044b10668f0f1dce526d473867495e99`;
- contract `control_plane_v2`, migration level 54;
- SHA-256 `1c11bf6008b923af050f44bdaa97ab6b5197fda744c4a10aef5209f3efc95dc7`;
- Opera `136.0.6008.22`.

R2 readback proves extension/browser SUPPORTED, signed ChatGPT/web/null profile
revision 2 RESOLVED, assignment DIRECT revision 2, beta CLOSED, and no direct SQL,
provider or AI-send activity. This authorizes technical installed acceptance only.
## Two fresh official STORE 0.2.7 installations

A created two new protected Opera profiles and restored them through the normal
technical device authorization flow using the already-authorized protected portal
session. No `authenticated` or `workAllowed` state was injected.

Both source and recipient:
- loaded the exact official SHA above with 44 runtime files;
- used Opera 136.0.6008.22;
- submitted a normal device approval;
- observed authenticated state with zero stores;
- produced no popup page errors;
- closed under supervised resource cleanup.

Evidence lives under
`/root/octoport-control/logs/A/owner-test-opera-027-lifecycle-20260929-r2/`.

The first exact lifecycle run exposed a harness-only race:
background store save had committed, but the harness read `#stores` before the
popup storage-change refresh. Read-only reopen proved catalogCount=1,
selectOptionCount=1 and a non-empty selected value. The synthetic residue was then
deleted through the normal popup UI. The harness now waits for the select refresh.
## Official 0.2.7 product defect

After the harness timing correction, the official STORE bytes successfully reached
the first credential import. The recipient received the credential only after the
explicit Receive action and the durable result was consumed.

The next Receive exposed a product UI defect. Runtime
`SA_TRANSFER_RECEIVE_PENDING` intentionally returns non-success states
`PENDING` (nothing left to receive) and `SOURCE_OFFLINE`, but popup.js routed
the call through the generic request helper, which throws on every `ok=false`.
Therefore the intended idle/offline transfer-status UI branches were unreachable.

Transport/no-replay itself is intact: the exact extracted 0.2.7 runtime passes
`client-transfer-recipient-recovery.mjs` TRR-01 through TRR-08, including durable
recovery, no re-import, completed replay handling, concurrent receive and vault
cleanup.

Because the defect is in shipped `popup.js`, the immutable official STORE 0.2.7
SHA remains **NOT_ACCEPTED for installed transfer**. Its bytes must not be replaced.
## Source fix and installed synthetic proof

A source fix is commit
`eecc2364206b5275d7897d483ddb579486d26d8c`.

The popup now has a dedicated receive presentation boundary that accepts only the
four documented outcomes: IMPORTED, CONFLICT, SOURCE_OFFLINE and PENDING.
Unexpected failures, including TRANSFER_REPLAY, still fail closed through the
existing error mapping.

Focused source regression `client-transfer-popup-receive.mjs`: 5/5 cases PASS.
L1 independent exact popup entrypoint test: 10/10 cases PASS through the real
`onclick -> action -> transport` path; the frozen 0.2.7 baseline fails the expected
idle/offline/double-click cases and commit `eecc2364206b5275d7897d483ddb579486d26d8c`
passes all of them.
I1 source/package regression: 164/164 gates PASS.
Package/reset identity tests after L1 follow-up: 7/7 PASS. Python compile and
diff-check PASS.

For installed proof A created a synthetic copy of the exact STORE 0.2.7 archive,
changing only `popup.js`. It is not a release candidate and not a store artifact.
Synthetic SHA-256:
`25fa30c3cc11bc9fcc59e0801816297203a29dc782f462e04fce880332664ff4`.
Archive comparison proves only `popup.js` differs from official STORE 0.2.7.
Two fresh normal technical installations of that patched synthetic archive passed
the complete lifecycle:
- refusal without consent created no request;
- recipient began as metadata-only, credential-empty/stale;
- UI create/discover/receive imported the credential only after Receive;
- same-request replay caused no reapply and no packet/ACK repeat;
- a second new request kept the current credential revision;
- source and recipient cleanup completed and server tombstone was observed;
- recipient local reset/re-auth rotated its device while source stayed authorized;
- providerRequests=0, aiPostRequests=0, pageErrors=0.

This is **INSTALLED_SYNTHETIC_PATCHED**, not STORE acceptance.

## Independent official 0.2.7 reset/re-auth result

The unchanged official STORE 0.2.7 bytes separately PASS the one-device reset/re-auth
boundary. Recipient signed out locally and reauthorized normally with device
rotation; source stayed authenticated/workAllowed.

Controller follow-up found that the first PASS used only the preserved runtime
version as its old-profile identity. That observation is retained but is not used as
the final exact-byte proof. Follow-up commit
`b409bcbb6969ae2ca3cb835fee3e3a9ea39016c0` binds the two sides independently:
- source/recipient: official STORE 0.2.7 SHA `1c11bf6008b923af050f44bdaa97ab6b5197fda744c4a10aef5209f3efc95dc7`, 44 files;
- preserved main: frozen STORE 0.2.6 SHA `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`, 42 files.

The corrected exact run PASS: the preserved r4 main profile remained
authenticated/workAllowed with exactly two stores, recipient rotated device after
normal reauth, source remained admitted, and provider requests, AI POSTs and page
errors were zero. Evidence:
`/root/octoport-control/logs/A/owner-test-opera-027-lifecycle-20260929-r2/reset-reauth-r3-exact-main.json`.

Negative preflight regressions prove that changed or missing preserved runtime bytes
fail even with an unchanged `0.2.6` manifest, and a wrong preserved carrier/SHA
fails before browser/auth operations. Helper auth assertions also retain a safe
explicit failure code instead of collapsing to UNEXPECTED_RESET_FAILURE.
## Next disposition

C must integrate A source commit `eecc2364206b5275d7897d483ddb579486d26d8c`
through normal intake and produce a **new versioned** Chromium STORE candidate.
Do not overwrite or relabel frozen STORE 0.2.7.

A will rerun the exact two-install transfer/no-replay/repeat/cleanup lifecycle on
the new C-provided SHA/version before installed STORE transfer can be accepted.

Still separate and not claimed here:
- human email-login UX;
- human store-reviewer / Windows store-channel installation;
- genuine useful ChatGPT response / H3;
- store upload, submission or production deployment.

No marketplace provider business request or AI POST was required for this proof.
