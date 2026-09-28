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
- `api-watch-product-baseline.integration.test.ts`: 7/7 PASS, including
  explicit no-auto-advance, create, CAS update, stale CAS, missing snapshot,
  direct/repository scope mismatch, two-connection concurrency, uniqueness,
  append-only/history integrity.
- `canonical-lineage.integration.test.ts`: 7/7 PASS.
- `postgres.integration.test.ts`: 3/3 PASS.
- `adapter-registry.integration.test.ts`: 7/7 PASS.
- `health-retention-upgrade.integration.test.ts`: 10/10 PASS.
- Total targeted PostgreSQL assertions: 34/34 PASS.
- Supervisor:
  `octoport-test-b-ed66dcb2cd05493c8846b5cb1bc93ead.service`,
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
