# Firefox privacy-neutral admin device projection — B follow-up

Date: 2026-09-25
Role: B
Task: FIREFOX_PRIVACY_NEUTRAL_ADMIN_DEVICE_PROJECTION
Status: SOURCE + DISPOSABLE POSTGRESQL CANDIDATE; NOT LIVE / NOT DEPLOYED

## Trigger

C integration state identified a concrete B-owned blocker after a legal metadata-forget operation: the admin device repository used `String(row.browser_family)`, turning SQL NULL into the fabricated string `"null"` and continuing to project legacy browser/version fields for a WITHHELD device.

Base B HEAD: `509845f0e07907f2a5b0e174aca39b41e2156e81`.
Canonical main observed for this follow-up: `7945d62854e135421c3db003c603187b9f37866b`, already in B ancestry.

## Fix

- `@product/admin-ops` `SafeDevice` is now a strict PRESENT/WITHHELD union.
- PRESENT carries authoritative `clientMetadata` and keeps the three legacy fields for compatibility.
- WITHHELD carries only `clientMetadata: { state: "WITHHELD" }`; legacy browser/version/extension fields are omitted.
- `p6-admin-ops-repository` maps only the two valid persisted shapes and fails closed on a partial/corrupt metadata tuple.
- B-owned admin API projection is type-safe for the union and does not fabricate legacy fields for WITHHELD.
- Historical P6 test fixtures now create a valid PRESENT row under migration 0051 before testing unrelated admin behavior.
- API/OpenAPI test stubs were updated only to satisfy the already-existing slice-1 repository interface and PRESENT fixture shape.

No shared Zod contract, tracked OpenAPI artifact, migration, schema, live DB, deployment or production service was changed.
## Verification

Toolchain: Node 24.20.0 / pnpm 10.34.5.

Static:
- Prettier focused files: PASS.
- ESLint focused files: PASS.
- `git diff --check`: PASS.

Typecheck:
- `@product/admin-ops`: PASS.
- `@product/db`: PASS.
- `@product/api`: PASS.
- supervised job: `8583e84bb28b4724bb7b754f4af4f1c6`
- exit 0; OOM 0; cleanup verified.
- log: `/root/octoport-control/logs/B/firefox-admin-device-projection-typecheck-final-20260925.log`

Unit/API boundary:
- `@product/admin-ops`: 107/107 PASS.
- `apps/api/src/admin-ops-routes.test.ts` + `apps/api/src/openapi.test.ts`: 27/27 PASS.
- supervised job: `38254677324d475ea4783e1b2a5140e5`
- exit 0; OOM 0; cleanup verified.
- log: `/root/octoport-control/logs/B/firefox-admin-device-projection-unit-final-20260925.log`

Disposable PostgreSQL:
- `tests/integration/server/p6-2-admin-operations.integration.test.ts`: 108/108 PASS.
- Includes a new regression proving PRESENT preserves exact metadata while WITHHELD omits all three legacy fields and never returns fabricated values.
- supervised job: `d7c2a4d0f9be40e9b9920b6ca7e2354d`
- exit 0; OOM 0; cleanup verified.
- log: `/root/octoport-control/logs/B/firefox-admin-device-projection-p6-2-20260925.log`

A prior combined typecheck job `4e94ae51daa5461cbdf41b8421ca9606` exited 2 because one API test fixture lacked the new PRESENT `clientMetadata` field and the OpenAPI generator stub lacked the already-existing `forgetCurrentClientMetadata` repository method. Those fixture-only gaps were corrected; that failed job is not acceptance evidence.
## C integration seam

C remains the shared-contract/OpenAPI owner.

The B source object delivered to the admin route is now exactly:
- WITHHELD: common device fields + `clientMetadata: { state: "WITHHELD" }`; no legacy software metadata fields.
- PRESENT: common device fields + authoritative `clientMetadata` plus byte-equivalent legacy top-level fields.

C must update its shared `AdminDeviceItem` response union and generated OpenAPI atomically with intake of this B candidate. Until that shared wire is integrated, the current tracked legacy admin response schema is not a standalone WITHHELD-wire acceptance claim.

No live migration/deploy/browser/store readiness is inferred from this candidate.
