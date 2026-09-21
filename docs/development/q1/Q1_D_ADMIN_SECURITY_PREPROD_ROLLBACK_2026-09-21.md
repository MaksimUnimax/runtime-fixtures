# Q1-D Admin / Security / Preprod / Rollback — automated closure

Work ID: `Q1-D1-20260921-ADMIN-SECURITY-PREPROD-ROLLBACK-AUTOMATED-CLOSURE`

This is a bounded candidate receipt, not architect acceptance. It was run in
the separate worktree `/root/runtime-fixtures-q1d` from the accepted local
Stream-1 line. The active SMTP/Exim worktree was not opened for mutation.

## Git and scope

- Start HEAD: `9db71a1479debcac94ab6e98b3f24b952afbde54`
- Start tree: `2888fa4f9d9873d969ee18dc33cc70990ea3a583`
- Branch: `feature/q1-d-admin-security-rollback-2026-09-21`
- Final HEAD/tree: recorded in the terminal handoff after the bounded commit.
- Migration source: latest numbered migration `0018`; the Drizzle journal has
  19 rows including the initial migration.
- Existing owner Chromium artifact was not rebuilt. Its verified SHA-256 is
  `bfdb6f67b0abb7efd1f7892382e2b1c8c16c07c957e0567d247ef143091f61be`.
- Changed files are limited to the Q1-D harness/evidence and disposable E2E
  harness corrections listed by the terminal handoff. No SMTP/Exim, Stream-2,
  extension runtime, or live deployment file was changed.

## Initial failure batch

The complete reachable batch was collected before product changes:

| Observation | Classification | Disposition |
|---|---|---|
| Clean worktree had no installed test dependencies | `HARNESS_DEFECT` | Installed from the existing offline pnpm store; no lockfile change. |
| First E2E invocation did not pass the nested Playwright config | `HARNESS_DEFECT` | Re-ran with the explicit config. |
| E2E reset inserted signing-key events without their parent key | `HARNESS_DEFECT` | Reset now ignores non-owned event fixtures. |
| E2E ports were hard-coded and conflicted with an existing local portal | `HARNESS_DEFECT` | Added environment-overridable disposable ports; existing process was not killed. |
| Security E2E used hard-coded origins after port override | `HARNESS_DEFECT` | Origins now derive from the same test configuration. |
| Parallel schema-resetting integration suites raced on one disposable DB | `HARNESS_DEFECT` | Suites were rerun serially; no product defect. |

No `ADMIN_RBAC_DEFECT`, `SUPPORT_ROLE_DEFECT`, `SESSION_SECURITY_DEFECT`,
`CSRF_ORIGIN_DEFECT`, `CAPACITY_ADMIN_DEFECT`, `AUDIT_DEFECT`,
`DIAGNOSTIC_PRIVACY_DEFECT`, `PREPROD_PROD_ISOLATION_DEFECT`,
`SECRET_ISOLATION_DEFECT`, `DEPLOYMENT_SAFETY_DEFECT`,
`MIGRATION_SAFETY_DEFECT`, `ROLLBACK_DEFECT`, `TRUST_ROLLBACK_DEFECT`, or
`SECURITY_HEADERS_DEFECT` was found.

## Admin authorization and sessions

Server-side authorization is enforced by the admin permission guard and the
transactional mutation authorization layer. Owner/admin operations, support
read/operations, billing read-only, and beta-operator permissions are distinct.
Support cannot grant capacity, change privileged account authority, impersonate,
read marketplace credentials, bearer/session secrets, raw reports, AI message
bodies, transfer secrets, or backup passwords. Ordinary users and unauthenticated
requests are denied admin operations; UI hiding is not the enforcement boundary.

Admin sessions are random server-side identifiers stored by digest, expire after
the accepted 30-minute window, use Secure/HttpOnly/SameSite cookies, have a
separate CSRF token, and are revoked on logout. No secret is placed in a URL,
GET is not used for privileged mutation, and stale logged-out sessions do not
re-elevate.

The admin BFF is same-origin and allowlisted. State-changing requests carry the
current CSRF token. Hostile-origin API preflight has no CORS grant; there is no
wildcard credentialed origin. The live portal/API were inspected without
mutation: HTTPS, CSP, frame denial, nosniff, restrictive referrer/permissions
policy, and HSTS are present on the portal; the API has no wildcard CORS and
uses no-store on sensitive admin responses. The live portal currently emits a
duplicate restrictive Referrer-Policy from the Next/Nginx layers; this is a
deployment configuration cleanup opportunity, not an authorization bypass.

## Capacity and audit

Admin capacity changes are permission-gated, transactional, request-id
idempotent, concurrency-safe, and produce an audit entry. Existing admitted
users remain usable and the mutation exposes no credentials or user secrets.
Privileged audit entries contain actor, action, safe target, timestamp,
correlation/request id, and result. The audit projection excludes OTPs,
passwords, bearer/session tokens, marketplace credentials, raw reports, AI
message bodies, transfer material, backup passwords, and signing private keys.
Support/user APIs cannot edit or delete privileged history.

