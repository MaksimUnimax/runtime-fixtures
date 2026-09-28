# A — exact STORE 0.2.6 authenticated matrix preparation — 2026-09-28

Status: **EXECUTABLE POST-LOGIN HELPER READY / AUTH ACTION NOT PERFORMED**

Task: `A_OWNER_AUTHENTICATED_MATRIX_PREPARATION`.
Controller notice: `OWNER-MATRIX-FOLLOWUP-20260928-0520`.

Exact Chromium/Opera carrier:
- `OCTOPORT_v0.2.6_CHROMIUM_STORE.zip`;
- SHA-256 `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`;
- Opera product boundary: `136.0.6008.22`.

The previous signed-out result remains valid for what it actually proves, but its
`auth-start` row is corrected: visible/enabled does **not** mean authentication action
PASS. The control is now classified
`VISIBLE_ENABLED_ONLY / ACTION_NOT_VERIFIED`.

## Executable helper

Path:
`tests/regression/extension-core/client-i1/exact-store-authenticated-controls.py`.

The helper never creates, injects or fabricates authentication.
It is designed for one dedicated persistent Opera profile after C has prepared the exact
0.2.6-compatible owner-test backend/portal path.

Because the Chromium STORE manifest contains no `key`, unpacked extension identity
depends on the extraction path. Therefore ordinary login and every continuation run must
use the same stable extracted runtime path and the same dedicated persistent profile path.

## Deterministic operator sequence

The helper exposes four modes.

1. `describe`
   - prints the finite control plan only;
   - no browser, auth, network or state mutation.

2. `prepare`
   - verifies exact ZIP SHA;
   - verifies actual Opera product version;
   - rejects unsafe ZIP members/symlinks;
   - creates or byte-verifies the stable runtime directory;
   - refuses a profile already owned by another browser process;
   - creates the dedicated profile directory if absent;
   - no browser/auth/provider action.

3. `wait-auth`
   - launches exact extracted STORE bytes in the dedicated profile;
   - opens the extension popup;
   - does **not** click `auth-start`, `auth-open` or `auth-cancel`;
   - waits until `SellerAgentsControlClient.status().authenticated === true`;
   - owner completes ordinary portal login/OTP manually in the same visible browser;
   - credentials/OTP are never passed to the helper;
   - on timeout returns `WAITING_OWNER_LOGIN`, not PASS;
   - after ordinary auth returns only privacy-safe readiness state.

4. `local-matrix`
   - requires an already authenticated **owner-test** profile;
   - separately requires explicit `--allow-local-test-stores`;
   - exercises only the temporary-store popup boundary;
   - normal product metadata/tombstone sync may occur on the owner-test control plane;
   - never runs provider checks, live Work, transfer or auth reset.

This separation prevents an owner login from automatically triggering mutation.

## Privacy and existing-store protection

Authenticated evidence output deliberately excludes:
- credential/password/file input values;
- OTPs;
- account IDs;
- store IDs and store names;
- private dialogue text;
- full request URLs, query strings, headers and bodies.

Control-state output records only visible/hidden/disabled state, input type and safe
button labels. `select#stores` option text is not serialized.

The helper may use store IDs internally only inside browser memory to compute a
SHA-256 before/after store fingerprint. Raw IDs are never returned to Python or evidence.

Before any temporary-store action it records:
- existing public store count;
- marketplace counts;
- aggregate credential-presence booleans/counts;
- a one-way fingerprint of safe public store metadata.

The owner-test temporary-store matrix creates synthetic Ozon and WB stores with explicitly
invalid synthetic credentials only. Normal product metadata/tombstone sync may occur on
the prepared owner-test control plane; this phase must not be run against an unapproved
production/account environment. It tests:
- marketplace switch;
- add/save;
- edit/cancel;
- blank-secret edit preserving credential presence without reading the secret;
- `clear-performance`;
- `personal`;
- remove → reject;
- remove → confirm;
- privacy-safe support snapshot.

Cleanup removes only stores carrying the helper's synthetic run label. The final visible
store count and pre-existing-store fingerprint must exactly equal the initial values or
the run fails.

The backup UI is exercised only when the profile had **zero** stores before the run.
Otherwise it is `SKIPPED_PROTECT_EXISTING_STORES`, because the UI exports all stores.
When allowed, the backup file is created in an ephemeral directory, checked for absence
of plaintext synthetic secrets, previewed/imported, and deleted before exit.

The temporary-store matrix rejects any request to an Ozon/WB provider host. Control-plane
traffic may exist after ordinary authentication and metadata/tombstone handling, but
evidence records hostname counts only. Final visible store count/fingerprint restoration
protects pre-existing stores; it does not claim byte-identical owner-test server metadata.

