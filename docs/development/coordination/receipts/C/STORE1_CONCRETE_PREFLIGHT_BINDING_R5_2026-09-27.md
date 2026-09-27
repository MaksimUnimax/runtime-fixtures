# STORE-1 concrete preflight binding R5 — 2026-09-27

Status: **PREPARED SOURCE/OPERATOR BINDING / NO LIVE RUN / NO CATALOG MUTATION / NO DEPLOYMENT AUTHORIZATION**

This receipt replaces the remaining source-level unknowns recorded by `PREPROD_PREFLIGHT_R4_2026-09-26.md` where later accepted work now provides evidence. It does not convert unknown live reviewer/backend state into PASS.

## Frozen STORE package authority

The STORE candidate remains the frozen Opera/Chromium package:
- source HEAD: `e7d66152bdb77918b65115486c9829ef7a634e69`;
- source tree: `01ae2c1d84a354a11d919a313f8d9909d1285b6a`;
- extension version: `0.2.4`;
- control-plane contract: `control_plane_v2`;
- ZIP SHA-256: `0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c`;
- manifest: `/root/octoport-control/logs/C/store-release-e7d66152/candidate/B1_RC_MANIFEST.json`;
- package: `/root/octoport-control/logs/C/store-release-e7d66152/candidate/OCTOPORT_v0.2.4_CHROMIUM_STORE.zip`.

STORE 0.2.4 remains on signed `control_plane_v2`. The later passive v3 client/server foundation does not change the frozen package bytes and is not a STORE-0.2.4 prerequisite.

## Closed preparation boundaries

The following source/disposable boundaries are now prepared:

1. B09 cryptographic preflight uses the verifier and trust bundle shipped inside the exact STORE ZIP, verifies a fresh no-AI v2 bootstrap, binds package/config/key/account/device/browser/origin/freshness, rejects forged/deserialized proof and config drift, and gives planner authority only through a process-local trusted capability.
2. B10 provides a runnable **read-only catalog** operator entry. It performs ordinary authenticated admin GET readback, executes only the existing reviewer no-AI bootstrap POST, verifies the returned signed envelope with the exact packaged verifier, continues planner GETs, re-reads config before returning a mutation/READY preview, and always reports `catalogMutationExecuted:false`.
3. C05 r7 proves the exact three-service disposable sequence candidate `61bb49f3553fd217a9a2c8d8ff8d9f92419f0184` → rollback floor `d24838669c54f21dc161dc48a7e71e0e288384c2` → candidate on one restored forward-schema database, with API/worker/portal readiness, authenticated portal proxy, N2, signed v2 bootstrap and metadata-forget preservation. This is not live rollback acceptance.
4. The planner/disposable STORE whole-sequence proves catalog mutation ordering and convergence under synthetic prerequisites. It does not prove the intended live reviewer or current live catalog state.

## Protected operator input

B10 accepts one mode-0600 JSON file containing paths and non-secret reviewer context only. Do not place token values in this JSON:

```json
{
  "manifestPath": "/root/octoport-control/logs/C/store-release-e7d66152/candidate/B1_RC_MANIFEST.json",
  "packagePath": "/root/octoport-control/logs/C/store-release-e7d66152/candidate/OCTOPORT_v0.2.4_CHROMIUM_STORE.zip",
  "reviewerEmail": "<PRIVATE_DEDICATED_REVIEWER_EMAIL>",
  "deviceId": "<PRIVATE_DEDICATED_REVIEWER_DEVICE_UUID>",
  "browserVersion": "<ACTUAL_OPERA_CHROMIUM_VERSION_AT_LEAST_136>",
  "adminSessionFile": "<MODE_0600_ADMIN_SESSION_TOKEN_FILE>",
  "reviewerDeviceBearerFile": "<MODE_0600_REVIEWER_EXTENSION_BEARER_FILE>"
}
```

The JSON file itself and both credential files must be regular files with no group/other permission bits; `0600` is recommended. Symlinks, group/other permissions, empty files, malformed credentials and unexpected keys fail closed.

The admin session and reviewer bearer are separate authorities:
- admin session: existing admin GET routes only;
- reviewer bearer: existing `POST /v1/bootstrap` only.

B10 consumes no OTP, password, signing private key or marketplace credential.

## Exact read-only command

Run only after the intended backend is the separately authorized target and the protected inputs were produced through ordinary authentication:

```text
pnpm exec tsx tooling/server/store1-preflight-cli.ts --input-file <MODE_0600_PROTECTED_JSON>
```

The command may issue the ordinary no-AI bootstrap POST, which can update ordinary device/auth metadata. It executes **zero catalog POSTs**.

