# A — automated technical auth for exact STORE 0.2.6 — 2026-09-28

Status: **AUTH + LOCAL CONTROLS PASS / SERVER AI ASSIGNMENT RESOLUTION DEPENDENCY**

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

Initial helper guards before the controller transport review: **15/15 PASS**; Python compile and `git diff --check`: PASS.

Controller P2 `A-CONTROLLER-TECHNICAL-AUTH-20260928-1402` then reproduced an unsafe helper-only transport boundary in the WIP: arbitrary/plaintext origins and redirect forwarding were possible. The initial helper commit `aed03254e02d5a35fb8d99d6f644b628d0de1a7b` is therefore **superseded for intake**.

A accepted the independently reviewed hardening on the current lineage as `9dbc97b95863d88d977da1b7e27918fea065f549`. The helper now pins the exact `https://api.octoport.ru` origin, rejects redirects, allow-lists only the assigned account/device-approval endpoints, bounds response/session reads, validates cookie syntax, and reads the protected session through owner/0600/nofollow/protected-parent checks. Focused guards: **22/22 PASS**; Python compile and `git diff --check`: PASS. No real session, browser or network reuse was performed after the P2 finding.

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

## Post-catalog retry

After C reported the exact STORE0.2.6 catalog/profile/assignment activated, A retried with a new protected technical browser profile while preserving the original failed profile as evidence.

The normal technical flow passed:
- exact package SHA and Opera 136.0.6008.22 matched;
- protected portal authority and account membership were verified;
- a new device authorization was approved through the normal server path;
- no auth state was injected;
- public extension state reached `authenticated=true`;
- ordinary human email login and human portal login remain untested.

Evidence:
`/root/octoport-control/logs/A/owner-authenticated-026-technical-r2/technical-auth.json`.

A then requested the normal signed Bootstrap for detected ChatGPT through the authenticated extension.
The server response was HTTP 200 with config version 2 and both extension/browser compatibility `SUPPORTED`.
However the signed payload resolved detected ChatGPT as `ai.status=UNAVAILABLE` and contained no profile.
The frozen client therefore correctly returned `BOOTSTRAP_PROFILE_INCOMPATIBLE` and did not grant Work.

This is no longer a package/browser compatibility finding. It is an owner-test server resolution finding: the real technical account does not receive the published DIRECT profile assignment in Bootstrap.

Sanitized evidence:
`/root/octoport-control/logs/A/technical-bootstrap-worker-capture.log`.

The finding was returned directly to C in:
`/root/octoport-control/peer-handoffs/A/C-A-STORE026-CATALOG-READY-20260928-1544.response.json`.

## Authenticated local control matrix

A separate fresh technical profile was authorized normally and used only for reversible local controls, without first invoking the known failing detected-AI Bootstrap.

Result: `PASS_TEMP_STORE_MATRIX`.
Passed controls:
- Ozon and WB temporary add/save;
- edit/cancel and edit/save with secret-presence preservation;
- clear Performance / personal-data option;
- remove reject and remove confirm;
- privacy-safe support snapshot;
- ephemeral encrypted backup export/preview/import;
- cleanup.

Initial and final store count were both zero, the pre-existing-store fingerprint was restored, and marketplace provider-host request count was zero.
Evidence:
`/root/octoport-control/logs/A/owner-authenticated-026-controls-r3/local-matrix.json`.

Still open: real provider checks, AI Work, transfer, destructive auth reset, human email/login UX, H3 and store-reviewer acceptance.

## Post web/null catalog correction retry

C handoff: C-A-STORE026-WEB-NULL-CATALOG-READY-20260928-1755.

A used a fresh dedicated technical Opera profile and the already-authorized protected
technical portal session. No extension auth/work flag was injected and no STORE bytes,
trust bundle or backend state were changed by A.

Frozen carrier SHA-256:
579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5.

Observed browser: Opera 136.0.6008.22.

### Normal technical device flow

Evidence:
/root/octoport-control/logs/A/owner-authenticated-026-web-null-r4/technical-auth.json

Result:
- AUTOMATED_TECHNICAL_AUTH;
- protected portal authority verified;
- account membership verified;
- normal device approval submitted;
- authStateInjected=false;
- authenticatedObserved=true;
- manual email login and human portal-login UX remain untested.

Supervised resource job 4e3f848f6c344be78481368642208b0e:
exit 0, cleanup verified.

### Signed packaged ChatGPT bootstrap