## Diagnostics and environment isolation

Support/admin diagnostics expose only the allowlisted operational projection.
Raw seller reports, marketplace cookies/tokens/storageState, OTPs, bearer
tokens, AI conversation bodies, transfer packets, and backup plaintext are not
returned. The admin-AI E2E and database AI suites passed with the same boundary.

Preprod, production, and disposable local/CI are separate environment profiles
with separate DB/config/session/signing secrets. Bootstrap private keys remain
server-only; public trust metadata is bound to the selected environment and
fingerprint. Test-only behavior is not enabled by production defaults, and the
preprod DB is not an automatic production promotion source.

## Secret and artifact scan

The owner Chromium ZIP was scanned after extraction. It contains no private
key, SMTP credential, DB URL, session secret, or signing private material. The
only credential-named runtime file is the existing client-side adapter module;
it is not a server secret store and was not changed.

Tracked-source matches are expected test fixtures, documentation examples, or
server-only configuration names. They were classified as `TEST_FIXTURE_ONLY`
or `SERVER_ONLY_REFERENCE`; no value was copied into a client artifact. Portal,
admin, and API/server source paths had no private-key/SMTP/DB-secret match in
the artifact scan. No server secret entered the owner extension ZIP or portal
artifact.

The accepted owner package identity remains:

| Field | Value |
|---|---|
| Browser target | Chromium / MV3 owner test package |
| Product version | `0.2.4` |
| SHA-256 | `bfdb6f67b0abb7efd1f7892382e2b1c8c16c07c957e0567d247ef143091f61be` |
| API contract | existing `api.octoport.ru` contract; unchanged |
| Trust | preprod trust identity is server-selected; private key not packaged |

The new disposable deployment harness also emits revision manifests with
source HEAD/tree, product version, browser target, migration level, trust key
id, environment, and a deterministic manifest SHA.

## Migration, deployment, and rollback

The disposable PostgreSQL database `product_control_plane_e2e` was migrated
from its empty prior state with the current migration runner. A controlled SQL
failure returned PostgreSQL error class `42P01` and transaction rollback left
the probe relation absent. The migration unit suite passed 3/3; the policy is
forward-compatible schema plus forward-fix/restore, never an automatic
destructive downgrade.

`pnpm q1d:deployment-harness` passed all of the following in a temporary
preprod-only directory:

`PRECHECK → identity/config validation → revision N deploy → revision N+1
health pass → induced health failure detection → exact revision N rollback →
health pass`.

The harness rejects a production environment, does not regenerate secrets,
checks the previous artifact digest, and records safe revision/error/health
metadata only. Bootstrap trust rotation passed the safe sequence of key A,
overlap A+B, switch to B, and rollback while A remains trusted; an unknown key
is rejected. No private key is placed in the extension.

## Regression evidence

- Admin-auth: 45/45.
- Admin-ops: 107/107.
- Beta access: 2/2.
- DB unit: 12/12; migration runner: 3/3.
- API: 225/225.
- Portal: 36/36.
- Remote-config: 46/46.
- Bootstrap: 60/60.
- Health-runner privacy/security sanitizer: 33/33.
- Admin-commercial: 89/89; admin-AI: 6/6.
- PostgreSQL admin/beta/audit/auth integration batch: 198/198.
- PostgreSQL bootstrap/signing trust integration: 23/23.
- PostgreSQL AI/bootstrap integration: 12/12.
- Admin AI E2E: 3/3.
- Admin/admin-safety/security E2E on disposable PostgreSQL: 40/40.
- Deployment harness: PASS; controlled migration failure: PASS.
- Live API ready: HTTP 200; live portal: HTTP 200.
- `business-bridge-2.service`: active; `127.0.0.1:18083`: listening.

The Node 22 shell warning was environmental only; the repository requires
Node 24 and the installed live services use Node 24.20.0. No production/live
deployment was restarted or mutated for this Q1-D work.

## Governance and remaining external actions

Stream-2 implementation paths were not modified. The SMTP/Exim worktree and
S1.2 email implementation were not modified. Existing owner-external actions
remain separate: AdminVPS outbound TCP/25 unblock, PTR
`78.17.68.165 → mail.octoport.ru`, DKIM/DMARC publication, real owner mailbox
OTP receipt, browser-store/publisher actions, legal/paid actions, and final
production publication/cutover.

## Candidate disposition

No Q1-D product defect remains in the automated scope. This receipt recommends
`Q1D_READY_FOR_ARCHITECT_ACCEPTANCE`; it is not self-acceptance. The next
independent Stream-1 task, after architect review and the separately pending
email infrastructure actions, is Q1-C owner/live testing.
