# B06 beta invitation retention classification — 2026-10-04

Status: **SOURCE/POLICY CLASSIFICATION — IMPLEMENTATION GAP CONFIRMED / RETENTION DURATION NOT AUTHORIZED / NO PURGE OR LIVE MUTATION**.

Task: `B06-BETA-INVITATION-RETENTION-CLASSIFICATION-20261004`.

## Exact input

Fresh remote base at classification start:

- `origin/main = 350533044b417a12d52a273071fa61131d2765d7`;
- product version on the current release line: `0.2.12`;
- this result is evidence-only and does not change invitation, database, service, privacy-policy or production behavior.

Exact current-main source blobs used:

| Path | Git blob |
|---|---|
| `packages/server/beta-access/src/index.ts` | `69c9cae1a75dd67cc7f2b27aff4fd98284ac9989` |
| `packages/server/db/src/beta-admission-repository.ts` | `ed1d8ce9511dc62c705c5eb32ab26d0dec1b427e` |
| `packages/server/db/drizzle/0056_beta_targeted_identity_invitations.sql` | `5f1593cbe21b609ba838a3a2766ed7f727c3aeca` |
| `apps/api/src/beta-admin-routes.ts` | `89e55cdc8549a93c36b8f06e848c4490212b6fea` |
| `docs/architecture/DATA_AND_SECURITY.md` | `adf749cf98f5417dc966a51c9ab811d107d3a096` |
| `docs/server/DATA_MODEL.md` | `8d35ac51adf925557d35d2d1ededd6fb1b607050` |
| `docs/development/coordination/PLAN.md` | `ed21441c75792ae8db9ea8fa31f7ae1e3a3fe1ae` |
| `docs/product/SPEC.md` | `9b0c3db83c5c75e71fb59cb803757a94936f88be` |
| `docs/product/readiness/MINIMUM_SPEC.md` | `3c3be30ef3dcb54b50df2ceef0773177743e39a7` |
| `docs/development/coordination/receipts/B/B04_TARGETED_REVIEWER_INVITATION_2026-10-01.md` | `d9798d087ba436c9a75635ea1b293f01177a097a` |

## What is already implemented

The targeted CLOSED-beta invitation path is already a bounded, reviewed authorization mechanism. This task does not reopen B04.

Current behavior establishes:

1. `BETA_IDENTITY_INVITATION_TTL_MS = 24 * 60 * 60_000`: a newly created invitation is valid for 24 hours.
2. A pending, unexpired invitation reserves beta capacity. Expiry or revocation releases that reservation.
3. The API exposes safe invitation status/timestamps and does not echo the target email.
4. Create and revoke mutations require the existing admin permissions/CSRF boundary.
5. Successful first login consumes the invitation transactionally; a consumed invitation is terminal and cannot be revoked.
6. Revocation stores a terminal revoke state. Expiry is derived from `expires_at`; it does not rewrite the row to an EXPIRED state.
7. Existing B04 evidence already covers idempotency, concurrency, capacity, expiry after lock wait, revoke/consume terminal behavior and audit-email redaction.

Those facts concern **authorization validity and state transitions**. They do not define how long the authority row may remain physically stored after it becomes expired, revoked or consumed.

## Retention is not the 24-hour invitation TTL

The 24-hour value is an access/capacity validity window. It answers:

> “Until when may this invitation authorize the invited first login and reserve a beta slot?”

It does **not** answer:

> “When must the stored invitation authority row be deleted or anonymized?”

The current repository keeps those concepts separate elsewhere too: `DATA_MODEL.md` states that expiry/retention cleanup is a separate bounded authorized operation rather than an arbitrary early deletion.

Therefore using `24h` as a database-row purge deadline would be a new privacy/security policy, not an implementation of an existing one.

## Persistent data in the invitation authority row

Migration 0056 stores, per invitation:

- invitation UUID;
- the normalized target identity (email), up to 320 characters;
- HMAC/one-way request and payload identities used for idempotency;
- creator admin principal reference;
- creation and expiry timestamps;
- optional consumed timestamp and user reference;
- optional revoke timestamp, revoking admin reference and revoke request/payload identities.

The normalized target identity is the privacy-sensitive field that makes an undefined retention window material. B04 deliberately removed target-email derivatives from audit metadata because email identities are guessable, but the invitation table itself necessarily contains the normalized target while the invitation is active.

The table also has `ON DELETE restrict` foreign keys to admin principals and the consumed user. Any future cleanup must therefore be designed together with the intended historical/audit semantics; deleting or anonymizing rows cannot be assumed equivalent.

