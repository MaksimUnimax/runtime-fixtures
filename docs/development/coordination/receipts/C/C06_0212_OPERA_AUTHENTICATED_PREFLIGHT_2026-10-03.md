# C06 — exact STORE 0.2.12 Opera authenticated acceptance preflight

Date: 2026-10-03
Task: `C06-0212-OPERA-AUTH-PREFLIGHT-20261003`
Status: **PREFLIGHT ONLY / NO AUTH, BROWSER, CATALOG OR LIVE ACTION EXECUTED**

## Exact accepted inputs

- branded Chromium STORE candidate: `OCTOPORT-0_2_12-CHROMIUM-44870cd7`;
- source: `1616a88e35766a1d17055216d1348def50989b9f`;
- ZIP: `OCTOPORT_v0.2.12_CHROMIUM_STORE.zip`;
- SHA-256: `44870cd7260dd109168680d6aa17252fafef7e894c0d9b48a8ceff90b29265df`;
- bytes: `2253835`;
- browser: Opera `136.0.6008.22`;
- helper: `tests/regression/extension-core/client-i1/exact-store-authenticated-controls.py`;
- helper SHA-256: `1e63571a9991715e6fdf4c7ef8d7a9a0e45b596a71032128f3eb09371b96102a`.

The helper is the already-published hardened implementation from the accepted C06 full-control boundary. Its focused guard suite passes 27/27 on current main. The helper defaults are historical; every 0.2.12 invocation below must supply exact version, package SHA and browser product explicitly.

## Required order of gates

This preflight does not allow skipping directly to authenticated Work.

0. **Local exact-byte preparation may run before live authority exists.** `prepare` verifies the ZIP SHA, invokes the Opera executable only with `--version`, validates safe runtime/profile paths, materializes the exact runtime and creates the dedicated profile directory. It does **not** launch an Opera browser context, authenticate, contact the control plane or authorize any later gate.
1. **Live catalog/profile readback is mandatory before authentication.** A legitimate current admin session must GET-read the exact 0.2.12 Opera release, policy, signed config, adapter, surface, profile revision and DIRECT Opera ACCOUNT assignment.
2. The release artifact must equal `44870cd7…`; policy minimum/recommended extension must be `0.2.12`; Opera minimum browser remains `136`.
3. Profile identity remains `chatgpt-web-opera-v1` only if the exact published profile revision/content and DIRECT assignment pass the existing transition checks.
4. **Ordinary extension device authentication follows the successful live readback.** Use normal product auth through `wait-auth`; no injected `authenticated`/`workAllowed`, copied cookies, storage state, test-only admission or switch to `technical-auth`.
5. **Authenticated synthetic Work/Start follows ordinary authentication.** Run Start on the exact installed 0.2.12 bytes in Opera 136 only after steps 1–4 pass.
6. Independent exact-artifact review may then decide whether the Chromium operator card can move from `PREPARING` to an Opera-only `READY_FOR_OPERATOR` delivery scope.

Signed-out installation already accepted for the exact branded artifact is not a substitute for gates 1–6.
## Current blockers

The published target reconciliation at main `59cee4f355816d0536a79ad2bd187831a184add0` is SOURCE/SAVED-PACKAGE evidence only.

Current R12 facts remain authoritative:

- a protected technical portal session may be time-valid, but current admin authority is not established;
- the last normal admin elevation returned HTTP 403 `ADMIN_REAUTH_REQUIRED`;
- no admin session was issued;
- fresh technical portal-session issuance was separately platform-blocked before execution and must not be retried through another tool;
- live 0.2.12 release/policy/config/profile/assignment readback is not yet proven;
- authenticated Work/Start on exact `44870cd7…` is not yet proven.

Therefore this receipt performs no live GET, no auth operation and no browser launch.
## Exact helper command templates

The commands are **templates for later permitted execution**. They were not executed by this task.

### Package/browser preparation

