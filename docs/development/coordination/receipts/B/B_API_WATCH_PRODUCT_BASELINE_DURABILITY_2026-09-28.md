# B — API-watch product-compatible baseline durability

Date: 2026-09-28
Task: `B_API_WATCH_PRODUCT_BASELINE_DURABILITY`
Request: `C-B-API-WATCH-PRODUCT-BASELINE-20260928-2200`
Base: `36f1f7d4386142a3783be92ec1da33f0889a58bf`
Evidence level: SOURCE + DISPOSABLE_POSTGRESQL. No live DB migration or deployment.

## Result

Added the minimal B-owned durable primitive for a separately accepted
product-compatible API-watch baseline. It is intentionally independent from
authority/acquisition state and from C-owned acceptance policy/wiring.

Migration `0054_api_watch_product_baselines` adds:
- one current pointer per `source_family + nullable document_key`, with
  null-safe uniqueness;
- FK references to already persisted `api_watch_snapshots`; no artifact
  payload bytes are duplicated;
- monotonically revisioned current state plus append-only audit history;
- safe acceptance metadata: accepted time, actor label and evidence reference;
- database-level scope, history, revision-chain and referenced-snapshot guards.

Repository `createApiWatchProductBaselineRepository` exposes only:
- `read(scope)`: accepted snapshot id/SHA/spec-version plus acceptance
  metadata and current revision;
- `accept(input)`: explicit initial create or exact expected-revision CAS
  update.

The repository does not inspect or consume `AUTHORITY_ACCEPTED`,
`ACQUIRED_OFFICIAL_SOURCE_CANDIDATE`, `NO_CHANGE`, `COMPLETED` or incident
states. Persisting/acquiring a snapshot alone leaves the product baseline
absent. C remains the owner of compatibility evidence and advancement policy.

## Database invariants

The final migration rejects:
- missing snapshot references;
- family/document mismatch, including direct SQL;
- duplicate family-level or document-level baseline scopes;
- revision jumps and mutable baseline scope;
- pointer updates without a matching audit revision at transaction commit;
- forged/non-contiguous history and wrong previous-snapshot links;
- update/delete/truncate of audit history;
- later source-family/document-key drift of a snapshot referenced by current
  baseline or audit history.

Snapshot validation reads use `FOR SHARE`, preventing an insert/update from
racing a concurrent snapshot scope rewrite. A two-connection PostgreSQL
regression proves the concurrent scope update waits and then fails closed after
the baseline transaction commits.

## Validation

Environment:
- Node `24.20.0`
- pnpm `10.34.5`

Static:
- `@product/db typecheck`: PASS.
- DB unit/migration suite: 6 files, 32/32 PASS.
- targeted Prettier: PASS.
- targeted ESLint: PASS.
- `git diff --check` plus new-file whitespace checks: PASS.

Final disposable PostgreSQL run, sequential under B DB supervisor:
- `api-watch-product-baseline.integration.test.ts`: 9/9 PASS, including
  explicit no-auto-advance, create, CAS update, stale CAS, missing snapshot,
  direct/repository scope mismatch, two-connection concurrency, uniqueness,
  append-only/history integrity, identical-byte snapshot document scopes and
  independent family/document report-source scopes.
- `canonical-lineage.integration.test.ts`: 7/7 PASS.
- `postgres.integration.test.ts`: 3/3 PASS.
- `adapter-registry.integration.test.ts`: 7/7 PASS.
- `health-retention-upgrade.integration.test.ts`: 10/10 PASS.
- Total targeted PostgreSQL assertions: 36/36 PASS.
- Supervisor:
  `octoport-test-b-078354803b9f405dbf56d49f448e48ef.service`,
  exit 0, peak 520 MiB, cleanup verified.

An earlier attempt launched multiple schema-resetting integration suites in one
parallel Vitest invocation against the same disposable DB. It failed with
cross-suite `DROP/CREATE SCHEMA` races and duplicate catalog objects. This was
a runner-shape error, not candidate evidence. The required suites were rerun
sequentially through the same supervised disposable-DB path and passed.

## Independent review

Luna read-only reviews found and drove two pre-commit fixes:
1. direct SQL could bind a baseline to a snapshot from a different scope;
2. a concurrent snapshot scope update could race baseline insertion.

Both were corrected at the database layer with negative/concurrency PG
coverage. Final review:
`/root/octoport-control/logs/B/api_watch_baseline_final_r6_20260928-result.md`
returned exactly `NO BLOCKING DEFECTS`.

## Boundary

No `tooling/api-watch/run.ts`, acceptance policy, shared contract, provider
logic, live database, deployment, production unit, package publication or
artifact payload was changed. C must explicitly decide when compatibility
evidence is sufficient and wire the repository; no automatic baseline
advancement is introduced.

## Document-scope follow-up

C follow-ups `C-B-API-WATCH-SNAPSHOT-DOCUMENT-SCOPE-20260928-2000`,
`C-B-API-WATCH-REPORT-DOCUMENT-SCOPE-20260928-2005`,
`C-B-API-WATCH-PRODUCT-BASELINE-REWORK-20260928-2012` and
`C-B-API-WATCH-DOCUMENT-SCOPE-CONSTRAINT-DETAIL-20260928-2015` are folded into
the same unapplied migration `0054` before C intake. No `0055` was created.

`api_watch_snapshots` now replaces the old `(source_family,sha256)` unique index
with one inferable `UNIQUE ... NULLS NOT DISTINCT` index on
`(source_family,sha256,document_key)`. Family-level `NULL` and distinct
document keys therefore coexist for identical bytes while duplicate exact
nullable scopes conflict. PostgreSQL integration explicitly proves
`ON CONFLICT (source_family,sha256,document_key)` inference for the family-null
and document cases.

`api_watch_report_sources` now has nullable `document_key`; the old
`(report_id,source_family)` primary key is replaced by one inferable
`UNIQUE ... NULLS NOT DISTINCT` index on
`(report_id,source_family,document_key)`. Existing rows upgrade as `NULL` and
remain unique. One report can retain family-level plus sibling WB document
outcomes independently. PostgreSQL integration explicitly runs C's exact
`ON CONFLICT (report_id,source_family,document_key)` target for both `NULL` and
non-null document scopes.

The canonical project platform is PostgreSQL 18 (`postgres:18.0` in Server CI,
coordination disposable DBs and current A/B/C/owner-test containers), so the
PostgreSQL >=15 requirement of `NULLS NOT DISTINCT` is within the supported
platform.

Final Luna reviews:
- `/root/octoport-control/logs/B/api_watch_document_scope_final_20260928-result.md`: `NO BLOCKING DEFECTS`;
- `/root/octoport-control/logs/B/api_watch_conflict_authority_final_20260928-result.md`: `NO BLOCKING DEFECTS`.

Coordinated deployment requirement: C must deploy its updated report/snapshot
reader-writer wiring together with migration `0054`; the old two-column report
conflict target must not be used after the migration. C owns that source wiring
by the handoff contract.
