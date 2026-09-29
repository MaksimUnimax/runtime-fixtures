# B retention durable harness DB guard — 2026-09-29

Status: **SOURCE + DISPOSABLE POSTGRESQL PASS / NO LIVE MUTATION**.

Request:
`C-B-RETENTION-DURABLE-HARNESS-DB-GUARD-20260929-0436`.

## Defect

The versioned c2 retention compatibility `setup.ts` accepted any
`DATABASE_URL`, created a runtime, then executed destructive
`DROP SCHEMA ... CASCADE`. The README required `B heavy --db`, but the
executable itself did not enforce the role-owned disposable database identity.

## Correction

A dedicated guard now runs before database runtime creation. It accepts only
the existing B disposable convention already enforced by `control.py`:
loopback host, port `15542`, role `octoport_test`, database
`octoport_b_test`, with no query or fragment.

The guard rejects missing/blank/invalid URLs, non-PostgreSQL schemes,
non-loopback hosts, monitor-pilot identity, product-shaped database names,
wrong B port, wrong role, and URL options. The regression also verifies source
ordering: guard call precedes `createDatabaseRuntime`, which precedes
`DROP SCHEMA`.

No c2 writer, 0052 migration-prefix, maintenance, replay, or retirement
semantics were changed.

## Targeted verification

- Node `v24.20.0`; pnpm `10.34.5`.
- `disposable-db-guard.test.ts`: **12/12 PASS**.
- Targeted Prettier: PASS.
- Targeted ESLint: PASS.
- `git diff --check`: PASS.

One positive destructive setup proof was run only through:

`python3 tooling/coordination/control.py B heavy --db -- pnpm exec tsx tooling/server/retention-compat-c2/setup.ts`

Resource job: `octoport-test-b-58687d6b167848639e28f2eb88b69b7e.service`.

Observed result:

- exit code: `0`;
- peak memory: `275 MiB`;
- cleanup verified: `true`;
- database: `octoport_b_test`;
- role: `octoport_test`;
- migration journal count: `41`;
- `health_no_session_run_receipts`: present;
- `monitor_profile_repair_bindings`: absent;
- `api_watch_product_baselines`: absent.

No monitor-pilot/product database, provider, service, or live schema was touched.
The exact candidate SHA is recorded by the B submit and C peer handoff.
