# Scoped maintenance access

Purpose: permit an owner-authorized controller to perform maintenance without using,
exporting or periodically recreating a human portal/admin session.

Status: source implementation. This document is not a deployment or credential
issuance receipt. No live grant is created by migration, application startup,
configuration changes or a test.

## Authority

An existing, unexpired human ADMIN_OWNER session and valid CSRF are required to
issue, list or revoke a grant. Issuance rechecks the session, its portal session,
active user, owner role and principal inside a database transaction. An ordinary
portal session, expired admin session, machine token or previously denied
elevation cannot issue a grant. Existing 15-minute elevation and 30-minute human
session rules are unchanged.

A grant delegates an explicit subset of compatibility, AI registry/profile/
assignment maintenance and health-read permissions. It does not delegate owner,
user, account, billing, principal management or further grant issuance. Machine
requests carry an explicit bearer credential; mixed admin cookies and bearer
credentials are rejected. Cookie authentication retains CSRF enforcement.

Each authentication and rotation checks the grant's revocation and expiry, active
user/principal, retained OWNER role and the issuing principal revision. Revoking
a grant or changing the issuer authority denies subsequent requests. Requests
already accepted before revocation may finish; this is not cancellation of an
in-flight mutation.

The issuing human session is provenance, not the lifetime of the independent
grant. Its ordinary expiry/logout does not log out the maintenance client.
The owner can explicitly revoke the grant. No administrative permission is
inferred from merely possessing a portal session.

## Rotation and recovery

The credential has a 30-day lease. The client renews it before work once 24 hours
have elapsed, storing only a private local credential file. No daemon, cron job
or additional executor is installed. After 30 days without a renewal the
credential expires; neither client nor server can resurrect it.

The server stores SHA-256 credential hashes. Rotation locks the grant and issuer,
atomically replaces the current hash, and retains one predecessor plus its
nonce hash for two minutes of idempotent response recovery. Reusing the old
credential with another nonce or outside that window does not rotate it.

The client writes its nonce durably before sending rotation and atomically saves
the confirmed replacement before sending a maintenance operation. Following an
unknown rotation outcome it can compute the one expected replacement from its
own saved credential/nonce and perform an ordinary authenticated readback.
It adopts that replacement only if the server authenticates it with the expected
machine role/permission boundary and a future expiry. An uncommitted, expired
or revoked replacement does not authenticate. No authority is generated locally.

An administrative mutation is sent once. Unknown outcomes require an independent
readback of the intended resource before any retry. The client never converts
an authentication failure into a new human login attempt.

## Surfaces

- Human owner: GET/POST /v1/admin/maintenance-grants and
  DELETE /v1/admin/maintenance-grants/:id.
- Machine rotation: POST /v1/admin/maintenance-credential/rotate.
- Machine readback: existing GET /v1/admin/me.
- Admin app: /service-access, to create/download one credential or revoke grants.
  The existing admin app deployment and its externally mounted base path must
  actually be available; source routes do not prove public routing works.
- Client: tooling/server/maintenance-client.py, using --credential-file,
  --method, --path and optional --body-file. Credential material is never passed
  in command arguments or printed by the client.

The downloadable credential is delivered once and must be installed in a private
file owned by the controller, mode 0600, in an owner-controlled directory.
The file contains an origin, version, token, expiry and rotation timestamp.
The current client pins https://api.octoport.ru, refuses redirects and does not
send a token to an arbitrary supplied origin. The UI obtains the API origin from
validated server configuration and does not infer it from the browser's URL.

## Deployment and verification

Migration 0057 is additive. It creates an empty grants table and changes no
existing identities, roles, sessions or credentials. Old application code can
continue operating against the migrated schema. Rolling application code back
disables machine authentication; retain grant/audit data for controlled cleanup.

Required checks cover original human authentication, rejection of unauthorized/
CSRF-free issuance, scope isolation, actual PostgreSQL issuance/rotation/revocation,
concurrent same-nonce rotation, a lost rotation response, no mutation replay,
private file storage and denied redirects. Independent review and normal release
checks remain necessary before deployment. A real activation receipt must identify
the separately authorized grant, exact deployed source and successful bounded
operation without recording its secret.

No technical OTP, browser cookie export, auth flag override, root-environment
credential extraction or bypass of an earlier tool/platform denial is part of
this implementation.

### Existing admin application mount

The existing admin app uses the established same-origin production path `/admin`.
Build and start it with `NEXT_PUBLIC_ADMIN_BASE_PATH=/admin`; the default empty path remains
for the existing local/CI server. Next navigation, assets and browser BFF requests
must use the same compiled prefix. The service-access page is rendered dynamically
so the validated API origin comes from the running service, not a stale build.

The supplied admin systemd template binds only loopback port 3101, runs as a
dynamic unprivileged user, and requires a readable immutable release outside
`/root`. Replace `@RELEASE_DIR@` with that exact verified release directory. It
contains no credential or automatic grant and makes no database changes.
The dedicated `/admin/` nginx location preserves the prefix; the existing portal
and public API locations retain their upstreams. Start and verify the admin
service before applying this ingress change. `/admin/login` must return 200,
assets must load under `/admin/_next/`, and an unauthenticated BFF request must
still receive the backend denial. First key issuance remains the normal human
owner action described above. These source templates are not an installation
or initial-key receipt.
