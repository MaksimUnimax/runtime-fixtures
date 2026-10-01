# B04 STORE 0.2.11 cross-version refresh proof — 2026-10-01

Status: **SOURCE + DISPOSABLE POSTGRESQL PASS / NO PRODUCTION SOURCE CHANGE / NOT LIVE_OWNER**.

Task: `B04-STORE0211-CROSS-VERSION-REFRESH`.
Base before this result: `bab7c0085e581150e2bb28b4fd7c4c5912a4fa67`.

## Result

The real server auth/bootstrap stack proves that a valid existing device/session is not bound to the extension version used when its refresh credential was issued.

- A target device is stored as Opera with `extension_version_last_seen=0.2.9`.
- The normal HTTP `POST /v1/auth/refresh` rotates its existing refresh token.
- Rotation creates no second device, session, account admission, or account identity; only the expected next refresh generation is added.
- The returned access token authenticates the same account/device for an identified `control_plane_v2` bootstrap request using Opera 136 and extension `0.2.11`.
- With exact synthetic `0.2.9` predecessor + `0.2.11` release/policy/config authority, the signed v2 bootstrap verifies and reports extension/browser `SUPPORTED`.
- Revoking the device after refresh makes both the new access token bootstrap and replacement refresh credential fail with the existing authorization errors. Changing extension version never restores revoked authority.

## Compatibility separation

A first RED expectation assumed a missing exact `0.2.11` release should make bootstrap HTTP 503. The current accepted bootstrap contract deliberately does not use HTTP failure for this condition: it returns a valid signed snapshot whose compatibility is `UPDATE_REQUIRED` and `UNSUPPORTED_BROWSER`.

The regression now proves this exact separation:
- refresh remains an identity/session operation and can succeed;
- predecessor `0.2.9` remains `SUPPORTED`;
- absent `0.2.11` catalog authority cannot become supported merely because refresh succeeded;
- the signed incompatibility is the fail-closed product signal, consistent with the pre-existing P3.4 `UPDATE_REQUIRED` acceptance behavior.

No compatibility resolver or auth production code was changed.

## Verification

Node: `v24.20.0`.

Final exact test file:
- `tests/integration/server/p3-4-bootstrap.integration.test.ts`: **19/19 PASS**.
- Supervised B disposable PostgreSQL job: `octoport-test-b-d85a4d50f6dd4eedbc3b45bc6dc07d2f.service`.
- Resource receipt: `/root/octoport-control/resource-jobs/d85a4d50f6dd4eedbc3b45bc6dc07d2f/receipt.json`.
- Exit 0, peak 548 MiB, OOM 0, cleanup verified.
- Focused Prettier: PASS.
- Focused ESLint with zero warnings: PASS.
- `git diff --check`: PASS.

The earlier diagnostic run `41988fc75ca94ef98063676c5fa6f932` is retained as RED evidence for the incorrect HTTP-failure assumption; it did not identify a production defect. The first independent review of candidate `2f1c6865...` returned `REWORK_REQUIRED` because the predecessor response was only checked for HTTP 200. The follow-up regression now verifies its signature plus exact `SUPPORTED` extension/browser statuses using a realistic pre-target policy whose recommendation remains `0.2.9`.

## Boundary

This proof does **not** establish that any preserved live Opera profile still has an unexpired/revocable refresh credential. It proves the server contract that C06 needed to distinguish: if the preserved credential is still valid, normal refresh plus 0.2.11 bootstrap requires no new device registration; if it is expired/revoked, ordinary authority remains required.

LIVE_OWNER, real mailbox login, ChatGPT, marketplace calls, store submission, deployment and production acceptance are not claimed.
