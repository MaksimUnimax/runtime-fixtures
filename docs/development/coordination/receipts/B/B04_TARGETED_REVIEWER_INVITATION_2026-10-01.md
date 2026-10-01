# B04 targeted reviewer invitation — 2026-10-01

Status: **SOURCE + DISPOSABLE_POSTGRESQL PASS / INDEPENDENT REVIEW PENDING / NO LIVE PROVISIONING OR DEPLOYMENT**.

Task: `B04-TARGETED-REVIEWER-INVITATION`.

## Result

The CLOSED-beta reviewer prerequisite now has a bounded product path instead of
requiring SQL provisioning, owner substitution, or opening global registration.

An authorized beta operator may create one targeted invitation for a normalized
email identity while beta remains `CLOSED`. Creating the invitation:

- requires ordinary authenticated admin mutation authority
  `beta.admission.manage` and CSRF;
- reserves one beta-capacity slot for 24 hours;
- creates no user, account, membership, email identity, beta admission,
  portal session, OTP challenge, or extension device;
- stores the normalized target only in the invitation authority table while
  audit metadata contains only a one-way identity hash and request metadata;
- is request/payload-idempotent and fail-closed on a reused request ID with a
  different payload;
- conflicts with an already-existing email identity or another active
  invitation for the same target.

Ordinary OTP request/delivery/verification remains the proof of email
ownership. No OTP bypass or operator verification primitive was introduced.

## Atomic first-login redemption

The existing OTP verification transaction now permits a missing identity under
`CLOSED` only when one matching invitation is active, unexpired and
non-revoked. `PAUSED` remains closed even when an invitation exists.

A successful invited first login, under the existing normalized-email advisory
lock and beta-state transaction lock, atomically:

1. creates exactly one user;
2. creates exactly one account and OWNER membership;
3. creates the verified EMAIL identity;
4. creates exactly one beta admission and increments `admitted` once;
5. consumes the invitation and binds it to the created user;
6. creates the ordinary portal session and OTP replay record.

The pre-existing OTP challenge/idempotency behavior is retained. A consumed
invitation cannot be revoked.

## Capacity and concurrency

Pending, unexpired invitations are beta-capacity reservations.

- invitation creation requires `admitted + pending < capacity`;
- `SET_CAPACITY` cannot reduce capacity below admitted plus active
  reservations;
- OPEN first-time registration cannot consume a slot reserved by a targeted
  invitation;
- revoke or expiry releases a reservation;
- concurrent last-slot invitation creation yields one applied reservation and
  one capacity failure;
- revoke request IDs are globally payload-bound: replay of the same revoke is
  idempotent, while reusing that request ID for another invitation returns a
  conflict instead of surfacing a database uniqueness error.

## Admin API

New safe admin surfaces:

- `GET /v1/admin/beta/invitations/:invitation_id` —
  `beta.admission.read`;
- `POST /v1/admin/beta/invitations` —
  CSRF-protected `beta.admission.manage`;
- `POST /v1/admin/beta/invitations/:invitation_id/revoke` —
  CSRF-protected `beta.admission.manage`.

Responses contain invitation ID/status/timestamps only and do not echo the
target email. The OpenAPI artifact is generated from the route schemas.

## Persistence

Migration `0056_beta_targeted_identity_invitations.sql` adds the invitation
authority table, terminal-state constraints, admin/user foreign keys and
indexes. The canonical Drizzle journal registers 0056 immediately after 0055;
prior migration entries are unchanged.

The first disposable check exposed that an unregistered SQL file is invisible
to Drizzle. That source-registration defect was fixed before acceptance. A
direct parallel-file Vitest invocation also demonstrated why the repository's
canonical integration config uses `fileParallelism:false`; the accepted run
uses that canonical config.

## Verification

Focused SOURCE checks:

- beta-access service unit tests: **3/3 PASS**;
- beta admin route unit tests: **11/11 PASS**;
- combined focused unit total: **14/14 PASS**;
- beta-access, DB and API TypeScript typechecks: PASS;
- focused ESLint: PASS;
- focused Prettier: PASS;
- OpenAPI generation/check: PASS;
- `git diff --check`: PASS.

Final disposable PostgreSQL acceptance used the canonical sequential
integration config through the B resource supervisor:

- P2 auth integration: **18/18 PASS**;
- S1.1 beta admission integration: **18/18 PASS**;
- total: **36/36 PASS**;
- resource unit:
  `octoport-test-b-5f3d236462f54b7ebc2094cbe080993f.service`;
- exit code: 0;
- peak memory: about 410 MiB;
- cleanup: verified.

The matrix covers CLOSED invited success, CLOSED uninvited zero-partial denial,
PAUSED denial, expiry/revoke, consumed-invitation terminal behavior, OTP replay,
reservation versus OPEN registration, reservation-aware capacity mutation,
concurrent last-slot reservation, existing-identity conflict, revoke replay
and cross-invitation revoke-request conflict.

## Evidence boundary

This is SOURCE + DISPOSABLE_POSTGRESQL evidence only.

It does **not**:

- create a live reviewer invitation;
- send a new OTP or claim a human entered one;
- create a live reviewer account/device;
- change live beta mode/capacity/admission state;
- mutate a live database or catalog;
- call ChatGPT, a marketplace, Telegram, or a browser store;
- submit or publish an extension;
- deploy services or claim production readiness.

A real reviewer still has to receive and complete the ordinary human
OTP/device flow under a separately authorized live operation. Store
submission/moderation and LIVE_OWNER useful-flow acceptance remain separate
gates.
