# STORE-1 ordinary-admin activation preparation — 2026-09-25

Status: SOURCE + DISPOSABLE POSTGRESQL CANDIDATE. No live catalog mutation, live DB migration, deployment, external message, store submission, or beta opening is authorized or claimed.

Controller assignment: STREAMS-AUDIT-20260925-0726 / PREPROD_DEPLOYMENT_CORRECTIONS_R2.

## Exact package authority

- source HEAD: e7d66152bdb77918b65115486c9829ef7a634e69
- source tree: 01ae2c1d84a354a11d919a313f8d9909d1285b6a
- product/extension version: 0.2.4
- contract: control_plane_v2
- browser family: opera
- minimum Opera version: 136
- current Chromium/Opera STORE ZIP SHA256: 0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c
- release authority SHA256: 73ba767c24ed7bd365ccd83b30feb4544dae7a0950602330725ad0b583e8cbd7
- B1 candidate manifest SHA256: 6b670838f285f3dbdfd1f471be78a83086c56fae192c83672a2d94179a7b28dd
- current STORE ZIP filename: OCTOPORT_v0.2.4_CHROMIUM_STORE.zip
- profile content SHA256: 878076e4e324dcc7feedebe9d55d7c96beb1a9eb2c3920cbc25f4d101e2d40bd
Historical 891b/6914 activation evidence is superseded for package authority; its operator-path semantics remain useful only as historical evidence. This receipt is rebound to the repaired package authority handed off by C at current main.

## Source changes

The ordinary admin surface now has bounded readback needed for idempotent activation:

- GET /v1/admin/compatibility/releases/:version under compatibility.read
- GET /v1/admin/compatibility/config-releases/latest?contractVersion=... under compatibility.read
- GET /v1/admin/compatibility/policies accepts optional contractVersion; default remains control_plane_v1 for compatibility
- GET /v1/admin/beta/admission/accounts/:account_id under beta.admission.read

These are read-only. They add no catalog mutation primitive, no signing-key exposure, no reviewer bypass and no general beta opening.

tooling/server/store1-opera-admin-activation.ts is a pure source-side planner. It takes local package bytes/manifest and optional safe readback JSON. It has no DATABASE_URL, cookie, OTP, token, network request or live apply mode.
## One-step activation semantics

The planner pins package authority to the exact accepted source HEAD/tree and current STORE ZIP SHA, then returns exactly one next ordinary-admin action.

Before any mutation it must complete this reviewer preflight:

1. global beta reads CLOSED
2. dedicated reviewer identity already exists and is ACTIVE
3. reviewer owns one ACTIVE account
4. that account is already beta-admitted

Only after all four pass can activation proceed:

5. exact immutable extension release 0.2.4 + exact current artifact SHA + control_plane_v2 + opera
6. exact store1.opera.v2 policy
7. latest v2 base config precheck; if absent, terminal STORE1_V2_BASE_CONFIG_MISSING
8. add-only config link with expectedLatestConfigVersion CAS; existing signing/config authority is retained by the accepted B06 endpoint
9. ChatGPT / standard / standard_composer_v1 registry hierarchy
10. chatgpt-standard-opera-v1 profile and exact canonical content fingerprint
11. DRAFT -> CANDIDATE -> PUBLISHED through existing P7 lifecycle
12. Opera ACCOUNT assignment using DIRECT exact published profile

After every POST the operator re-reads ordinary admin state before selecting another action. Exact state is reused; conflicting immutable authority fails closed. A reviewer blocker therefore leaves no partial STORE1 catalog/profile activation from this planner.
## Reviewer access boundary

Current auth semantics permit an existing verified identity to log in by the normal OTP path while global beta is CLOSED. First-time identity creation is denied while CLOSED.

There is no accepted targeted reviewer-invite mutation that creates one new beta identity while keeping global beta CLOSED. Therefore this candidate does not open beta and does not use SQL/admin bypass to fabricate a reviewer.

The planner requires:
- a pre-existing ordinary reviewer user identity whose queried email is verified,
- exactly one ACTIVE owned account after exhausting account pagination,
- existing beta_admissions membership for that account/user,
- global beta mode CLOSED.

