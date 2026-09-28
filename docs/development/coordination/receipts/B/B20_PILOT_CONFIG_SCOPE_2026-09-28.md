# B20 — pilot retention CLI config scope — 2026-09-28

Status: **SOURCE + DISPOSABLE RUNTIME CANDIDATE; NOT LIVE / NOT DEPLOYED**.

Task: `C-B-B20-PILOT-CONFIG-SCOPE-20260928-1725`.
Base: canonical main `f6bcd1ce99740b67a2e17056e9350131b624f725`, B branch synchronized with main content before this correction.

## Finding

The finite retention CLI imported shared `loadConfig(process.env)`. That parser validates the complete product `AppConfig` (`NODE_ENV`, `LOG_LEVEL`, `API_PORT`, worker delay and other full-server composition assumptions) even though retention maintenance needs only:

- `DATABASE_URL` for the isolated pilot database runtime;
- `MONITOR_PILOT_EXPECTED_ROLE` for the existing pilot database-role hard-pin.

C's authorized isolated-pilot `inspect` therefore failed with a Zod error before reaching database authority preflight when only the dedicated `/etc/octoport-monitor/pilot.env` runtime inputs were supplied. C correctly refused to copy unrelated owner-test/product configuration into the pilot service.

## Correction

`tooling/server/monitor-pilot-retention.ts` no longer imports or calls shared `loadConfig`.

A dedicated `resolveMonitorPilotRetentionCliEnvironment()` now reads exactly two inputs:

- non-empty `DATABASE_URL`;
- non-empty `MONITOR_PILOT_EXPECTED_ROLE` (trimmed).

Missing values fail closed with `MONITOR_PILOT_DATABASE_URL_REQUIRED` or the existing `MONITOR_PILOT_EXPECTED_DATABASE_ROLE_REQUIRED`.

Unchanged security/behavior boundaries:

- `preflightMonitorPilotAuthority()` still performs the canonical `octoport_monitor_pilot` database-name check and exact expected-role check;
- `inspect` remains read-only;
- `apply` still requires exact `ISOLATED_MONITOR_PILOT_RETENTION` confirmation;
- no fallback to product/owner-test environment;
- no secret copying, direct SQL, migration, daemon/poller or live mutation.

## Verification

Pinned Node `v24.20.0`, pnpm `10.34.5`.

Focused unit contract:

- `tooling/server/monitor-pilot-retention.test.ts`: **7/7 PASS**;
- new test supplies deliberately invalid unrelated `NODE_ENV`, `LOG_LEVEL`, `API_PORT`, and `WORKER_READY_DELAY_MS` while valid pilot DB/role inputs resolve successfully;
- missing/blank `DATABASE_URL` and missing expected role fail closed.

Static checks:

- targeted Prettier PASS;
- targeted ESLint PASS;
- `git diff --check` PASS.

Disposable runtime probe through the required B resource supervisor and DB injector:

- command path: `B heavy --db`;
- unrelated AppConfig fields deliberately invalid;
- retention CLI reached the existing pilot DB identity guard and returned `MONITOR_PILOT_DATABASE_IDENTITY_MISMATCH`, which is the expected fail-closed boundary for a B disposable database whose name is not the canonical isolated pilot database;
- wrapper asserted that exit `1` boundary and returned success;
- supervisor `octoport-test-b-432dffdee084497e950af082e2695053.service`;
- resource job exit `0`, peak `210 MiB`, cleanup verified.

An earlier probe incorrectly expected `MISSING_AUTHORITY` / exit `2`; source inspection confirmed database identity mismatch intentionally throws before catalog authority classification. That probe changed no data and cleanup was verified. The corrected probe above is the acceptance evidence.

## C handoff

C may take this exact candidate into its integration branch and rerun the existing `/etc/octoport-monitor/pilot.env` + systemd-role `inspect` wrapper. B does not run or mutate the live pilot.

Acceptance after C intake is the real isolated-pilot result reaching retention authority/schema inspection without requiring unrelated product AppConfig. Any later finite `apply` remains a separate C-authorized runtime action under the existing confirmation and caps.
