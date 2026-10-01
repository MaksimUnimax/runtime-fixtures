# B04 STORE1 targeted-invite guidance — 2026-10-01

Status: **SOURCE CANDIDATE / NO LIVE INVITATION OR STORE MUTATION**.

Task: `B04-STORE1-TARGETED-INVITE-GUIDANCE`.

## Defect

After targeted reviewer invitation was published in common main at
`8ca5c14727c6ec137d45312c5094934d62e74929`, the STORE1 reviewer preflight
still returned the historical diagnostic that CLOSED beta had no targeted
invite primitive.

That was factually stale and could mislead an operator toward thinking the
only alternatives were opening general registration or unsupported direct
provisioning.

## Correction

The existing backward-compatible blocker code
`STORE1_REVIEWER_IDENTITY_PREEXISTING_REQUIRED` is retained.

Only its operator guidance changes. When the dedicated reviewer identity is
missing, the blocker now states that:

- an authenticated, CSRF-protected targeted invitation is available through
  `POST /v1/admin/beta/invitations` while beta remains CLOSED;
- invitation alone creates no identity, account, session, device or reviewer
  bearer;
- the intended reviewer must still complete the ordinary OTP first-login before
  STORE1 preflight can continue;
- invitation is a separate authorized live operation using current beta
  revision/readback, not an automatic planner POST;
- opening global registration, owner substitution, fabricated
  admission/device credentials and SQL/direct-DB provisioning remain forbidden.

The STORE1 planner therefore remains fail-closed and mutation-free in the
missing-reviewer state.

## Boundary

This source change does not create or revoke an invitation, request/send/verify
OTP, create a user/account/session/device, mutate beta state/catalog, call a
provider/marketplace/store, deploy services, or claim LIVE_OWNER/store
acceptance.
