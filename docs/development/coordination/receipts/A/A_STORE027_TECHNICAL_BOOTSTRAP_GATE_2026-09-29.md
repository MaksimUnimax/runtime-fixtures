# A — STORE 0.2.7 technical bootstrap gate — 2026-09-29

Status: **EXACT CANDIDATE IDENTIFIED / OPERA LOAD PASS / NORMAL DEVICE FLOW REACHES BOOTSTRAP / BOOTSTRAP PROFILE INCOMPATIBLE / INSTALLED TRANSFER NOT ACCEPTED**

Task: `A_EXACT_TECHNICAL_LIFECYCLE_REMAINDER_20260929`.

## Exact candidate boundary

C materialized an early Chromium STORE 0.2.7 candidate from accepted source:

- source HEAD: `83035523e8062f9bb7c8392b93c861a8444fd2a2`;
- source tree: `675affebee45679dd9da434ae9cbfb07d4abccd2`;
- package:
  `/root/octoport-control/logs/C/store-release-prep-027-83035523/chromium/OCTOPORT_v0.2.7_CHROMIUM_STORE.zip`;
- SHA-256:
  `1c11bf6008b923af050f44bdaa97ab6b5197fda744c4a10aef5209f3efc95dc7`;
- manifest version: `0.2.7`;
- contract: `control_plane_v2`;
- environment: `PREPRODUCTION`;
- Opera: `136.0.6008.22`.

A independently verified 44 ZIP files and 44 runtime files with identical names and
per-file bytes. The C core preparation summary is PASS.

This is **candidate-specific technical evidence**, not final STORE publication
acceptance. C's `store-027-prep-20260929` worktree is still in package-preparation
state, so any later C byte change requires a new exact SHA and a fresh A installed
run. Frozen STORE 0.2.6 remains immutable.

## Browser environment

A first attempted browser run without an X server failed before extension startup.
The package preflight itself passed: exact SHA, Opera product and 44-file runtime.

A privacy-safe stage probe then ran through the normal supervised browser slot under
`xvfb-run` and passed:

- Opera launch;
- extension service worker creation;
- runtime manifest read as 0.2.7;
- popup load with visible body.

Resource unit:
`octoport-test-a-cbf1f7d7acee48ebb56b5c70626696e6.service`;
cleanup verified.

Therefore the non-Xvfb failures were an environment gate and are not a 0.2.7
product/package failure.


## Normal technical device flow

On a fresh protected 0.2.7 Opera profile A used the already-authorized technical
portal session only to approve the extension's **normal** device authorization flow.
No extension auth/work flag was injected.

The helper passed its synchronous protected-session, account-membership and approval
checks. The extension/browser remained alive under Xvfb while the client polled the
normal token/bootstrap path. A stopped only its own supervised job after the
long-running wait; the profile was then confirmed not in use.

A reopened the **same** profile without issuing another approval and ran a
five-second read-only status diagnostic. The privacy-safe result was:

- `authenticated=false`;
- `workAllowed=false`;
- `pending=false`;
- `authorityPresent=false`;
- `lastErrorCode=BOOTSTRAP_PROFILE_INCOMPATIBLE`;
- popup page errors: none.

Evidence:
`/root/octoport-control/logs/A/owner-test-opera-027-lifecycle-20260929/source-resume-diagnostic.json`.

Resource unit:
`octoport-test-a-dae4b8cb0bd44e1b96bb5d38f792f5dd.service`;
the exit code 3 is the helper's expected external-wait disposition, and cleanup was
verified.

The source installation therefore reached the signed-bootstrap validation boundary
but did not obtain usable account authority. A did **not** create/authenticate the
recipient installation and did **not** start transfer, replay or reset/re-auth
acceptance on 0.2.7.

Provider checks and AI send/work phases were **NOT RUN**. No marketplace credential
value, device/account ID, authorization code, portal cookie/token, signed raw payload,
private dialogue or provider response is recorded by this receipt.

## Root gate

The client correctly fails closed. Current source requires signed bootstrap
compatibility to resolve to an allowed extension and browser, and validates the
adapter profile against the actual runtime environment.

The server compatibility resolver returns an update/browser denial when the exact
extension release/contract/browser association is absent. At this boundary:

- accepted `main` contains the transfer repair;
- C package-prep contains version 0.2.7 packaging/check updates;
- no accepted main change publishes/activates an exact 0.2.7 compatibility release
  for `control_plane_v2` + Opera 136.

Therefore A must not weaken `BOOTSTRAP_PROFILE_INCOMPATIBLE` handling or fabricate
authority. The exact installed transfer proof is blocked until C establishes the
supported owner-test/preproduction compatibility/profile assignment through its
existing admin path and quality gates.


## C dependency

A sent the exact peer request:

`/root/octoport-control/peer-handoffs/C/A-C-STORE027-BOOTSTRAP-COMPAT-20260929-0349.request.json`.

Requested C result:

- confirm/activate the exact 0.2.7 compatibility release for
  `control_plane_v2` and Opera `136.0.6008.22`;
- confirm the signed ChatGPT/web/null profile/assignment resolves for the technical
  account;
- use only existing supported C/admin APIs and existing owner-test authority;
- no direct SQL;
- no A validator/auth-state changes;
- preserve beta CLOSED unless separately authorized otherwise;
- return exact config/catalog disposition and safe evidence;
- if C supersedes the candidate bytes, return the new exact package identity.

This follows the already-proven STORE 0.2.6 compatibility activation pattern.

## Next A action

No additional device approvals are attempted while this gate is unchanged.

After C reports compatible 0.2.7 bootstrap/profile authority, A will:

1. restore/retry the source technical installation;
2. create/authenticate one fresh recipient installation;
3. run the version-aware exact lifecycle harness under supervised Xvfb against the
   exact returned carrier/runtime/SHA/version;
4. verify metadata-only recipient credential import, replay/no-network-repeat,
   repeated new request with unchanged revision, cleanup, one-device reset/re-auth,
   isolation of the other installation and preserved owner-test profile;
5. keep provider and AI POST business phases at zero for this lifecycle-only proof.

Until that succeeds, STORE 0.2.7 transfer remains **NOT ACCEPTED**.
