# R5 / Q1-B browser-family resume evidence — 2026-09-23

Status: `STOPPED_BY_OWNER / IMPLEMENTED_CANDIDATE / NOT_ACCEPTED`

## Identity

- Worktree: `/root/runtime-fixtures-r5-browser-family-isolated-20260923`
- Branch: `work/r5-browser-family-isolated-2026-09-23`
- Product base: `2193f34523e8c0b15046c38c32af499f1b226179`
- Resume-state HEAD before this evidence commit: `9b87b9cf8ef6b974bf37b6fb8bce833995b2a321`
- Preserved product candidate: 46 tracked dirty + 6 untracked files
- Candidate identity SHA-256: `0f8d089b13409911fc48fb43f438a8b124e57146ae7a7bda16087a8fa36531cb`
- Runtime: Node `v24.20.0`, pnpm `10.34.5`

## Completed evidence before STOP

### Focused activation port contract

Run `R5Q1B-ACTIVATION-PORT-20260923-R1` used a real disposable PostgreSQL instance and non-default ports API/Portal/Admin `3110/3210/3310`. The focused `activation.spec.ts` case passed `1/1`; the repaired expectation follows `portalOrigin` / `E2E_PORTAL_PORT` rather than hard-coding port 3200.

### Validation batch

Run `R5Q1B-VALIDATION-20260923-R1` was bound to candidate digest `0f8d089b13409911fc48fb43f438a8b124e57146ae7a7bda16087a8fa36531cb`.

- `pnpm typecheck`: PASS
- `pnpm lint`: PASS; bridge boundary guard PASS
- `pnpm format:check`: PASS
- `pnpm openapi:check`: PASS
- `pnpm build`: PASS for API, worker, health-runner, portal and admin
- migration through candidate `0033_browser_family_product_matrix`: PASS on a fresh disposable PostgreSQL database
- `pnpm test:integration`: PASS — 42/42 test files, 1553/1553 tests
- first Extension I1 run without native browser proof: expected FAIL only at AUT-47 (`ENVIRONMENT_DEFERRED_NATIVE_MV3_REGISTRATION`)

### Fresh current-candidate package and Chromium proof

Run `R5Q1B-INSTALLED-20260923-R1` built a fresh test-configured package from the current candidate using an ephemeral test-only signing pair. No private key is persisted in Git.

- package: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`
- package SHA-256: `5279666b79b8321e31499e8245b7fbcd4643e30720a3dc8dafa3d09686b1804e`
- runtime files: 39
- repeat archive identity: PASS
- source↔extracted byte identity: PASS
- browser-family runtime contract: PASS for Chrome, Opera, Yandex Chromium, Firefox and Safari; Edge remains unsupported
- Playwright Chromium source runtime: BR-C1-01..38 = 38/38 PASS
- Playwright Chromium extracted runtime: BR-C1-01..38 = 38/38 PASS
- this is exactly `REAL_UNPACKED_CHROMIUM_PASS`; it is not a Google Chrome/Opera/Yandex/Firefox/Safari claim
- Extension I1 rerun with that proven marker: PASS, 142 gate processes

### Real Opera / Yandex boundary

Opera on `/usr/bin/opera` with the exact current package:

- focused BR-C1-01 source+extracted smoke: PASS
- runtime identity is independently reported as `browser.family=opera` rather than aliased to Chrome
- full Opera source run was in progress when owner STOP arrived
- observed before stop: BR-C1-01..18 PASS; BR-C1-19 FAIL with `WORK_START_PENDING_COMMIT_READBACK_FAILED`; BR-C1-20 PASS; BR-C1-21 FAIL with timeout waiting for `#account`; BR-C1-22 had started but did not complete
- therefore Opera full acceptance is **not accepted** and requires root-cause/rework on resume

Yandex Browser on `/usr/bin/yandex-browser` with the exact current package:

- standard headless and headed-Xvfb load-extension attempts produced no Seller Agents service worker in clean profiles
- bounded direct launch + CDP evidence reported zero `chrome-extension://` targets
- no alternative legitimate automated native install route was proven before STOP
- classification: `ENVIRONMENT_DEFERRED` for Yandex native installation; no product PASS/FAIL is inferred from absent registration

## STOP boundary

Owner issued direct STOP during the real Opera full matrix. The active Opera process was terminated / observed absent, and the disposable PostgreSQL container `octo-r5q1b-validation-pg` was removed. No matching R5 browser/test process remains.

## Exact resume point

1. Re-read this receipt and `docs/development/autowork/AUTOWORK_STATE.md`; verify candidate identity.
2. Do not repeat the already-green server/DB/Chromium evidence unless candidate identity changes.
3. Analyze Opera BR-C1-19 and BR-C1-21 together as the current reachable failure batch before product/harness mutation.
4. Apply three-level ownership analysis, repair only at the owning layer, then rerun focused Opera cases 19/21 and affected Opera matrix.
5. Keep Yandex as environment-deferred unless a legitimate native installation route becomes available.
6. Chrome, Firefox and Safari still require their own legitimate environment-specific evidence; do not transfer Chromium or Opera results.
