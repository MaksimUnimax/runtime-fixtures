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
3. The latest C05 three-service disposable proof is `a7bf253839372a18f14a619e64093fa0e8c70b0e` → rollback floor `d24838669c54f21dc161dc48a7e71e0e288384c2` → `a7bf253839372a18f14a619e64093fa0e8c70b0e` on one restored forward-schema database. Evidence: `/root/octoport-control/logs/C/c05-three-service-rollback-a7bf2538-r2/c05-three-service-rollback-evidence.json`, SHA-256 `2424ddb0a08e020749f6528a89a254ef225ccfad12e1614e09cc0b25a797d58a`. All three phases passed API live/ready, worker readiness, portal login/authenticated proxy, PRESENT/WITHHELD N2 and both identified/privacy-neutral signed-v2 bootstrap checks; the dedicated synthetic metadata-forget returned 200 on the first candidate phase and remained withheld across floor/return. Cleanup dropped the disposable DB and removed transient private/work state. This is not live rollback acceptance.
4. B11 exact `2fa293d3971a7123a84d718e43aa7dd235f2c8f7` composes B10 through actual disposable DB-backed admin routes, real `ExtensionAuthService` bearer authentication and the real signed-v2 `BootstrapService` producer. The valid CLOSED-beta/admitted-reviewer path returns the exact unexecuted first catalog POST preview while the only executed POST remains `/v1/bootstrap`; wrong bearer, revoked device and removed admission fail closed. C repeated the merged-tree STORE1 disposable PostgreSQL suite: **5/5 PASS**. B11 is source/disposable evidence only and does not prove the intended live reviewer or current live catalog state.

## Current accepted backend source binding

The accepted backend/source boundary for this R5 preparation is `22473b416949892d66e5d8e204805ea84347c329`.

The rollback rehearsal does not need to be repeated merely to rename that SHA. Independent controller review and a parent git comparison found **zero runtime-path delta** from the proven `a7bf253839372a18f14a619e64093fa0e8c70b0e` candidate to accepted `22473b416949892d66e5d8e204805ea84347c329` across:
- `apps/api`;
- `apps/worker`;
- `apps/portal`;
- `packages/server`;
- `packages/contracts/src`;
- `packages/shared`;
- `package.json`;
- `pnpm-lock.yaml`.

Therefore the exact a7bf-r2 disposable three-service rollback proof is the current runtime-equivalent rollback evidence for accepted backend source `22473b416949892d66e5d8e204805ea84347c329`. This equivalence is source/dependency evidence only; it does not turn the rehearsal into a live deployment/rollback proof.

## Protected operator input

B10 accepts one private regular JSON file containing paths and non-secret reviewer context only; no group/other permission bits are allowed and `0600` is recommended. Do not place token values in this JSON:

```json
{
  "manifestPath": "/root/octoport-control/logs/C/store-release-e7d66152/candidate/B1_RC_MANIFEST.json",
  "packagePath": "/root/octoport-control/logs/C/store-release-e7d66152/candidate/OCTOPORT_v0.2.4_CHROMIUM_STORE.zip",
  "reviewerEmail": "<PRIVATE_DEDICATED_REVIEWER_EMAIL>",
  "deviceId": "<PRIVATE_DEDICATED_REVIEWER_DEVICE_UUID>",
  "browserVersion": "<ACTUAL_OPERA_CHROMIUM_VERSION_AT_LEAST_136>",
  "adminSessionFile": "<PRIVATE_ADMIN_SESSION_TOKEN_FILE>",
  "reviewerDeviceBearerFile": "<PRIVATE_REVIEWER_EXTENSION_BEARER_FILE>"
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
pnpm exec tsx tooling/server/store1-preflight-cli.ts --input-file <PRIVATE_PROTECTED_JSON>
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

The a7bf-r2 C05 evidence closes the **disposable** API+worker+portal application rollback rehearsal for the exercised forward schema and exact a7bf/floor identities. Because accepted backend `22473b416949892d66e5d8e204805ea84347c329` has zero runtime/dependency delta across the compared service/contract paths, that proof is the current runtime-equivalent rollback evidence for this R5 source boundary. It does not authorize or prove a live owner-test/preprod deployment.

The intended deployment/reviewer backend is the existing owner-test/preprod boundary documented by the accepted runbooks: public `https://api.octoport.ru` and `https://app.octoport.ru`, backed by `seller-agents-owner-test-api.service`, `seller-agents-owner-test-worker.service`, and `seller-agents-owner-test-portal.service`. The target identity comes from non-secret historical deployment metadata; its current service/source identity is evaluated separately below using read-only local systemd/Git metadata only.