```sh
python3 tests/regression/extension-core/client-i1/exact-store-authenticated-controls.py \
  --mode prepare \
  --carrier /root/octoport-control/logs/A/a03-0212-branding-health-authority-successor-20261003/candidate/OCTOPORT_v0.2.12_CHROMIUM_STORE.zip \
  --runtime-dir <REGISTERED_TASK_ROOT>/runtime \
  --profile-dir <REGISTERED_TASK_ROOT>/profile \
  --browser-executable /usr/bin/opera \
  --expected-browser-product 136.0.6008.22 \
  --expected-version 0.2.12 \
  --expected-sha256 44870cd7260dd109168680d6aa17252fafef7e894c0d9b48a8ceff90b29265df \
  --output <REGISTERED_TASK_ROOT>/prepare.json
```
### Ordinary authentication

Only after live catalog/profile readback passes:

```sh
python3 tests/regression/extension-core/client-i1/exact-store-authenticated-controls.py \
  --mode wait-auth \
  --carrier /root/octoport-control/logs/A/a03-0212-branding-health-authority-successor-20261003/candidate/OCTOPORT_v0.2.12_CHROMIUM_STORE.zip \
  --runtime-dir <REGISTERED_TASK_ROOT>/runtime \
  --profile-dir <REGISTERED_TASK_ROOT>/profile \
  --browser-executable /usr/bin/opera \
  --expected-browser-product 136.0.6008.22 \
  --expected-version 0.2.12 \
  --expected-sha256 44870cd7260dd109168680d6aa17252fafef7e894c0d9b48a8ceff90b29265df \
  --auth-timeout-seconds 900 \
  --output <REGISTERED_TASK_ROOT>/wait-auth.json
```

Do not replace this with `technical-auth` as a fallback for this acceptance path. A platform-denied session-issuance operation is not retried or rerouted.
### Local authenticated control matrix

Only on the same already ordinarily authenticated owner-test profile, and only under the separately authorized temporary-store boundary:

```sh
python3 tests/regression/extension-core/client-i1/exact-store-authenticated-controls.py \
  --mode local-matrix \
  --allow-local-test-stores \
  --carrier /root/octoport-control/logs/A/a03-0212-branding-health-authority-successor-20261003/candidate/OCTOPORT_v0.2.12_CHROMIUM_STORE.zip \
  --runtime-dir <REGISTERED_TASK_ROOT>/runtime \
  --profile-dir <REGISTERED_TASK_ROOT>/profile \
  --browser-executable /usr/bin/opera \
  --expected-browser-product 136.0.6008.22 \
  --expected-version 0.2.12 \
  --expected-sha256 44870cd7260dd109168680d6aa17252fafef7e894c0d9b48a8ceff90b29265df \
  --output <REGISTERED_TASK_ROOT>/local-matrix.json
```

This matrix does **not** execute provider checks, live AI Work, transfer or auth reset. A separate exact 0.2.12 authenticated Work/Start scenario is still required.
## Fail-closed boundaries

- Package SHA, manifest version or Opera product mismatch: stop.
- Missing or mismatched live release/policy/config/profile/revision/assignment: stop before auth.
- Ordinary login/device flow incomplete: stop; do not inject auth state.
- Start unknown/error/profile mismatch: no automatic retry.
- No marketplace/provider business operation is part of this preflight.
- No catalog/DB/service/store mutation is authorized here.
- No `READY_FOR_OPERATOR`, LIVE_OWNER, browser-store, DEPLOYMENT or PRODUCTION claim follows from this receipt.

## Verification performed now

- current-main helper SHA readback: PASS;
- exact branded package SHA/bytes readback: PASS;
- Opera product string readback: PASS;
- helper guard suite: **27/27 PASS**;
- helper `--mode describe`: PASS;
- no browser/auth/catalog/provider/service operation executed.

Evidence:
- `/root/octoport-control/logs/C/c06-0212-opera-auth-preflight-helper-guards-20261003.log`;
- `/root/octoport-control/logs/C/c06-0212-opera-auth-preflight-describe-20261003.json`;
- `/root/octoport-control/logs/C/c06-readiness-r12-20261003/RESULT.json`;
- `docs/development/coordination/receipts/B/A03_0212_BRANDED_OPERA_TRANSITION_TARGET_RECONCILIATION_2026-10-03.md`.

Evidence level: **SOURCE / PREFLIGHT ONLY**.