If any of these are absent it returns a terminal reviewer prerequisite blocker. The private reviewer email is never committed, logged, or embedded in this receipt; operator readback uses the placeholder <REVIEWER_EMAIL_PRIVATE>.
## Rollback / correction implications

Published release/config/profile/assignment authority is immutable/append-only. Do not delete history as rollback.

- wrong immutable extension release for version 0.2.4 is a conflict, not an overwrite
- compatibility/config correction is a new revision/config release with CAS
- profile correction is a new immutable profile revision
- profile-selection correction is a new assignment revision
- beta remains CLOSED throughout this preparation
- runtime/DB rollback remains governed by the separate C06 deployment runbook and controller corrections; this candidate does not authorize it

## Verification

Required toolchain: Node 24.20.0 / pnpm 10.34.5.

PASS:
- focused typecheck: @product/admin-commercial, @product/db, @product/api
- focused ESLint: changed B-owned files, no suppressions
- planner units after full pagination + reviewer-verification fixes: 15/15
- admin-commercial + beta-admin units: 78/78
- generated OpenAPI targeted source tests: 4/4 (tracked shared artifact intentionally C-owned)
- P6.4 disposable PostgreSQL matrix: 120/120
- STORE1 whole-sequence disposable PostgreSQL rehearsal after pagination fix: 1/1
Whole-sequence rehearsal uses real API/service routes for every STORE1 mutation. It starts with only a valid v2 signing/config baseline plus an already-admitted reviewer fixture, keeps global beta CLOSED, converges through release/policy/config/registry/profile/assignment, then a second complete planner pass produces zero mutations and no new audit writes.

Real current package authority was also parsed from:
- /root/octoport-control/logs/C/store-release-e7d66152/candidate/B1_RC_MANIFEST.json
- /root/octoport-control/logs/C/store-release-e7d66152/candidate/OCTOPORT_v0.2.4_CHROMIUM_STORE.zip

The local bytes hash matched 0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c.

## Independent review

Luna R1 found two P2 issues and both were corrected before candidate creation:
- reviewer/CLOSED-beta preflight now completes before any catalog/profile/assignment POST;
- package authority is pinned to the exact accepted source HEAD/tree and current STORE ZIP SHA, not merely a self-consistent manifest.

Luna R2 found one P2 pagination issue: a target profile fingerprint on a later revision page could be mistaken for absence. The planner now records nextCursor, reads all profile-revision pages before CREATE/reuse/conflict decisions, blocks if pagination completeness is unknown, and checks duplicate exact fingerprints only after nextCursor=null. Planner regression tests and the whole-sequence disposable PostgreSQL rehearsal pass after this fix.

Luna R3 confirmed the pagination fix but found one P2 reviewer-preflight issue: ACTIVE user status alone did not prove the queried reviewer email identity was verified. The readback now derives queriedEmailVerified from the exact filtered admin user response and blocks before any POST unless that specific email identity has a non-null verifiedAt timestamp.

Luna R4 confirmed reviewer verification but found one conditional P2 idempotency issue: adapter/surface/variant/profile/assignment list reads also used only the first paginated page. The planner now records and exhausts nextCursor for every catalog collection before create/reuse/conflict decisions, and blocks if completeness is unknown. Integration readback accumulates every page.

Luna R5 reviewed the complete candidate read-only and found no remaining material correctness, security, or idempotency issue. R1-R4 findings are closed. The reviewed state remains SOURCE/DISPOSABLE only; Opera publication is still PREPARING and no live catalog activation or store submission is claimed.

## Shared OpenAPI handoff to C

B did not edit packages/contracts/openapi/openapi.json.

Generated current representation:
- /root/octoport-control/logs/B/store1-admin-activation-openapi.generated.json
- SHA256 47354206e226a382fcd8cae7b9e80ba292912763eb0efc78bda15e26b5f233ae

Patch against tracked shared artifact:
- /root/octoport-control/logs/B/store1-admin-activation-openapi.patch
- SHA256 83a7a31ccb5f3aa956fb5543d6b7963505b22e8b7c6a144ef4cb6ccfd93f86e4

C must regenerate/review the shared artifact from the integrated exact B candidate; the external files are evidence/handoff, not independent authority.
