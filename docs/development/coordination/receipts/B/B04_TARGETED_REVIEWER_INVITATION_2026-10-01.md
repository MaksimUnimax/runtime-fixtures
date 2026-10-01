# B04 targeted reviewer invitation — 2026-10-01

Status: **SOURCE + DISPOSABLE_POSTGRESQL PASS / R1+R2 REVIEW REWORK FIXED / FINAL EXACT-CANDIDATE REVIEW REQUIRED BEFORE PUBLICATION / NO LIVE PROVISIONING OR DEPLOYMENT**.

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
- stores the normalized target only in the invitation authority table;
- writes no raw or directly guessable derivative of the target email to audit
  metadata; operator-supplied invitation audit reasons redact email-shaped text;
- is request/payload-idempotent and fail-closed on a reused request ID with a
  different payload or target;
- conflicts with an already-existing email identity or another active
  invitation for the same target.

Ordinary OTP request/delivery/verification remains the proof of email
ownership. No OTP bypass or operator verification primitive was introduced.

## Atomic first-login redemption

The existing OTP verification transaction now permits a missing identity under
`CLOSED` only when one matching invitation is active, unexpired and
non-revoked. `PAUSED` remains closed even when an invitation exists.

Invitation expiry is checked with PostgreSQL `clock_timestamp()` **after**
the identity advisory lock and beta-state lock are acquired. This is
intentional: PostgreSQL `now()` is transaction-start time and would permit a
credential that expired while waiting on those locks.

A successful invited first login atomically:

1. creates exactly one user;
2. creates exactly one account and OWNER membership;
3. creates the verified EMAIL identity;
4. creates exactly one beta admission and increments `admitted` once;
5. consumes the invitation and binds it to the created user;
6. creates the ordinary portal session and OTP replay record.

The pre-existing OTP challenge/idempotency behavior is retained. A consumed
invitation cannot be revoked.

## Capacity, replay and concurrency

Pending, unexpired invitations are beta-capacity reservations.

- invitation creation requires `admitted + pending < capacity`;
- `SET_CAPACITY` cannot reduce capacity below admitted plus active
  reservations;
- OPEN first-time registration cannot consume a slot reserved by a targeted
  invitation;
- revoke or expiry releases a reservation;
- concurrent last-slot invitation creation yields one applied reservation and
  one capacity failure;
- create request IDs are checked again while the shared beta-state lock is
  held, so concurrent cross-email reuse deterministically yields one applied
  invitation and one conflict instead of a uniqueness/503 leak;
- revoke request IDs are globally payload-bound: replay of the same revoke is
  idempotent, while reusing that request ID for another invitation returns a
  conflict instead of surfacing a database uniqueness error.

The lock order for first-time invitation-related mutations is normalized
identity advisory lock -> beta-state row lock -> invitation row/request binding,
with OTP redemption following the same identity -> state -> invitation order.

## Admin API

New safe admin surfaces:

- `GET /v1/admin/beta/invitations/:invitation_id` —
  `beta.admission.read`;
- `POST /v1/admin/beta/invitations` —
  CSRF-protected `beta.admission.manage`;
- `POST /v1/admin/beta/invitations/:invitation_id/revoke` —
  CSRF-protected `beta.admission.manage`.

Responses contain invitation ID/status/timestamps only and do not echo the
target email. Route tests cover role boundaries, CSRF, safe response shape and
404 mapping. The OpenAPI artifact is generated from the route schemas.

## Persistence and release binding

Migration `0056_beta_targeted_identity_invitations.sql` adds the invitation
authority table, terminal-state constraints, admin/user foreign keys and
indexes. The canonical Drizzle journal registers 0056 immediately after 0055;
prior migration entries are unchanged.

The first disposable check exposed that an unregistered SQL file is invisible
to Drizzle. The journal entry was added as the narrow
`B04-TARGETED-REVIEWER-MIGRATION-JOURNAL` dependency.

Adding migration 0056 also advances the current repository release migration
level from 55 to 56. The Coordination CI release-safety test initially caught
its stale expected value; the exact release-safety assertion was updated to 56
without changing release logic, package identity, product version or contract
version. Release-safety then passed **42/42**.

## Independent review R1 and corrections

