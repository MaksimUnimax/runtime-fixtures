# B C03 — API-watch document-scope persistence — 2026-09-29

Status: **SOURCE + DISPOSABLE POSTGRESQL ACCEPTED BY B / NOT LIVE**

Activation:
- `/root/octoport-control/peer-handoffs/B/C-B-C03-DOCUMENT-SCOPE-ACTIVATE-20260929-0935.request.json`
- supersedes the earlier STORE defer after B formally re-submitted the current-main B02 preflight successor.

## Scope implemented

Canonical migration:
`packages/server/db/drizzle/0055_api_watch_document_scope_persistence.sql`

Migration SHA-256:
`eb2d79f09baafad1170ccf961c7197dd704eface1a649821bf85e32ff1d923cb`

0055 is strictly additive:

- adds nullable `document_key varchar(128)` to `api_watch_product_crosswalk`;
- adds nullable `document_key varchar(128)` to `api_watch_incidents`;
- rejects empty/whitespace document keys when non-NULL;
- performs **no guessed backfill**;
- preserves all legacy rows as `document_key IS NULL`;
- does **not** change `incident_key` uniqueness;
- adds no new unique key/index semantics;
- changes no C-owned API-watch evaluator/crosswalk source.

Journal:
- previous canonical latest: `0054_api_watch_product_baselines`;
- new canonical latest: `0055_api_watch_document_scope_persistence`;
- journal idx: 43;
- migration timestamp: `1790674500000`;
- current canonical migration count: 44.

## Persistence-boundary verification

New integration:
`packages/server/db/src/api-watch-document-scope-migration.integration.test.ts`

It proves on real disposable PostgreSQL:

1. **Fresh install**
   - canonical migrations reach 44 / 0055;
   - both columns exist as nullable `varchar(128)`;
   - explicit `wb-content-v3` round-trips independently through crosswalk and incident tables;
   - empty/whitespace explicit keys are rejected by DB constraints.

2. **Exact canonical 0054 prefix -> 0055 upgrade**
   - prefix has 43 migrations and neither table has `document_key`;
   - legacy crosswalk + incident rows are inserted without any document scope;
   - canonical 0055 upgrade preserves both legacy values as NULL;
   - post-upgrade explicit document keys round-trip;
   - ledger ends at 44 / `1790674500000`.

## Test evidence

Focused migration static/unit:
- `packages/server/db/src/migrations.test.ts`: **19/19 PASS**.
- ESLint PASS.
- Prettier PASS.
- `git diff --check` PASS.
- `B guard` PASS.

Disposable PostgreSQL, run sequentially because each integration file owns/reset the same B test schema:

### 0055 fresh + upgrade
Resource:
`/root/octoport-control/resource-jobs/a0575302ae204bbba6cd628ef78b47d6/receipt.json`
- command exit 0
- OOM kill 0
- cleanup verified
- peak 600834048 bytes

### canonical lineage
Resource:
`/root/octoport-control/resource-jobs/7a6ecd252af74a0baef7d60865ad2858/receipt.json`
- command exit 0
- OOM kill 0
- cleanup verified
- peak 610271232 bytes

### common fresh PostgreSQL migration suite
Resource:
`/root/octoport-control/resource-jobs/2833a0bd9af945d08ec4ba0d83a62ab8/receipt.json`
- command exit 0
- OOM kill 0
- cleanup verified
- peak 581959680 bytes

### workspace typecheck
Resource:
`/root/octoport-control/resource-jobs/c96978171d84482f8cb9bb55bcf68359/receipt.json`
- command exit 0
- OOM kill 0
- cleanup verified
- peak 2123366400 bytes

## First red batch classification

The first combined resource job:
`/root/octoport-control/resource-jobs/a193c7cba9104754a3e9361db0f71237/receipt.json`
returned exit 1 because three independent integration files were launched in parallel against the same disposable database while each drops/recreates `public`.

Observed cross-test interference:
- `schema "public" already exists`;
- `relation "api_watch_reports" does not exist`;
- duplicate `browser_family` enum;
- migration count from another concurrently-running file.

This was not accepted as a product/migration result. Re-running the exact relevant files **sequentially** produced the three PASS receipts above.

## Ownership / boundary

B did not edit:
- `tooling/api-watch/**`;
- C evaluator/recovery logic;
- Health/shared contracts;
- apps/site or extension logic.

The current Postgres stores for crosswalk/incidents live in C-owned `tooling/api-watch`; C must wire `documentKey` into its types/INSERT/SELECT and incident key/recovery logic after this exact B submit.

No live DB migration, deployment, monitor-pilot mutation, STORE0.2.8 bundling, production write, auth bypass, package publication, or payment action was performed.
