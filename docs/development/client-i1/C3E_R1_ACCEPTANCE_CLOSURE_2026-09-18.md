# C3E R1 Acceptance Closure

Work ID: `SA-I1-C2-3-C3E-R1-ACCEPTANCE-CLOSURE-20260918-01`

This record closes the two evidence gaps identified against C3E candidate
`28094153c49e7296140fe2368837c92571e2ba18`. It does not add C3F scope, winner
selection, reconciliation, or Stream-2 monitoring behavior.

## Result

The C3E implementation is acceptance-ready with one proven external browser
environment gap. The PostgreSQL and server evidence is green. Native Chrome
execution is deferred because the accepted C3D baseline and C3E candidate fail
identically before service-worker registration.

The original candidate was not architect-accepted because PostgreSQL acceptance
had not been run and the native failure had not been differentiated against
C3D.

## PostgreSQL acceptance

- Mechanism: task-owned ephemeral Docker PostgreSQL container, image
  `postgres:18.0`, no persistent volume.
- Database URL: task-ephemeral loopback connection; credentials were not
  committed or written to evidence.
- The complete migration chain succeeds from empty state and upgrades through
  migration `0017_i1_c3e_sync_journal`; rerunning migrations is idempotent.
- The real `/v1/sync` boundary was exercised through Fastify with real
  PostgreSQL persistence and real extension authentication.
- The dedicated sync acceptance covers physical constraints/indexes, compact
  persistence, exactly-once request IDs, conflicting request reuse, revision
  conflicts, mixed entity outcomes, same-entity and independent-entity
  concurrency, rollback, account isolation, installation validation,
  revocation, arbitrary-payload rejection, and the 32-entry bound.
- Focused sync acceptance: 6/6 tests passed. Migration integration: 3/3
  tests passed. Complete affected server integration: 40 files, 1,533 tests
  passed.

The only implementation-side changes in this closure are acceptance evidence:
the stale migration/table expectations were updated for migration 0017 and the
two sync tables, a real PostgreSQL sync integration suite was added, and test
typing/lint issues were corrected. No sync production behavior was bypassed or
weakened.

## Native MV3 differential

The same machine, Chrome binary, harness, generated test authority, and fresh
isolated profiles were used for both revisions.

| Revision | Chrome | Result |
| --- | --- | --- |
| C3D `2b2ca0cdd322b0b180ee348fd9d5deb54141a487` | `/usr/bin/google-chrome`, `147.0.7727.116` | `wait_for_event("serviceworker")` timed out after 30 seconds |
| C3E `28094153c49e7296140fe2368837c92571e2ba18` | same | same timeout |

Direct Chrome diagnostics independently reported `Registration_FailStatus=2`
for both fresh profiles. The failure is deterministic across the controlled
differential and occurs before authenticated-worker bootstrap, storage
initialization, Start/auth lifecycle, or C3E journal use. Source inspection
also shows no C3E network call or unresolved journal transaction on worker
bootstrap. The C3E native failure is therefore classified as
`PREEXISTING_NATIVE_HARNESS_FAILURE` with an environment/browser-deferred
item, not as a C3E production regression.

Native persistence/restart cases C3E-01 through C3E-10 could not be exercised
because the shared baseline startup prerequisite fails. The supported generated
runtime and extracted-package C3E suite passes 6/6, and the corresponding C3D
lifecycle suite passes 18/18. Raw source-tree invocation is not a supported
fixture for these scripts because composition dependencies are assembled by the
package checker.

## Regression and package evidence

- Node: `/root/.nvm/versions/node/v24.20.0/bin/node`, v24.20.0.
- pnpm: 10.34.5.
- Full Extension I1 checker: PASS, 126 gate processes, source and extracted.
- Package ZIP: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`, 1,938,095
  bytes, SHA-256
  `b7c92c1630db11e983de53c99ebb49392412320325a5144e685a2764b393c9a8`.
- Repeat archive match: PASS. Source/extracted byte parity: PASS.
- Root typecheck, build, lint, OpenAPI check, focused unit/API/contract suites,
  and `git diff --check`: PASS.

The repository-wide format checker and document checker still report
pre-existing candidate/historical issues outside this closure. All changed
files pass scoped Prettier checks. No historical report was rewritten.

## Stream boundary and stop boundary

No Stream-2-owned implementation files were changed and no parallel-stream
dependency was created. C3C authority and C3D local-first lifecycle remain
independent of sync. No C3F reconciliation or preferred-executor logic was
started.