## Current deletion/GC behavior

Bounded current-main inspection found **no accepted deletion/GC path for `beta_identity_invitations`**.

Specifically:

- `activeInvitationCount()` excludes consumed, revoked and expired rows from active capacity accounting;
- invitation lookup may still read a terminal row and derive `CONSUMED`, `REVOKED` or `EXPIRED`;
- revoke updates the row rather than deleting it;
- first-login redemption consumes the row rather than deleting it;
- migration 0056 defines indexes/constraints/FKs but no retention operation;
- bounded repository search for deletion of `beta_identity_invitations` found no `DELETE FROM beta_identity_invitations` implementation.

So the technical state is:

**authorization expiry works; terminal-row retention cleanup is not implemented.**

This is an implementation gap under PLAN B06, but it is not safe to fix until its policy input exists.

## Why existing 90-day numbers cannot be reused

Two current policies have explicit 90-day values, but neither authorizes invitation-row retention:

- administrative audit: 90-day technical-beta default, explicitly category-scoped and not a blanket TTL for all `audit_events` or state-transition history;
- support/feedback: its own accepted closed-case/aggregate retention rules.

`DATA_MODEL.md` separately says account/user retention policy is still to be finalized before production and that production durations remain a separate decision. It also explicitly says the existing audit default does not authorize an immediate live or historical purge.

A beta invitation is an identity-admission authority containing a normalized login target. It must not silently inherit either support retention or administrative-audit retention.

## Missing policy authority

Before source implementation of invitation cleanup, Octoport needs one explicit product/privacy retention decision covering at least:

1. retention duration or deletion/anonymization trigger for **EXPIRED** invitations;
2. retention duration or deletion/anonymization trigger for **REVOKED** invitations;
3. retention duration or deletion/anonymization trigger for **CONSUMED** invitations;
4. whether a consumed row must retain its user/admin references for a defined security/audit window or whether the normalized target may be anonymized earlier;
5. what minimal non-identifying idempotency/security evidence, if any, must survive row cleanup;
6. interaction with the separate 90-day administrative audit record;
7. backup lifecycle expectations after primary-database cleanup.

This receipt does not choose those values. Choosing them here would be an unauthorized privacy-policy change.

## Smallest future implementation boundary after policy exists

Once the retention decision is explicit, the smallest safe implementation should be a separate B06 task with exact scope, not an ad-hoc SQL command.

Expected boundary:

- a versioned retention policy/config input for this category;
- a repository operation selecting **only terminal rows older than the authorized cutoff**;
- bounded batch size and deterministic ordering;
- protection against deleting PENDING/unexpired invitations;
- explicit treatment of consumed/revoked/expired states according to the approved policy;
- safe counts/audit metadata without target email;
- race tests against invitation creation, revoke and first-login consumption;
- disposable PostgreSQL tests for exact-cutoff and batch boundaries;
- backup/restore compatibility for any schema change, if a schema change is actually needed;
- independent review and normal publication gates before any live use.

A migration is **not automatically required**: the existing schema already has the relevant timestamps and expiry index. Whether deletion, anonymization or additional metadata is correct depends on the missing policy, so schema work must not be preselected.

## What this task does not do

This result does not:

- delete or anonymize any invitation;
- add a retention duration;
- modify migration 0056;
- change API or admin UI behavior;
- alter beta capacity, invitation TTL, OTP or admission semantics;
- mutate a database, service, provider, browser or GitHub setting;
- treat 90 days, 24 hours or any other existing duration as invitation-row retention authority;
- claim B06 retention complete.

## B06 disposition

For the PLAN B06 criterion “revocation и сроки хранения”:

- **revocation behavior:** existing targeted-invitation revoke boundary is implemented and previously accepted at SOURCE + disposable PostgreSQL level;
- **invitation validity/expiry:** implemented as a 24-hour authorization/capacity window;
- **terminal-row retention:** **OPEN_POLICY_DEPENDENCY + IMPLEMENTATION_NOT_PRESENT**;
- **safe next action:** obtain the explicit invitation-retention policy decision above; only then create a source implementation task.

This classification prevents two unsafe shortcuts: deleting terminal identity authority too early, and keeping privacy-sensitive normalized targets indefinitely while pretending that authorization expiry is retention.

## Resource/evidence boundary

Parent task declared `NO_TEMPORARY_OUTPUTS`: existing repository/source/evidence was read; no dependency install, browser, DB, volume or temporary task worktree was created for the classification itself.

Independent `gpt-6-luna` review is required before this classification can be accepted or used to create the downstream retention implementation task.