Read-only systemd/source metadata was then checked without inspecting environment values, credentials, DB state or HTTP endpoints. All three owner-test/preprod services are active from `/root/runtime-fixtures-preprod-r1`; that checkout reports Git HEAD `d31a59a95cf9fa908b3410db200cf9dbadaa3209` and currently has local modifications in `packages/server/email/src/index.ts` and `packages/server/remote-config/src/index.ts`. The service processes were started from that checkout, so this observation does not assert the exact in-memory contents of later dirty-file edits.

The committed d31 baseline is not B10-capable: it lacks `/v1/admin/compatibility/config-releases/latest`, the compatibility-release admin routes used by STORE planning, `tooling/server/store1-preflight-cli.ts`, and `tooling/server/store1-v2-signature-preflight.ts`. Its API/worker/portal/server/contracts/shared dependency delta to accepted `22473b416949892d66e5d8e204805ea84347c329` is substantial. Therefore the current owner-test/preprod deployment cannot be used as the intended B10 read-only reviewer backend without a separately authorized bounded deployment to an accepted STORE-preflight-capable runtime.

No down migration is part of application rollback. The tested application floor remains `d24838669c54f21dc161dc48a7e71e0e288384c2` on the compatible forward schema; restoring an older database snapshot after writes reopen remains a separate recovery/data-loss decision.

## Earliest genuine owner-controlled actions

Do **not** request credentials or OTP in chat.

The current read-only source metadata resolves the ordering:

1. **First genuine owner action: authorize the bounded owner-test/preprod deployment.** The observed owner-test service checkout is d31-based and is not B10-capable, so source/disposable preparation alone cannot make it the intended reviewer backend. This authorization must cover only the already documented owner-test API/worker/portal switch and its backup/forward-schema/readiness/rollback controls; it is not catalog-mutation or production authorization.
2. **After that deployment is verified:** the next genuine human factor is the dedicated reviewer's ordinary login/OTP flow needed to create the protected admin/reviewer authentication inputs through supported product paths. Return only safe status (message arrived, approximate delay, accepted/not accepted, safe visible error/request ID). Never return OTP, token, cookie or credential content.

The existing early STORE Submit authorization does not authorize deployment, catalog mutation, beta changes, commercial activation or sharing owner credentials.

## What C can still prepare without owner action

Before requesting either live action C may:
- keep exact package/hash/manifest and command identities frozen;
- maintain the mode-0600 protected-input template and sanitized operator checklist;
- bind the a7bf-r2 C05 rollback evidence and its exact SHA-256 to the runtime-equivalent accepted backend source `22473b416949892d66e5d8e204805ea84347c329`;
- preserve the read-only owner-test deployment finding (`/root/runtime-fixtures-preprod-r1`, d31 baseline, B10-required route/tooling gaps) without reading secret environment values;
- verify branch/main CI and current source ancestry;
- integrate submitted A/B source candidates normally;
- consume B10/B11 source tests and disposable evidence;
- prepare truthful store listing/reviewer instructions that do not claim live acceptance.

C must not fabricate reviewer/account/admission state or a live signed-bootstrap result.

## Remaining independent stream work

- B: B10 source work is accepted in main. B11 exact `2fa293d3...` is integrated in the current C candidate and closes the disposable real-API-handler composition gap without production-code changes. No independent B-owned STORE source/DB task remains unless integration review finds a concrete defect or a later controller assignment opens one.
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
