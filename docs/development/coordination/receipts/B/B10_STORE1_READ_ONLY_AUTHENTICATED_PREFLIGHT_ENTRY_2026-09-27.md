# B10 STORE-1 read-only authenticated preflight entry — 2026-09-27

Status: **SOURCE VALIDATED CANDIDATE / READ-ONLY CATALOG / NO LIVE RUN / NO CATALOG MUTATION**

Controller assignment: `STREAMS-AUDIT-20260927-0857`.

Accepted shared/main boundary observed before parent integration:
- accepted main: `de4bdbf7a5db746e2ac49c69da6235fedebcab70`;
- B parent after normal non-force main merge: `553e0e41883eaf41b9d9274c32eb1483ab7c3bcc`;
- main already contains the corrected B09 provenance boundary and dormant v3 producer via `e3215b21`, plus the C-owned bootstrap-v3 OpenAPI reconciliation.

B10 does not create a new endpoint, service, dependency, DB/schema/migration, signing service or catalog mutation path.

## Implemented boundary

New operator entry:
- `tooling/server/store1-preflight-cli.ts`
- `tooling/server/store1-preflight-cli.test.ts`

Minimal existing-planner hardening:
- `tooling/server/store1-opera-admin-activation.ts`
- `tooling/server/store1-opera-admin-activation.test.ts`

The planner hardening only converts a `reviewerAdmission: null` readback into the existing fail-closed `STORE1_REVIEWER_BETA_ADMISSION_REQUIRED` result instead of dereferencing null.

## Protected input schema

The operator receives one mode-0600 JSON file. It contains no credential bytes directly:

```json
{
  "manifestPath": "<exact B1_RC_MANIFEST.json path>",
  "packagePath": "<exact accepted STORE zip path>",
  "reviewerEmail": "<dedicated reviewer email>",
  "deviceId": "<dedicated reviewer device UUID>",
  "browserVersion": "136",
  "adminSessionFile": "<mode-0600 admin-session token file>",
  "reviewerDeviceBearerFile": "<mode-0600 reviewer extension bearer file>"
}
```

The JSON file and both credential files must be ordinary private files with no group/other permissions. Symlinked credential/input files are rejected. Credential files are one-token-per-file and their values are never emitted in normal output or error output.

The admin session and reviewer extension bearer are intentionally separate authorities:
- admin session is used only for existing admin **GET** readback routes;
- reviewer bearer is used only for the existing ordinary `POST /v1/bootstrap` no-AI request.

No OTP, owner password, signing private key or marketplace credential is consumed by B10.
## Read-only execution sequence

1. Read and hash-check the exact accepted STORE package/manifest through the existing package authority code.
2. Extract the packaged `controlApiOrigin`, trust bundle and packaged bootstrap verifier. Network requests are pinned to that HTTPS origin.
3. Read current beta state, reviewer user, all ACTIVE reviewer-owned account pages and reviewer beta admission through existing admin GET routes.
4. Read current v2 config/signing-key metadata through the existing admin GET route.
5. Only after those readbacks pass, issue the existing no-AI v2 bootstrap with the dedicated reviewer extension bearer and requested reviewer device.
6. Verify the returned signed v2 envelope with the verifier/trust bundle shipped in the exact STORE package. Existing B09 checks bind package, admitted account, active signing key, config metadata, request context and freshness.
7. Continue the existing activation planner by executing **GET instructions only** until it reaches a mutation, READY, BLOCKED or CONFLICT result.
8. Immediately before returning a POST/READY preview, re-read current v2 config. A changed config makes the signature proof stale and the entry returns BLOCKED.
9. Return only a sanitized, explicitly unexecuted next-action preview. UUIDs in preview paths are redacted. The result always reports `catalogMutationExecuted: false`.

There is no code path in this entry that executes a planner catalog POST.

The one network POST B10 can execute is `/v1/bootstrap`. That existing route can update ordinary device/auth metadata as documented by the product contract. Therefore **B10 was not run against live/preprod** in this work. Current evidence is source + synthetic/fake HTTP + disposable PostgreSQL only.

## Transport safety

- production operator uses native `fetch`; injectable fetch/package evidence exists only behind explicit `VITEST=true` test-only exports;
- cross-origin and all redirects are rejected with `redirect: manual`; credentials are never forwarded to a redirect target;
- request origin is the exact packaged HTTPS origin; absolute/cross-origin planner paths fail closed;
- request timeout: 8 seconds;
- maximum response body: 512 KiB, including declared and streamed-size checks;
- 401/403 become sanitized authentication errors;
- other transport/JSON failures return STORE1 error codes, not response bodies or credentials;
- v2 config readback is normalized and validates hashes, signing state and compatibility-policy UUID list before planner use;
- final config readback fences config drift after the signed bootstrap and catalog GETs.

## Parent verification

Toolchain: Node `24.20.0`, pnpm `10.34.5`.

Final parent-tree checks:
- B10 + B09 + planner focused tests: **47/47 PASS**, supervisor `octoport-test-b-31ca3a40da234bf892b149b750a7f383.service`.
- STORE-1 disposable PostgreSQL whole-sequence: **3/3 PASS**, supervisor `octoport-test-b-cbddc71337e14c98aeb0e0e042dea725.service`.
- standalone TypeScript check for the new operator + existing B09/planner modules under project compiler settings: PASS, supervisor `octoport-test-b-87a50cba34df4c2d90d708e60c95fc08.service`.
- targeted ESLint: PASS, supervisor `octoport-test-b-0f65e64bc6bb4fdf901c3ca8909dee86.service`.
- Prettier normalization on final source/test files: PASS, supervisor `octoport-test-b-94076db8f57c41feb629c94291a1a397.service`.
- CLI executable help path: PASS, supervisor `octoport-test-b-5c1aa0e525744889937573a50859a05e.service`.
- `git diff --check`: PASS.

Focused coverage includes:
- valid synthetic signed packaged-verifier path;
- separate admin/reviewer credentials;
- forged caller context rejection;
- cross-origin/path/redirect rejection;
- 401/403 rejection;
- oversized response rejection;
- malformed config metadata rejection;
- tampered signature rejection;
- expiry rejection;
- final config drift -> stale proof BLOCKED;
- mode-permission and symlink protected-input rejection;
- zero catalog POSTs: the valid preview path records only the expected bootstrap POST.

## Scope / handoff

This receipt is SOURCE evidence only. It does not prove LIVE_OWNER reviewer login, deployed backend reachability, actual store review, production catalog state, or deployment.

C may intake this exact B10 candidate normally. A future authorized STORE preflight can supply the protected input files and exact package paths, then run the documented CLI. Actual catalog mutations remain a separate reviewed/authorized operator step and are not performed by B10.
