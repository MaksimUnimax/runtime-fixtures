# C02 B STORE-1 + subscription-expiry intake — 2026-09-25

Status: CANDIDATE / NOT MAIN / NOT DEPLOYED

Accepted base:
`49f564113607c4d413a971d3615b99e2e024e849`.

Exact B submission:
`b2df3fe20b310e2c272b700e6ebc838869a0c5be`.

C merge:
`1569f4cd070ce2652c835a6d6583a0c48c467188`.

Merged tree:
`19ac0d0c079476b91b9a452dc5caf6fbb22c4792`, byte-identical to exact B submitted tree.

The diff from accepted base contains 29 B-owned server/tooling/integration-test/receipt files only. No site/SEO path is involved.

## STORE-1 repaired authority

Active package authority is:
- source HEAD `e7d66152bdb77918b65115486c9829ef7a634e69`;
- source tree `01ae2c1d84a354a11d919a313f8d9909d1285b6a`;
- version `0.2.4`;
- contract `control_plane_v2`;
- Opera ZIP SHA256 `0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c`;
- release authority SHA256 `73ba767c24ed7bd365ccd83b30feb4544dae7a0950602330725ad0b583e8cbd7`;
- B1 manifest SHA256 `6b670838f285f3dbdfd1f471be78a83086c56fae192c83672a2d94179a7b28dd`.

Historical `891b89f... / 6914b019...` values remain only under the explicit `supersedesHistoricalPackageAuthority` evidence field and are not active planner inputs.

Integrated planner against the real repaired C B1 manifest + exact Opera ZIP returns:
- authority `e7d66152 / 01ae2c1d / 0c1fb4c9`;
- first action: read-only `GET /v1/admin/beta/admission`;
- purpose: verify global beta remains CLOSED before any STORE-1 mutation.

No live apply mode, token, cookie, OTP, DATABASE_URL or direct SQL path exists in the planner.

## STORE-1 / admin validation

C exact-candidate prevalidation on `b2df...`:
- frozen offline install: PASS;
- typecheck: `@product/admin-commercial`, `@product/db`, `@product/api` PASS;
- planner units: 15/15 PASS;
- beta-admin units: 6/6 PASS;
- admin-commercial route units: 72/72 PASS;
- focused unit/API total: 93/93 PASS;
- P3.4 authenticated bootstrap: 16/16 PASS;
- STORE-1 whole-sequence disposable PostgreSQL rehearsal: 1/1 PASS;
- standalone P6.4 admin-commercial PostgreSQL matrix: 120/120 PASS;
- canonical-lineage integration: 7/7 PASS.

An earlier C convenience run launched P3.4 + P6.4 + STORE1 in one Vitest invocation; two unrelated P6.4 cases hit the default 5-second timeout while P3.4 and STORE1 passed. Re-running P6.4 standalone, matching its intended acceptance shape, passed 120/120. No assertion/correctness failure remained.

Canonical-lineage resource job:
`octoport-test-c-9a2d23d195c84679b0dee153da076935.service`, exit0, peak398 MiB, cleanup verified.

## Subscription-expiry correctness

The submitted candidate also includes the bounded B subscription-expiry correction:
- one shared lifecycle classifier/materializer under existing account/row locking;
- grant rechecks time after account lock;
- EXTEND materializes due lifecycle before mutation;
- checkout materializes due current state before admission;
- webhook provider `occurredAt` remains chronology, while `receivedAt` drives lifecycle classification;
- reconciliation provider `statusAt` remains chronology, while `processedAt` drives lifecycle classification;
- delayed success with an already-ended provider period is immediately re-materialized to EXPIRED in the same transaction.

C content-delta validation:
- DB typecheck PASS;
- P5.2 94/94;
- P5.3 103/103;
- P5.4 119/119;
- P5.5 123/123;
- total 439/439;
- resource job `octoport-test-c-88cddf6dedae41bba638e7df36ffb470.service`, exit0, peak737 MiB, cleanup verified.

No schema/migration, new lifecycle cron, client 24-hour refresh, paidThrough+72h policy, payment-provider live action or deployment is introduced by this correction.

## Shared OpenAPI handoff

B intentionally left the shared tracked OpenAPI artifact to C.

C regenerated:
`packages/contracts/openapi/openapi.json`.

Result:
- generated SHA256 `47354206e226a382fcd8cae7b9e80ba292912763eb0efc78bda15e26b5f233ae`;
- byte-identical to B generated handoff artifact;
- `pnpm --filter @product/api openapi:check`: PASS;
- `git diff --check`: PASS.

No live catalog, live DB, production service, reviewer login, marketplace provider, payment provider or store submission action is claimed by this receipt.