Read-only `gpt-6-luna` review of candidate
`7a26bb5be9ede3fca4e7e7a88388e9fd11dc63c3` returned REWORK_REQUIRED with
three Medium findings:

1. email-shaped text could enter audit through operator `reason`;
2. concurrent cross-target create request-ID reuse could race to the database
   unique constraint;
3. invitation expiry used a stale transaction/application timestamp after a
   lock wait.

All three were corrected in source and each failure sequence has a dedicated
PostgreSQL regression.

R2 review found one remaining Medium privacy gap: the first audit-redaction
pattern covered only ASCII-style addresses, while ordinary email normalization
also accepts Unicode domains. The invitation audit redaction now conservatively
matches the same non-whitespace `local@domain.suffix` shape regardless of
Unicode code points, and the PostgreSQL regression includes
`reviewer@bücher.example`.

R3 review found one further Medium privacy gap: audit metadata still stored an
unkeyed SHA-256 derivative of the normalized invitee email. Because email
addresses are guessable, that digest could be reversed by offline candidate
testing. The create audit now omits any target-email derivative entirely;
invitation ID remains the audit correlation key. PostgreSQL regression asserts
that invitation audit metadata contains no `identityHash` field.

R1, R2 and R3 are rework evidence. R4 independently reviewed exact
`74de0463ea2a357a7c5ad4d127bc2b66a1dedd4a` after those source/privacy
corrections and returned PASS with no High/Medium finding.

The first exact-head Server CI then exposed two stale API surface-contract
expectations only: the canonical method tuple count still expected 142 instead
of 145, and the OpenAPI expected-path inventory omitted the three new invitation
routes. Runtime route code, invitation semantics and generated OpenAPI were
already correct. The companion task
`B04-TARGETED-REVIEWER-API-SURFACE-TESTS` updates only those two test
inventories. Final publication still requires a fresh independent review and
five CI workflows on the exact corrected candidate.

## Verification

Focused SOURCE checks:

- beta-access service unit tests: **3/3 PASS**;
- beta admin route unit tests: **11/11 PASS**;
- combined focused unit total: **14/14 PASS**;
- beta-access, DB and API TypeScript typechecks: PASS;
- focused ESLint: PASS;
- focused Prettier: PASS;
- OpenAPI generation/check: PASS;
- documentation check: PASS;
- release-safety node tests: **42/42 PASS**;
- `git diff --check`: PASS;
- companion API surface tests after the Server-CI diagnosis:
  `admin-ops-routes.test.ts` + `openapi.test.ts`: **30/30 PASS**;
- full root `pnpm test` after the companion correction: **PASS**, including
  `apps/api` **284/284 PASS** and `bridge:guard` PASS;
- full-unit resource unit:
  `octoport-test-b-38d666d16567458092cbdcaae9289e7e.service`, exit 0,
  peak about 3017 MiB, cleanup verified.

Final disposable PostgreSQL acceptance uses the canonical sequential
integration config through the B resource supervisor:

- P2 auth integration: **19/19 PASS**;
- S1.1 beta admission integration: **20/20 PASS**;
- total: **39/39 PASS**;
- resource unit:
  `octoport-test-b-71f5cb2ceef1452c8396e054a5c99873.service`;
- exact runner: Vitest with `--no-file-parallelism --maxWorkers=1` so the two
  integration files cannot reset the same disposable DB concurrently;
- exit code: 0;
- peak memory: about 423 MiB;
- OOM kills: 0;
- cleanup: verified.

One preceding combined Vitest attempt used the default file-parallel mode and
was rejected as invalid evidence after the two test files concurrently reset the
same disposable database, causing cross-file TRUNCATE/deadlock/state
interference. The corrected sequential resource run above is the acceptance
evidence.

The matrix covers CLOSED invited success, CLOSED uninvited zero-partial denial,
PAUSED denial, expiry/revoke, expiry **after waiting on the identity lock**,
consumed-invitation terminal behavior, OTP replay, reservation versus OPEN
registration, reservation-aware capacity mutation, concurrent last-slot
reservation, existing-identity conflict, create request-ID cross-target race,
revoke replay/cross-target conflict, and ASCII + Unicode-domain audit email
redaction.

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
