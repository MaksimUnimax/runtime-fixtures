# B06 current admin BFF integration — 2026-10-01

Status: **SOURCE INTEGRATION CANDIDATE PASS; DISPOSABLE ADMIN BROWSER CONSUMER PENDING; NOT LIVE / NOT DEPLOYMENT**.

Task: `B06-ADMIN-BFF-CURRENT-UI-INTEGRATE`.
Role: B.
Fresh common main before this integration: `6c9708592a60b7c4d4851cf4ef7a25d90109f7fe`.
Accepted C source base: `deb7294b4248af7c8176426899923914bce970af`.
Accepted final C product candidate: `8c231b286d73a6b5ab230a8e013f0e1a6b13a559`.
Accepted patch-id: `6016548308b77cc2a576706a893c015aae838262`.
B reconstructed product commit: `e920e6e771b15d6350a054766338e3a3c5b4d79b`.

## Why one final candidate

Three C B06 source tasks use the same two BFF files:

- Health notifications;
- complete Health current-UI read surface;
- final Health + Support + Beta current-UI surface.

Each accepted candidate is a standalone snapshot with the same parent `deb7294b...`. The final candidate `8c231b28...` contains the complete intended current UI surface, so B applies that final snapshot once rather than stacking historical intermediate snapshots.

Before applying it, the two product files on current main were byte-equivalent to the accepted source base: path drift from `deb7294b...` to `6c970859...` was zero.

B cherry-picked only `8c231b28...`; the resulting patch-id is exactly `6016548308b77cc2a576706a893c015aae838262`. No divergent C branch history was merged.

## Product boundary

Changed product paths:

- `apps/admin/lib/control-plane-route.ts`;
- `apps/admin/lib/control-plane-route.test.ts`.

The final allowlist exposes only routes already used by current admin UI:

- Health current UI GET surface;
- Support cases/detail/aggregates/funnels GET routes;
- existing Support status/followup POST routes;
- Beta admission GET/POST.

It preserves rejection of intentionally unexposed or invalid surfaces, including account-specific Beta admission GET, unlisted Health routes, invalid/nested/future paths, extra methods and traversal/encoded variants.

Existing request/response restrictions remain authoritative: no arbitrary Authorization forwarding; cookie/CSRF/reauth/server permission checks remain on existing server paths; no API, schema, repository or UI implementation is added.

## Source verification

The first local focused run accidentally used Node 22 and emitted the package-engine warning. It is retained only as a diagnostic and is **not acceptance evidence**.

Accepted Node environment: `v24.20.0`.

Exact B source gate on `e920e6e7...`:

- `lib/health-admin.test.ts`: 3 PASS;
- `lib/control-plane-route.test.ts`: 188 PASS;
- `lib/admin-ui.test.ts`: 5 PASS;
- total: **196/196 PASS**;
- `@product/admin typecheck`: PASS;
- Prettier: PASS;
- `git diff --check`: PASS.

Evidence:
`/root/octoport-control/logs/B/b06-admin-bff-focused-node24-e920e6e7.log`.

## Consumer evidence boundary

C created a normal disposable browser/BFF/API acceptance task for the exact product candidate. Its real R4 stack established:

- BFF negative boundaries PASS;
- Beta route reaches API-level authorization;
- Health target GET returned API 404 because the disposable E2E `api-harness` omitted the existing `healthAdminService`;
- Support status POST returned API 404 because the same harness omitted the existing `feedbackSupportService`;
- no BFF product defect was proven.

Blocker receipt:
`/root/octoport-control/logs/C/b06-admin-bff-browser-harness-blocker-20261001.json`.

The prerequisite `B06-E2E-HARNESS-ADMIN-READ-SERVICES` is separately C-owned on the test-only harness path. B does not edit that path or fake browser interception. A later browser PASS may be reused only if it exercises patch-equivalent product bytes. Any later negative product evidence overrides this source PASS.

## Evidence limits

This receipt claims SOURCE integration only.

It does not claim:

- DISPOSABLE_ADMIN_BROWSER acceptance yet;
- live admin session behavior;
- live DB mutation;
- deployment or production behavior.

Main publication still requires independent exact-head review, five exact-head GitHub workflows, fresh-base `ready-main`, non-force push and readback; B will not publish this candidate before reconciling the pending disposable browser consumer result.
