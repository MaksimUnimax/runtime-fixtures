# B04 STORE1 lazy reviewer-device preflight — 2026-10-01

Status: **SOURCE PASS / REVIEW PENDING / NO LIVE OR CATALOG MUTATION**.

Task: `B04-STORE1-LAZY-REVIEWER-DEVICE-PREFLIGHT`.

## Defect

Published main `694f5c5b` correctly deferred opening the reviewer bearer until
admin-only reviewer prerequisites pass. The operator input validator still
required a syntactically valid reviewer `deviceId` and `browserVersion`
before those admin GETs.

That left a residual circular prerequisite: if the dedicated reviewer/device
does not exist yet, an operator still had to fabricate device metadata just to
learn the precise existing reviewer/account/admission blocker.

## Correction

The preflight input is now split by authority stage.

Required before any remote read:

- exact package manifest path;
- exact package path;
- reviewer email lookup key;
- protected admin-session file.

Deferred until reviewer prerequisites pass:

- reviewer device ID;
- reviewer browser version;
- protected reviewer bearer file.

The input remains strict: unknown keys are rejected. The deferred fields are
not trusted merely because they are present; after the admin-only reviewer
checks pass, all three are required and validated before any config/signature
or bootstrap operation.

Existing complete operator JSON remains accepted unchanged.

## Fail-closed behavior

With reviewer-device fields omitted entirely, admin-only GETs still return the
existing precise blockers for:

- missing reviewer identity;
- suspended reviewer;
- unverified queried reviewer email;
- missing ACTIVE reviewer account;
- ambiguous ACTIVE reviewer accounts;
- missing beta admission.

Those paths issue no bootstrap and no catalog mutation.

Once reviewer prerequisites pass, any missing or malformed deferred device
field fails with `STORE1_REVIEWER_INPUT_INVALID` before bootstrap. The
existing protected bearer file-mode/content validation remains unchanged after
that structural gate.

## Verification

Node `v24.20.0`.

- `tooling/server/store1-preflight-cli.test.ts`: **23/23 PASS**;
- focused ESLint: PASS with zero warnings;
- focused Prettier: PASS;
- `git diff --check`: PASS.

## Boundary

This does not create or admit a reviewer, open beta, invent a device, issue a
credential, bypass authentication, substitute the owner identity, mutate
catalog/database state, call a provider/marketplace, submit to a store, or
deploy services.

It only makes the already-supported read-only admin diagnosis genuinely
independent of reviewer-device material until that material is actually needed.
