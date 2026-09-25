# C02 B server-CI OpenAPI static-fact repair — 2026-09-25

Status: CANDIDATE / NOT MAIN / NOT DEPLOYED

Previous C candidate:
`699234960e9e9d8df9f1de4a297e2969f24ba2e7`.

GitHub Server CI run:
`36123901567`.

Unit-stage route tuple acceptance was already repaired and passed. The same run then failed only in integration:
`tests/integration/server/p5-7-p5-final-acceptance.integration.test.ts > STATIC-71`.

Observed stale facts:
- expected OpenAPI operation count: 139;
- actual tracked artifact count: 142;
- expected historical artifact SHA256: `2d7fafc8...`;
- actual tracked artifact SHA256: `47354206e226a382fcd8cae7b9e80ba292912763eb0efc78bda15e26b5f233ae`.

## Cause

The accepted STORE-1 admin activation intake adds three authenticated read surfaces:
- `GET /v1/admin/compatibility/releases/{version}`;
- `GET /v1/admin/compatibility/config-releases/latest`;
- `GET /v1/admin/beta/admission/accounts/{account_id}`.

The tracked OpenAPI artifact and API route-boundary test already represented 142 operations. P5.7 retained the pre-intake count/hash.

No product route, server behavior, schema, migration or subscription logic changed in this repair.

## Repair and validation

C updated only `STATIC-71`:
- label/count `139 -> 142`;
- exact artifact SHA256 -> `47354206e226a382fcd8cae7b9e80ba292912763eb0efc78bda15e26b5f233ae`.

Pinned Node: 24.20.0.

Targeted PostgreSQL validation:
- resource unit `octoport-test-c-104acdaf97ca483d968729a48d2beb95.service`;
- `tests/integration/server/p5-7-p5-final-acceptance.integration.test.ts`: 80/80 PASS;
- exit 0;
- peak 587 MiB;
- cleanup verified.

The previous accepted local API validation remains:
- `@product/api`: 22 files / 271 tests PASS;
- `openapi:check`: PASS;
- resource unit `octoport-test-c-e134deb0b9a94678951418cd7647322e.service`.

A fresh exact-head five-workflow CI cycle is required after this commit. No live mutation occurred.
