# A — automated technical auth for exact STORE 0.2.6 — 2026-09-28

Status: **PARTIAL PASS / SERVER CATALOG DEPENDENCY**

Task: `A_AUTO_REAL_TEST_SESSION_026` (A06).
Resume authority: `OWNER_TRANSFER_AUTONOMY_20260928T1224Z_A`.
Auth authority: `OWNER-AUTONOMOUS-OCTOPORT-TEST-AUTH-20260928-1244`.

## Frozen boundary

- Package: `OCTOPORT_v0.2.6_CHROMIUM_STORE.zip`.
- Package SHA-256: `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`.
- Package source: `028d5dd56341719e2061a47b5e82e216256619f7`.
- Opera: `136.0.6008.22`.
- Browser surface: supervised Xvfb on Easyscript, separate persistent technical profile mode `0700`.
- Runtime inventory: 42 pinned files, stable extracted path mode `0700`.

No STORE bytes, signatures, `authenticated`, `workAllowed`, portal roles, or backend checks were bypassed or overwritten.

## Helper change

`exact-store-authenticated-controls.py` now has explicit `technical-auth` mode. It accepts only the protected owner-authorized non-admin portal-session receipt with safe permissions and unexpired authority, verifies active account membership via the normal API, starts the extension's own device flow, submits the normal portal approve request with CSRF, then waits for the extension's own token exchange and signed bootstrap.

The protected session's cookie/token values and raw account identifier are never serialized to Git, evidence, stdout, screenshots, or extension storage. Guard tests additionally reject unsafe session-file permissions and admin sessions.

Focused source guards after the change: **15/15 PASS**; Python compile and `git diff --check`: PASS.

## Real run

Exact prepare: PASS. The frozen ZIP hash, Opera product and 42-file runtime matched.

First supervised technical-auth job: `24208536fa494149956b033259512b0d`; peak 684,720,128 bytes, OOM 0. The normal server device approval returned successfully. The extension did not reach public `authenticated=true` within the bounded 90-second window, so the run correctly returned `TECHNICAL_AUTH_TIMEOUT` rather than PASS.

A second read-only reopen of the **same** persistent profile did not create or approve a new authorization. It restored the saved client state and exposed only privacy-safe status:

- `authenticated=false`;
- `workAllowed=false`;
- `pending=false`;
- `authorityPresent=false`;
- `lastErrorCode=BOOTSTRAP_PROFILE_INCOMPATIBLE`.

Diagnostic job: `9c1cfabd320444e888fe82e98896812f`; peak 523 MiB; cleanup verified.

Because `BOOTSTRAP_PROFILE_INCOMPATIBLE` is emitted only after device token exchange reaches signed bootstrap validation, this establishes the real flow through portal session/account membership/device approval/token exchange while proving that the signed bootstrap was rejected fail-closed before authority could be accepted.

## Current disposition

Authenticated popup/control acceptance is **OPEN**. A will not weaken `validateBootstrapAuthority`, signatures, compatibility, or STORE trust to make it pass.

This exact dependency was handed directly to C in:
`/root/octoport-control/peer-handoffs/C/A-C-TECH-AUTH-BOOTSTRAP-INCOMPATIBLE-20260928-1410.request.json`.

C owns the existing STORE0.2.6 catalog/profile compatibility preflight and any already-authorized server/catalog correction. After C returns a compatible signed catalog disposition, A reuses this same bounded technical path and verifies the authenticated controls.

Evidence:
- `/root/octoport-control/logs/A/owner-authenticated-026-technical/prepare.json`;
- `/root/octoport-control/logs/A/owner-authenticated-026-technical/technical-auth.json`;
- `/root/octoport-control/logs/A/owner-authenticated-026-technical/post-timeout-inspect.json`.

Still explicitly untested here: ordinary human email delivery/login UX, human portal login, ChatGPT login/2FA, read-only Ozon/WB provider checks, live AI Work, transfer, destructive auth reset and store submission/reviewer acceptance.

The human email-login item remains separately deferred; it is not treated as the cause of this technical bootstrap incompatibility.

## Security hardening follow-up

Controller notice `A-CONTROLLER-TECHNICAL-AUTH-20260928-1402` found that the first WIP technical transport accepted arbitrary/plaintext origins, followed default urllib redirects, and followed a symlink receipt. Candidate `aed03254` was immediately marked **SUPERSEDED / DO NOT INTEGRATE** to C before any further real-session use.

The superseding implementation now:

- accepts only exact `https://api.octoport.ru` with no credentials, path, query, fragment, alternate port or HTTP downgrade;
- uses an explicit no-redirect opener, so 3xx cannot carry Cookie/CSRF to another origin;
- bounds API response and receipt reads to 64 KiB;
- opens the protected receipt with `O_NOFOLLOW`, validates regular-file/current-owner/exact `0600`, and requires its immediate parent to be current-owner and inaccessible to group/other;
- validates JSON object/type/expiry/account/cookie shape before use;
- keeps all transport failures mapped to fixed privacy-safe codes.

Synthetic no-network regression now covers wrong origin, plaintext origin, path/query/userinfo variants, cross-origin redirect refusal, symlink receipt, unsafe parent, malformed JSON and the exact-origin injected transport path.

Focused guards after hardening: **19/19 PASS**; Python compile and `git diff --check`: PASS. No real portal session or real network was reused after the controller notice while this hardening was uncommitted.
