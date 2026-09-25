# Firefox privacy-neutral server/DB slice 1 — B handoff

Date: 2026-09-25
Role: B
Status: SOURCE + disposable PostgreSQL PASS; NOT LIVE / NOT DEPLOYED.
Assignment authority: `docs/development/coordination/FIREFOX_PRIVACY_NEUTRAL_CONTRACT_2026-09-25.md` at C/main `c8f375f974b1ad6009943e06bc37f8c96dfaf48a`.

## Scope

This bounded slice implements the first B-owned server/DB seam only:
- nullable client software metadata in device authorization/device persistence;
- DB all-or-none PRESENT/WITHHELD guards;
- repository/service projections with authoritative `clientMetadata`;
- idempotent current-device metadata clearing keyed only by authenticated session/device/account authority;
- focused integration coverage for privacy-neutral authorization, exchange/list, clearing, isolation and revocation.

No shared Zod schema, HTTP route, OpenAPI, bootstrap local authority, live DB, deployment or Firefox package is claimed here.
## Migration

Forward migration: `0051_firefox_privacy_neutral_device_metadata.sql`.

`0050` is intentionally untouched/reserved; current canonical main still ends at source0049. The Drizzle journal therefore appends one next entry with tag 0051 and current count 40.

Database constraints enforce:
- WITHHELD: family/version/extension are all NULL;
- PRESENT: browser family and extension version are non-NULL; browser version may be NULL.

The migration first rejects any pre-existing row violating that shape, then drops the two browser-family NOT NULL constraints and adds the shape checks. No down migration and no live application were performed.
## Server behavior

Device authorization accepts either the legacy identified record or a privacy-neutral record with no software metadata. Request fingerprinting remains shape-sensitive, so the same idempotency key cannot switch between identified and withheld forms.

Pending preview and device listing expose:
- `{ state: "WITHHELD" }` and omit legacy top-level metadata fields; or
- `{ state: "PRESENT", browserFamily, browserVersion, extensionVersion }` while retaining the legacy top-level fields for compatibility.

Authorization exchange copies NULL metadata as NULL into the active device.

`forgetCurrentClientMetadata` verifies the existing ACTIVE session joins the same ACTIVE device/account, clears only the three metadata columns, emits one audit event on the first clear, is idempotent when already WITHHELD, and never rotates/revokes session or device authority. Cross-account/session mismatches and revoked devices are unauthorized.
## Verification

Node 24.20.0 / pnpm 10.34.5.

Static:
- Prettier all changed implementation/integration files: PASS.
- ESLint all changed TypeScript files: PASS.
- `git diff --check`: PASS.
- final typecheck: @product/device-auth PASS; @product/device-management PASS; @product/db PASS.
- resource job: `4e3e1bb669a549d3a149aafe57c70342`, exit 0.

Unit:
- @product/device-auth 10/10 PASS.
- @product/device-management 5/5 PASS.
- resource job: `8c131a0ada2a4d709aeff0b06a868dcf`, exit 0.

Focused disposable PostgreSQL:
- p2-3-device-authorization: 10/10 PASS.
- p2-5-device-management: 8/8 PASS.
- resource job: `ad2723095fa2423a92c1741dd129c010`, exit 0, cleanup verified.
Migration-focused disposable PostgreSQL:
- postgres.integration: 3/3 PASS.
- canonical-lineage: 6/6 PASS.
- adapter-registry: 7/7 PASS.
- p2-auth migration-history case: 1 PASS.
- P5 final journal DB-01: 1 PASS.
- P6 admin journal case: 1 PASS.
- resource job: `4c945072e4a547178b178b5fbdd649cc`, exit 0, cleanup verified.

Two discarded runs found test-harness issues only:
1. a 513 MiB focused typecheck budget caused V8 heap OOM; the same DB typecheck passed under the normal 2 GiB integration budget;
2. two historical SQL fixtures used browser_family without extension_version; they were corrected to valid PRESENT rows so their original uniqueness/FK assertions remain meaningful.

No product constraint was weakened to make tests pass.
## C integration needs / remaining work

C still owns the shared request schemas, HTTP route/OpenAPI, portal wire representation and final integration. The server-facing interface needed for the current-device endpoint is:

`DeviceManagementService.forgetCurrentClientMetadata({ sessionId, deviceId, accountId }, correlationId)`

Success returns `{ kind: "CLEARED", deviceId }`; authority mismatch/revoked session or device returns `{ kind: "UNAUTHORIZED" }`. The request body must remain empty and the principal must come from normal extension bearer authentication.

Later B slices still need privacy-neutral bootstrap materialization, bounded release/policy/feature authority, per-browser AI candidates and their disposable PostgreSQL corruption/bounds tests. This receipt does not claim those later slices or Firefox AMO readiness.
