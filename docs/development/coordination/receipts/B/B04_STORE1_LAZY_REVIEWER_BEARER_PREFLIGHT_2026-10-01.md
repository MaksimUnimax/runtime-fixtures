# B04 STORE1 lazy reviewer-bearer preflight — 2026-10-01

Status: **SOURCE PASS / REVIEW PENDING / NO LIVE OR CATALOG MUTATION**.

Task: `B04-STORE1-LAZY-REVIEWER-BEARER-PREFLIGHT`.

## Defect

The accepted STORE1 read-only CLI required both the protected admin session and the
reviewer device bearer before it performed any reviewer prerequisite readback.
The reviewer identity/account/admission checks themselves use authenticated admin
GET routes only.

That ordering created a circular and misleading prerequisite: an operator could
not learn that the dedicated reviewer identity, ACTIVE account, verification or
beta admission was missing unless a reviewer device bearer already existed.

## Correction

Protected authority loading is now staged:

1. validate the operator input shape;
2. read and validate only the protected admin session;
3. use admin-only GETs to establish CLOSED beta, reviewer identity and queried
   email verification, all ACTIVE-account pagination, and existing admission;
4. if any reviewer prerequisite is missing, return the existing precise
   STORE1 blocker without reading the reviewer bearer and without bootstrap;
5. only after all reviewer prerequisites pass, read and validate the protected
   reviewer device bearer;
6. preserve the existing signed-bootstrap, config-drift and catalog-read
   preflight unchanged.

The JSON contract still requires `reviewerDeviceBearerFile`; this change delays
opening that file. It does not make the bearer optional for bootstrap.

## Fail-closed matrix

Focused tests prove that an absent reviewer-bearer file does not mask these
admin-only prerequisite outcomes:

- missing reviewer identity ->
  `STORE1_REVIEWER_IDENTITY_PREEXISTING_REQUIRED`;
- suspended reviewer -> `STORE1_REVIEWER_SUSPENDED`;
- unverified queried reviewer email ->
  `STORE1_REVIEWER_EMAIL_VERIFIED_REQUIRED`;
- no ACTIVE reviewer account -> `STORE1_REVIEWER_ACCOUNT_REQUIRED`;
- multiple ACTIVE reviewer accounts -> `STORE1_REVIEWER_ACCOUNT_AMBIGUOUS`;
- missing beta admission -> `STORE1_REVIEWER_BETA_ADMISSION_REQUIRED`.

For all six cases the test transport observes GET requests only and no
`/v1/bootstrap`.

When all reviewer prerequisites pass, an absent bearer still fails closed with
`STORE1_REVIEWER_INPUT_INVALID` before bootstrap.

Existing admin-session symlink/private-mode rejection remains before any HTTP
request.

## Verification

Node `v24.20.0`.

- `tooling/server/store1-preflight-cli.test.ts`: **22/22 PASS**;
- focused ESLint: PASS with zero warnings;
- focused Prettier: PASS;
- `git diff --check`: PASS.
- pnpm dependencies were restored offline from the existing local store only and
  the isolated worktree `node_modules` was removed after verification.

## Boundary

No reviewer is created or admitted. Global beta is not opened. No SQL bypass,
owner-as-reviewer substitution, fallback credential, live bootstrap, catalog
mutation, database write, provider call, store action or deployment is performed
by this source change.

A real reviewer bearer is still mandatory once the ordinary reviewer
prerequisites are satisfied. Human OTP/login/device/reviewer acceptance remains
separate live evidence.
