# B06 STORE-1 authenticated config-release linking — 2026-09-24

Status: SOURCE/DISPOSABLE POSTGRESQL CANDIDATE. No live DB mutation, deployment, beta opening, package publication, or store submission is authorized or claimed.

## Scope

This closes the remaining normal ADMIN HTTP config-release/link operator gap after the already-existing:
- extension release publication route carrying the exact store ZIP artifact SHA and explicit control_plane_v2/browser support;
- compatibility policy publication route;
- P7 ADMIN profile/assignment routes.

New endpoint:
- POST /v1/admin/compatibility/config-releases/publish
- permission: compatibility.manage
- ordinary admin mutation guard supplies session + CSRF;
- body is strict: contractVersion, expectedLatestConfigVersion, non-empty unique compatibilityPolicyRevisionIds, bounded reason.

The endpoint is intentionally add-only. The operator does not supply signing key, snapshot/envelope versions, feature rules, rollout links, publishedAt, hashes, or configVersion.

Inside one PostgreSQL transaction the repository:
1. re-authorizes compatibility.manage using authorizeAdminMutationInTransaction;
2. takes a per-contract advisory transaction lock shared with the existing SYSTEM config publication path;
3. reads the latest config for the requested contract;
4. enforces expectedLatestConfigVersion CAS;
5. requires the expected v1/v2 snapshot/envelope pair;
6. preserves the current signing key, all existing compatibility links, feature-rule links, and feature-rollout links;
7. requires at least one genuinely new compatibility-policy link;
8. re-runs existing P3 source validation;
9. inserts the immutable next config release and links through the existing persistence path;
10. writes CONFIG_RELEASE_PUBLISHED with actor_type=ADMIN, principal, request correlation and safe bounded reason.

Missing base/source maps to safe 404. Stale/invalid/no-op authority and database conflicts map to safe 409. Transaction-time authorization failures remain 403. Database/private details are not exposed.

No migration or schema change was required.

## STORE-1 operator sequence after this source candidate

1. Publish the exact A store ZIP through POST /v1/admin/compatibility/releases/:version/publish with artifactSha256, control_plane_v2 and the exact supported browser family.
2. Publish the STORE-1 compatibility policy through the existing ADMIN compatibility route.
3. Read the latest control_plane_v2 configVersion.
4. Call POST /v1/admin/compatibility/config-releases/publish with that expectedLatestConfigVersion and the published policy revision id.
5. Use existing P7 ADMIN routes for ChatGPT Standard registry/profile/Opera assignment.
6. Read back ordinary compatibility/bootstrap resolution. No direct SQL/DB CLI is part of the accepted operator sequence.

Beta admission remains CLOSED unless separately authorized.

## Verification

Node 24.20.0 / pnpm 10.34.5.

Final formatted tree focused gate:
- Prettier focused files: PASS
- ESLint focused files: PASS
- @product/admin-commercial: 92/92 PASS
- focused ADMIN API/RBAC/schema tests: PASS
- focused generated OpenAPI schema test: PASS
- @product/admin-commercial typecheck: PASS
- @product/db typecheck: PASS
- @product/api typecheck: PASS
- resource job: 4b62d9a0825e4b208a3d0248b9cf595e, exit 0, OOM 0, cleanup_verified, peak 734003200 bytes

Disposable PostgreSQL P6.4 acceptance:
- 120/120 PASS
- includes ADMIN audit attribution/reason/correlation, post-route role revocation, ADMIN_OPS denial, add-only preservation, no-op replay, missing policy, revoked baseline signing authority, beta CLOSED
- log: /root/octoport-control/logs/B/store1-config-http-p64-20260924.log
- resource job: b5007037346e434184a61787f8b201b6, exit 0, OOM 0, cleanup_verified, peak 639631360 bytes

Existing P3 regression, sequential on the same disposable DB:
- publication: 4/4 PASS
- config source validation: 10/10 PASS
- audit rollback: 3/3 PASS
- log: /root/octoport-control/logs/B/store1-config-http-p3-regression-sequential-20260924.log
- resource job: 07afafec97094dc1bee04001de4c8913, exit 0, OOM 0, cleanup_verified, peak 552599552 bytes

A prior attempt that launched three integration files concurrently on one database is explicitly NOT acceptance evidence; it produced expected cross-suite interference/deadlocks and was replaced by the sequential green run.

## Shared OpenAPI handoff to C

B did not edit packages/contracts/openapi/openapi.json because shared/contracts are C-owned.

Generated exact current representation:
- /root/octoport-control/logs/B/store1-config-http-openapi-20260924.generated.json
- SHA256: 0580dd1c31edd7f4624207a80c29a0bb929d7f2b8e710bbecfcb9d40487d9347

Patch against the current tracked shared artifact:
- /root/octoport-control/logs/B/store1-config-http-openapi-20260924.patch
- SHA256: 31c777cfdd1dbcf568a57bb883a8aa4c59d1d557a58f07880a47c8d5c2a4b2e0

C must regenerate/review the shared artifact from the integrated exact B source SHA rather than treating this external patch as independent authority.

## Remaining boundaries

- exact store ZIP SHA is A/package authority and is supplied to the existing extension-release ADMIN HTTP step; this B endpoint does not duplicate package identity;
- P7 assignment remains the existing ADMIN path, not duplicated here;
- shared OpenAPI artifact needs C intake;
- no live catalog mutation/deploy/owner-login/store submission was performed;
- Safari remains outside beta.
