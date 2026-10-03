# B05 owner-test service revision topology — 2026-10-03

Status: **SOURCE / LIVE READ-ONLY SERVICE TOPOLOGY PASS**

Task: `B05-OWNER-TEST-SERVICE-REVISION-TOPOLOGY-20261003`.

## Purpose

Bind the actual owner-test API/worker/portal revisions and determine whether the split release is internally compatible, without restarting services, changing configuration, touching the database, or claiming current-main deployment.

## Live readback

The three owner-test units are active:

- `seller-agents-owner-test-api.service` — release `ec99b58b29f0ae51463e197a28aa784a93a45eb2`, started 2026-09-29 08:49:09 MSK.
- `seller-agents-owner-test-worker.service` — release `62024d192a8572c11aafab91653330d1f996699f`, started 2026-09-28 14:42:31 MSK.
- `seller-agents-owner-test-portal.service` — release `62024d192a8572c11aafab91653330d1f996699f`, started 2026-09-28 14:42:31 MSK.

Public read-only probes to `https://api.octoport.ru` returned:

- `GET /health/live` -> HTTP 200, `{"status":"live"}`.
- `GET /health/ready` -> HTTP 200, `{"status":"ready"}`.

These shapes match the current source health contract. They do not expose or prove a deployed Git revision.
## Split-release compatibility

`62024d192a8572c11aafab91653330d1f996699f` is an ancestor and direct parent of the API release `ec99b58b29f0ae51463e197a28aa784a93a45eb2`.

Across the product/server scope:

- `apps/api`
- `apps/worker`
- `apps/portal`
- `packages/server`
- `packages/contracts`
- `packages/control-client`
- `packages/shared`

the only path changed from `62024d19` to `ec99b58b` is:

`packages/server/db/src/p3-policy-publication-repository.ts`

The change replaces compatibility-policy links by browser/global scope during config publication instead of blindly appending policy revisions. It is consumed through the server DB/admin command path; worker and portal source do not change between these two releases.

The hotfix blob is:

- `62024d19`: `7ee15ab914f367bc4955e3165e27b38a1131d1c6`
- `ec99b58b`: `0bdc0de2e120efea1acdf60daf632e2c3605fe2f`
- observed `origin/main` `482f268f1f10819bda93e2414002a54c85cdafc8`: `0bdc0de2e120efea1acdf60daf632e2c3605fe2f`

Therefore the API-only hotfix is preserved in current accepted source.
## Current-main boundary

The owner-test deployment is **not** current main.

`62024d19` is an ancestor of current main, but `ec99b58b` is not in current-main ancestry even though the hotfix blob is preserved there.

From API release `ec99b58b` to observed current main `482f268f`, there are 68 changed product/server paths:

- `apps/api`: 9
- `apps/portal`: 2
- `apps/worker`: 2
- `packages/contracts`: 7
- `packages/control-client`: 2
- `packages/server`: 46

Those later changes include signed AI profile, monitoring/repair, retention, beta/admin and control-client work. This receipt does not assert their deployment.

## Verdict

**EXISTING_DEPLOYMENT_SPLIT_COMPATIBLE_BUT_NOT_CURRENT_MAIN**

The API/worker/portal SHA split is explainable and compatible for the existing deployed line: API is the worker/portal release plus one API-side compatibility-policy publication repository fix, and current accepted source retains that exact fix.

This is not evidence that:

- current main is deployed;
- exact branded STORE 0.2.12 is backend-compatible live;
- current live catalog/profile assignments accept 0.2.12;
- ordinary authenticated Work is accepted;
- owner-test DB/schema is at current main;
- deployment or production readiness is complete.
Current 0.2.12 live catalog/profile compatibility remains separately blocked on legitimate admin-session readback and authenticated acceptance.

## Evidence

Privacy-safe machine evidence:

`/root/octoport-control/logs/B/b05-owner-test-service-revision-topology-20261003.json`

No environment-file contents, cookies, tokens, credentials, business data, database rows, or private configuration values were read or persisted. No service, Git ref, catalog, DB, deployment, or runtime mutation was performed.