## Explicitly gated controls

The prepared helper does not silently upgrade these rows:

- `check-seller`, `check-performance`, `check-token`:
  `NOT_RUN_REQUIRES_REAL_READ_ONLY_PROVIDER_BOUNDARY`.
- `start`, `work-resume`, `visibility`, `finish`, quota `resume`:
  `NOT_RUN_REQUIRES_SUPPORTED_LIVE_AI_AND_OWNER_TEST_BOUNDARY`.
- transfer consent/create/discover/receive:
  `NOT_RUN_REQUIRES_SECOND_ORDINARILY_AUTHENTICATED_INSTALLATION`.
- `auth-reset`:
  `NOT_RUN_DESTRUCTIVE_REAUTH_BOUNDARY`.
- new `auth-open` / `auth-cancel` lifecycle:
  `NOT_RUN_REQUIRES_NEW_PENDING_AUTH_LIFECYCLE`.

Those actions remain separate future phases after C/owner prerequisites exist.
The helper must not turn synthetic temporary credentials into provider requests.

Firefox technical grant/revoke remains the separate browser-chrome doorhanger gap from
the R1 receipt. This preparation does not retry that failing Marionette method and does
not make it a prerequisite for Opera-first owner handoff.

## Dry/static verification performed now

Python syntax: PASS.

`describe`: PASS.

Exact `prepare` against frozen STORE 0.2.6:
- package SHA matched;
- Opera product `136.0.6008.22` matched;
- runtime inventory: 42 files;
- second prepare verified the same stable runtime byte-for-byte;
- profile not in use;
- `manifestKeyPresent=false`;
- `stablePathRequired=true`.

Final helper SHA-256:
`5a19ae094ec2ee530c97eb061ca1427598114a716650680aeac416e110bb35e4`.

Plan output SHA-256:
`793ccb75fb85f65e65fd8e471939f5a879d4b975afdb664f13cfd178fe0b72d5`.

Idempotent prepare result SHA-256:
`0561ca7ed278b479c4403bfd51b0f2726d7895c3571c4b03cb4888cc5afa6e0b`.

## Browser dry-run evidence

First headed dry-run without an X server failed before browser startup with the explicit
Playwright `Missing X server / $DISPLAY` environment error. Resource job
`a7516a0018d34806b034cfa4106d78e6` exited 1, OOM 0, cleanup verified.
This is environment evidence only and is superseded by the Xvfb run below.

The final exact helper was then exercised under `xvfb-run` in one supervised job
against two fresh signed-out profiles:

1. `wait-auth --auth-timeout-seconds 1`;
2. `local-matrix --allow-local-test-stores`.

Both returned the expected:
- status `WAITING_OWNER_LOGIN`;
- evidence `PREPARED_NOT_AUTHENTICATED`;
- package SHA exact;
- Opera product exact;
- `authActionExecutedByHelper=false`;
- page errors 0.

Each helper process returned code 3 to distinguish external owner-login wait from
PASS/failure; the supervised wrapper asserted both expected codes and exited 0.
No temporary-store mutation began in the `local-matrix` negative run.

Canonical resource job:
`6140af57b7154de4b9d50c49c3de74ad`;
supervisor exit 0, OOM 0, cleanup verified, peak 446693376 bytes.

Both final negative result JSON files have SHA-256:
`862d29ddb51391fe416f66a67b6454671fdae90f74398a17d88363633f5e601b`.

## Ready-to-run sequence after C prerequisite

After C has prepared the exact 0.2.6 owner-test backend/portal path:

1. C/A chooses one stable runtime directory and one dedicated Opera profile directory.
2. Run `prepare` once and preserve those paths.
3. Under the secure graphical session run `wait-auth`.
4. Owner clicks the extension's ordinary portal login controls and completes OTP only in
   the browser. No password/OTP/cookie/storage-state is sent to A/C chat or evidence.
5. Helper observes authenticated signed state and exits `READY_AFTER_ORDINARY_AUTH`.
6. Close that helper/browser cleanly.
7. Reopen the **same** profile/runtime with `local-matrix --allow-local-test-stores`.
8. If the owner-test temporary-store matrix PASSes and existing-store fingerprint is restored, continue the
   separately gated real provider-check and Work/useful-flow phases.
9. Transfer requires a second ordinarily authenticated installation; auth reset is a
   separate destructive re-auth phase and is not folded into the temporary-store matrix.

No authenticated PASS, provider PASS, Work PASS, transfer PASS, owner action, deployment,
DB mutation, store submission or catalog mutation is claimed by this receipt.