A safe successful result is either:
- a fail-closed BLOCKED/CONFLICT result identifying an unmet prerequisite; or
- an explicitly unexecuted POST/READY preview with `catalogMutationExecuted:false`.

Never serialize/reuse a trusted proof between processes. A changed current v2 config invalidates the proof.

## Read-only prerequisite sequence

Before any catalog mutation, the B10 entry must prove on the exact intended backend:

1. global beta is `CLOSED`;
2. the dedicated reviewer resolves to exactly one intended ACTIVE user with verified queried email;
3. complete pagination finds exactly one ACTIVE account owned by that reviewer;
4. that exact account is already admitted while beta remains CLOSED;
5. current `control_plane_v2` config metadata is present and structurally valid, uses the v2 snapshot/envelope and an ACTIVE signing key;
6. the exact STORE package verifier accepts a fresh signed no-AI v2 bootstrap in the authenticated reviewer account/device/Opera context;
7. all planner catalog/profile/assignment GET pagination is complete;
8. an immediate final v2-config re-read shows no config drift.

Any failure stops before catalog POST. Do not open beta, create a reviewer through SQL/admin bypass, reuse a privileged owner identity as a substitute, publish a seed config, rotate a signing key, or infer readiness from migration counts.

## Catalog mutation boundary

B10 does not execute catalog mutations. After a read-only preflight returns an unexecuted next action, any actual release/policy/config/registry/profile/assignment POST is a separate live operation.

When separately authorized, mutation execution must remain sequential:
1. execute exactly one planned POST through the ordinary authenticated admin API;
2. read back the affected state;
3. rerun read-only planning/preflight as required;
4. preserve CAS/expected-version constraints;
5. stop on BLOCKED, CONFLICT, stale signature proof, changed config or incomplete pagination.

No direct SQL is permitted for catalog activation.

## Deployment and rollback boundary

C05 r7 closes the **disposable** API+worker+portal application rollback rehearsal for the exercised forward schema and exact candidate/floor identities. It does not authorize or prove a live owner-test/preprod deployment.

Before B10 can be treated as a readback of the intended current backend, that backend must actually run an accepted runtime containing the B09/B10 routes/operator assumptions. If it does not, switching the intended backend is a separate bounded live deployment action requiring explicit owner authorization under the current runbook rules.

No down migration is part of application rollback. The tested application floor remains `d24838669c54f21dc161dc48a7e71e0e288384c2` on the compatible forward schema; restoring an older database snapshot after writes reopen remains a separate recovery/data-loss decision.

## Earliest genuine owner-controlled actions

Do **not** request credentials or OTP in chat.

The first owner-controlled live action depends on the current intended-backend state:

- If the intended reviewer backend does **not** yet run the accepted STORE-preflight-capable runtime, the first owner action is explicit authorization for the bounded owner-test/preprod deployment. Source/disposable preparation alone cannot perform that live switch.
- Once the intended backend is reachable on the accepted runtime, the next genuine human factor is the dedicated reviewer's ordinary login/OTP flow needed to create the protected admin/reviewer authentication inputs through supported product paths. Return only safe status (message arrived, approximate delay, accepted/not accepted, safe visible error/request ID). Never return OTP, token, cookie or credential content.

The existing early STORE Submit authorization does not authorize deployment, catalog mutation, beta changes, commercial activation or sharing owner credentials.

## What C can still prepare without owner action

Before requesting either live action C may:
- keep exact package/hash/manifest and command identities frozen;
- maintain the mode-0600 protected-input template and sanitized operator checklist;
- bind C05 rollback evidence to the exact accepted backend candidate;
- verify branch/main CI and current source ancestry;
- integrate submitted A/B source candidates normally;
- consume B10 source tests and disposable evidence;
- prepare truthful store listing/reviewer instructions that do not claim live acceptance.

C must not fabricate reviewer/account/admission state or a live signed-bootstrap result.

## Remaining independent stream work

- B: B10 source work is complete at its submitted exact candidate; future changes remain B-owned only if a concrete source defect is found. No parallel C rewrite of the HTTP adapter.
- A: passive v3 verifier/cache authority remains separate from STORE 0.2.4 and does not gate the frozen v2 package. Ordinary reviewer E2E remains a later live acceptance.
- C: accept the current integration batch through exact branch/post-main CI, preserve the package/preflight/rollback binding, and request owner action only when the intended backend/live prerequisite is the actual next unresolved step.

## Acceptance boundary

This receipt is source/package/disposable preparation only. It does not claim:
- live reviewer identity/admission;
- live admin/reviewer authentication;
- live v2 signed-bootstrap success;
- live catalog state or activation;
- owner-test/preprod deployment;
- store dashboard submission/review;
- production deployment or commercial enablement.