A then invoked the frozen package control client through its own MV3 service worker
with the supported detected identity chatgpt/web/null. Only a privacy-safe projection
was persisted; access tokens, account/device/session IDs and raw signed payloads were
not written to evidence.

Evidence:
/root/octoport-control/logs/A/owner-authenticated-026-web-null-r4/bootstrap-capture.json

Observed result:
- client PASS, no bootstrap failure code;
- Bootstrap HTTP status 200;
- contract control_plane_v2;
- config version 2;
- extension compatibility SUPPORTED, minimum 0.2.6;
- browser compatibility SUPPORTED;
- AI status RESOLVED;
- detected identity chatgpt/web/null;
- profile present true;
- profile key chatgpt-web-opera-v1;
- profile revision 1;
- scope variant null;
- schema adapter_profile_v1;
- signed content SHA-256 24b03fc9b89c3ec849e96bbc10ce8138382e29807e0e7251aca41ec2de357985;
- public client state authenticated=true, workAllowed=true, pending=false, no last error.

This supersedes the earlier owner-account ai.status=UNAVAILABLE /
BOOTSTRAP_PROFILE_INCOMPATIBLE finding for this exact chatgpt/web/null technical path.

Supervised resource job effb967bb37a44b89325b6e461a3fac3:
exit 0, cleanup verified.

### Same-profile authenticated controls

The same r4 profile was reopened through the existing reversible local matrix.

Evidence:
/root/octoport-control/logs/A/owner-authenticated-026-web-null-r4/local-matrix.json

Result:
- PASS_TEMP_STORE_MATRIX;
- authenticated=true, workAllowed=true;
- Ozon/WB add/save, edit/cancel, edit/save, clear option, remove reject/confirm,
  support snapshot and encrypted backup preview/import all PASS;
- initial/final store count 0 / 0;
- pre-existing store fingerprint restored;
- marketplace provider-host request count 0;
- page errors 0.

Supervised resource job a054b80475c64b1284f0da144f5b47a2:
exit 0, cleanup verified.

### Exact installed provider-error presentation

A also closed the non-secret installed-synthetic part of the credential-check gap on
the same frozen STORE runtime. A temporary synthetic Ozon store was created through
the real popup, the real Проверить Seller button was pressed, and only the provider
transport was replaced with bounded synthetic outcomes.

Evidence:
/root/octoport-control/logs/A/owner-authenticated-026-web-null-r4/provider-negative-ui.json

PASS rows:
- HTTP 401 -> CREDENTIAL_REJECTED and safe 401 UI text;
- HTTP 403 -> ACCESS_DENIED and safe 403 UI text;
- network failure -> CHECK_FAILED and generic network/provider/format UI text.

The temporary store was removed through the product path; final store count is 0.
No live provider call and no owner credential was used in this synthetic negative
presentation proof.

Supervised resource job e029c1e9e19b4611a6931b00b8472708:
exit 0, cleanup verified.

### Remaining external gates

Real installed credential-check success is still OPEN. The protected owner inputs
remain present with the existing independent direct API receipt showing Ozon Seller,
Ozon Performance and Wildberries HTTP 200 with no business mutations:
/root/octoport-owner-intake/marketplace-json/api-check-receipt.json
That direct receipt does not substitute for clicking the exact installed UI buttons.

A attempted to use the protected marketplace files only by reference through browser
file-input automation. The execution environment rejected that protected-input action
before the browser operation ran. A did not bypass the restriction and did not read,
copy or expose the secret values. A supported protected import/pre-seeded-profile route
is therefore still required for an automated real installed UI success check.

Exact live AI Work/useful-flow remains separately OPEN because this technical
Octoport authentication does not establish a legitimate authenticated ChatGPT session.
Manual email-login UX, human portal login, H3/ChatGPT login, store-reviewer/catalog
installation, transfer and destructive auth reset also remain separate gates.

Current classification:
EXACT STORE AUTOMATED TECHNICAL AUTH + SIGNED CHATGPT PROFILE + AUTHENTICATED LOCAL
CONTROLS PASS; INSTALLED-SYNTHETIC PROVIDER ERROR PRESENTATION PASS; REAL PROVIDER UI
SUCCESS / LIVE AI WORK / HUMAN AUTH-REVIEWER GATES OPEN.

## Protected pre-seed real provider UI acceptance

C handoff:
C-A-STORE026-PROTECTED-PROVIDER-PRESEED-READY-20260928-1846.

