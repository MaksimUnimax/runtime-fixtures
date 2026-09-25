# C02 B server-CI route-count repair — 2026-09-25

Status: CANDIDATE / NOT MAIN / NOT DEPLOYED

Integrated C candidate before this repair:
`12d80b52bd041aa03115236436a4c7a55920ee82`.

GitHub Server CI run:
`36122537525`.

The run failed only in:
`apps/api/src/admin-ops-routes.test.ts > P6.2 admin API boundary > publishes the exact method tuples`.

Observed:
- expected route-method tuple count: 139;
- generated/received count: 142;
- all other API unit tests in that CI step: 270 passed.

## Cause

The accepted B STORE-1 admin activation work adds exactly three authenticated read routes:
- `GET /v1/admin/compatibility/releases/{version}`;
- `GET /v1/admin/compatibility/config-releases/latest`;
- `GET /v1/admin/beta/admission/accounts/{account_id}`.

The tracked OpenAPI artifact already contained these routes and its exact total was 142. The P6.2 route-tuple test retained the stale pre-intake count 139.

No product route implementation was changed by this C repair.

## Repair and validation

C updated only the acceptance test:
- route-method count `139 -> 142`;
- explicit `get` assertions added for all three new paths;
- existing publish-route assertion retained.

Pinned environment: Node 24.20.0 / pnpm 10.34.5.

First full API rerun used an insufficient 817 MiB resource profile and exited 137 with `ENVIRONMENT_RESOURCE_LIMIT`; cleanup verified. It is not product evidence.

Accepted rerun:
- resource unit `octoport-test-c-e134deb0b9a94678951418cd7647322e.service`;
- memory limit 2048 MiB;
- peak 1105 MiB;
- `@product/api` unit suite: 22 files / 271 tests PASS;
- `@product/api openapi:check`: PASS;
- exit 0;
- cleanup verified.

A fresh exact-head five-workflow CI cycle is required after this commit. No live mutation occurred.