C prepared the existing exact technical Opera profile only through the supported
SA_BACKUP_PREVIEW / SA_BACKUP_IMPORT product contract. The pre-seed receipt reported:
authenticated=true, workAllowed=true, storeCount=2, marketplaces Ozon + Wildberries,
conflicts=0, providerCalls=0 and secretExposure=false. No LevelDB editing or raw
credential transport through chat/tool arguments was used.

A then reopened the same exact STORE0.2.6 technical profile and exercised only the
real installed read-only credential-check buttons.

Evidence:
/root/octoport-control/logs/A/owner-authenticated-026-web-null-r4/provider-real-ui-check.json

Result:
- package SHA-256 remained
  579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5;
- Opera package manifest remained version 0.2.6, MV3;
- initial state: authenticated=true, workAllowed=true, storeCount=2;
- Ozon Seller: ACCESS_CONFIRMED, HTTP 200;
- Ozon Performance: ACCESS_CONFIRMED, HTTP 200;
- Wildberries token: ACCESS_CONFIRMED, HTTP 200;
- safe UI success text was observed for all three checks;
- observed provider responses were exactly one each from
  api-seller.ozon.ru, api-performance.ozon.ru and common-api.wildberries.ru;
- all three observed provider responses were HTTP 200;
- final state remained authenticated=true, workAllowed=true, storeCount=2,
  marketplaces Ozon + Wildberries;
- businessMutationExecuted=false;
- rawResponsesSaved=false;
- credentialValuesSaved=false.

Supervised resource job:
6c7763f252614693bc756b73955b8115;
exit 0, peak 611 MiB, cleanup verified.

This closes the previously open real installed Seller / Performance / WB
credential-check success row for the automated technical exact-STORE acceptance.

This does not prove or authorize live AI Work. A legitimate authenticated ChatGPT/H3
boundary is still required before a real Start -> provider result -> dialogue delivery
-> no-replay -> visibility -> explicit Finish useful flow can be claimed.

Remaining separate external boundaries:
- legitimate ChatGPT/H3 live Work/useful-flow acceptance;
- genuine persistent Opera/store-channel installation or reviewer/catalog acceptance;
- manual email-login/human portal UX;
- transfer requiring the separately qualified second installation;
- destructive auth-reset/re-auth acceptance.

Current classification:
EXACT STORE AUTOMATED TECHNICAL AUTH + SIGNED CHATGPT PROFILE + AUTHENTICATED LOCAL
CONTROLS + REAL INSTALLED READ-ONLY PROVIDER CHECK BUTTONS PASS. LIVE AI WORK/H3 AND
HUMAN/STORE-CHANNEL BOUNDARIES REMAIN OPEN.

## C static-acceptance rework closure

C handoff:
C-A-A06-CANDIDATE-STATIC-REWORK-20260928-2147.

C rejected the prior candidate only on canonical static acceptance in the A-owned
tests/regression/extension-core/client-i1/api-harness.ts:
- Prettier style drift;
- ESLint no-unused-vars for the catch binding at line 95.

A made the minimal non-semantic repair:
- replaced the unused catch binding with a bindingless catch;
- applied canonical Prettier formatting to the existing fixture-profile expression.

Validation used explicitly pinned Node v24.20.0 and pnpm 10.34.5:
- Prettier --check: PASS;
- ESLint on api-harness.ts: PASS;
- py_compile on firefox-functional-harness.py, firefox-functional-run.py,
  firefox_profile_lifecycle.py and profile-repair-behavior-matrix.py: PASS;
- git diff --check: PASS.

Focused changed-boundary acceptance:
firefox-functional-run.py --profile-lifecycle-only with PRODUCT_CONTROL_PLANE_E2E=1
and the disposable A test database.

Result:
- PASS;
- acceptance class INSTALLED_SYNTHETIC_FIREFOX_SIGNED_PROFILE_LIFECYCLE;
- Firefox 155.0.1;
- baseline rev1, changed rev2, active-Work deferred rev3, rollback rev1;
- stale fence rejected;
- navigation no resurrection;
- worker restart restored only current profile;
- revocation no resurrection;
- provider request count 0;
- liveProviderCalls 0.

Resource job:
9a3131031f544f3597e44a89823bf443;
exit 0, peak 2031 MiB, cleanup verified.

Two earlier focused attempts stopped before test execution on explicit environment
prerequisites (PRODUCT_CONTROL_PLANE_E2E opt-in, then disposable DB requirement);
both resource jobs cleaned up successfully. They are environment preflight evidence,
not product failures.
