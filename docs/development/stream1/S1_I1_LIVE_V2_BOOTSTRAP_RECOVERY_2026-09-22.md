# Stream 1 — I1 live V2 bootstrap recovery authority

Status: **ARCHITECTURE / EXECUTION AUTHORITY**

Date: 2026-09-22

## Accepted live facts

Work ID: `S1_I1_LIVE_V2_BOOTSTRAP_REFRESH_REVOKE_2026-09-22_R1`.

- Old device revoke: PASS.
- Fresh device authorization: PASS.
- Owner approval: PASS.
- Device exchange: PASS.
- Access token issued: YES.
- Refresh token issued: YES.
- Bootstrap returned `503 BOOTSTRAP_UNAVAILABLE`.
- Production evidence: no `control_plane_v2` config release was available.
- The test also used extension version `1.2.3`, for which no production extension release exists.
- Final device revoke: PASS.
- Final active device/session count: 0.
- No credentials were persisted.

## Architect correction

The synthetic test version `1.2.3` MUST NOT be published into production compatibility data merely to make the acceptance pass.

The accepted owner Chromium package version for the current beta line is `0.2.4`. Future live I1 requests must use the actual accepted package version, not an invented version.

The `503 BOOTSTRAP_UNAVAILABLE` boundary is caused by missing V2 config authority, not by missing extension-release metadata alone. The bootstrap resolver can still produce a signed snapshot with compatibility statuses such as `UPDATE_REQUIRED` when a release is absent; therefore a fake release row is forbidden.

## Required production correction

Create a real `control_plane_v2` config release using the existing accepted publication path:

- `contractVersion = control_plane_v2`;
- `snapshotVersion = bootstrap_snapshot_v2`;
- `envelopeVersion = bootstrap_envelope_v2`;
- current ACTIVE production signing key;
- only valid V2 compatibility-policy / feature-rule sources that actually exist;
- no `bootstrap.config` V1 rollout linkage for V2.

Use the existing `createP3PolicyPublicationRepository(...).publishConfigRelease(...)` path so publication validation and audit remain authoritative.

Do not insert `config_releases` directly.

## Extension release rule

Before changing `extension_releases`:

1. read the actual current release record for the accepted owner package;
2. verify whether that exact shipped package supports `control_plane_v2`;
3. only publish or amend release metadata when that support is actually proven by the package/runtime.

Never publish a synthetic `1.2.3` release.

For the immediate server-side I1 signed-bootstrap gate, absence of a matching extension release is not by itself a reason to fabricate one. Record the returned compatibility status truthfully.

## Live rerun

After a valid V2 config release exists:

1. create one fresh device authorization using the actual accepted extension version;
2. owner approves;
3. exchange credentials;
4. call `POST /v1/bootstrap` with `control_plane_v2`;
5. require cryptographic V2 envelope verification;
6. perform one refresh;
7. owner revokes device;
8. verify old access and refresh credentials are invalid after revoke;
9. end with zero active test devices/sessions.

## Acceptance

I1 is not accepted until the rerun proves:

- device exchange PASS;
- V2 Bootstrap HTTP PASS;
- V2 signature verification PASS;
- refresh PASS;
- final revoke PASS;
- post-revoke access invalid;
- post-revoke refresh invalid;
- no secrets persisted.

## Root cause established — PREPROD_R1 trust-catalog repair wrote the malformed event

The provenance is no longer unknown.

The malformed persisted signing-key event came from the Stream-1 preprod deployment repair recorded in:

`docs/development/preprod/PREPROD_CURRENT_LINE_DEPLOYMENT_2026-09-21.md`

Work ID:

`PREPROD_R1_20260921_CURRENT_CONSOLIDATED_LINE_DEPLOYMENT`

During that deployment the clean-line API failed closed with:

`bootstrap signing key metadata binding is invalid`

Read-only inspection found that `public.signing_keys` and `public.signing_key_events` were empty while the configured preprod signing key already existed in the server secret environment and metadata file.

The first repair wrapper failed because of a quoted environment value. Its invalid row was captured and the exact predeploy backup was restored.

A second strict Node 24 one-off trust-catalog repair then inserted:

- the correct 44-byte public SPKI;
- `REGISTERED` and `ACTIVATED` signing-key events;
- matching safe `SYSTEM` audit records.

The production row later observed with:

`reason_code = PREPROD_CATALOG_REPAIR`

belongs to that trust-catalog repair lineage. It was not created by the ordinary signing-key publication command path.

### Concrete defect

The repair path persisted an uppercase machine reason code that does not satisfy the current application grammar:

`^[a-z0-9][a-z0-9._-]*$`

The database column was only `varchar(64)` and had no lexical CHECK constraint, so the database accepted the value.

Normal current command validation would reject that uppercase value.

Therefore the defect is not “mysterious legacy data”. It is an **operator repair writer / persistence-contract defect introduced by our own PREPROD_R1 trust-catalog repair**.

### Required engineering response

Do not invent another production workaround.

Before changing runtime parsing or production data, inspect the exact PREPROD_R1 repair mechanism/evidence and reproduce the defect in a disposable database.

The correction must address the repair writer/persistence contract so the same class cannot recur, while preserving the historical audit trail.

No V2 config publication retry is permitted until that correction is accepted.


## Accepted architecture decision — signing-event persistence repair

The root cause is established: PREPROD_R1's one-off trust-catalog repair wrote an uppercase reason code directly into `signing_key_events`, bypassing the normal command schema. The database accepted it because `reason_code` had no lexical CHECK constraint. The event history is intentionally immutable, so rewriting or deleting that historical row is forbidden.

### Three-level dependency chain

#### LEVEL 1 — persisted signing-key event contract

Required behavior:

- historical persisted events must remain readable without rewriting immutable history;
- new reason-code writes must obey the canonical lowercase machine-identifier grammar;
- the exact known historical value `PREPROD_CATALOG_REPAIR` must be represented explicitly as historical persistence compatibility, not accepted as a new command value;
- PostgreSQL must enforce the lowercase grammar for all future rows.

Why this is not a hack:

- authority: the persisted event log is append-only audit/state history;
- ownership: parsing persisted history and enforcing future persistence belong to the event persistence contract;
- avoided workaround: no UPDATE/DELETE of the historical row, no direct SQL normalization, no blanket case-insensitive parser;
- hack boundary not crossed: only the proven historical literal is admitted on read, while future writes are made stricter at both application and DB layers.

Implementation consequence:

- keep `SigningKeyReasonCommandSchema.reasonCode = StableMachineIdentifierV1Schema`;
- introduce a persisted-event reason-code schema that accepts current lowercase identifiers plus the exact historical literal `PREPROD_CATALOG_REPAIR`;
- add a forward migration with a `NOT VALID` CHECK constraint so existing history is preserved but every future insert/update must satisfy the lowercase grammar;
- do not validate the old violating row through the new DB constraint.

#### LEVEL 2 — signing-key lifecycle and trust-catalog publication

Required behavior:

- lifecycle resolution, config publication, and runtime Bootstrap signing must consume the same canonical event-history reader;
- future trust-catalog bootstrap/repair must use the domain publication repository, never ad-hoc SQL inserts.

Why this is not a hack:

- authority: `resolveSigningKeyLifecycle`, `createP3PolicyPublicationRepository`, and `createConfigSigningService` define one lifecycle authority;
- ownership: the trust-catalog subsystem owns key registration/activation and audit;
- avoided workaround: no special bypass in only the V2 publication harness and no special bypass only in Bootstrap signing;
- hack boundary not crossed: the same event history is parsed and validated identically for publication and runtime signing.

Implementation consequence:

- add an official bounded trust-catalog bootstrap/reconciliation tool for the empty-catalog case that calls `registerSigningKey` and `activateSigningKey` through `createP3PolicyPublicationRepository`;
- the tool must refuse non-empty/conflicting catalog state;
- it must never write `signing_key_events` directly.

#### LEVEL 3 — signed Bootstrap trust authority

Required behavior:

- `control_plane_v2` Bootstrap may be signed only by a configured key whose public metadata matches and whose lifecycle resolves ACTIVE;
- historical operator metadata must not invalidate an otherwise valid cryptographic lifecycle;
- no signature verification, key binding, or lifecycle check may be bypassed.

Why this is not a hack:

- authority: the signed Bootstrap trust model is the product-level security invariant;
- ownership: the API signer and remote-config resolver remain the sole authority;
- avoided workaround: no fake V2 config row, fake extension release, unsigned Bootstrap, or acceptance of HTTP 200 without Ed25519 verification;
- hack boundary not crossed: all cryptographic checks stay intact; the repair only restores the persistence contract required to evaluate the real lifecycle.

### Required implementation sequence

1. Reproduce the PREPROD_R1 malformed-reason scenario in a disposable PostgreSQL database.
2. Implement historical persisted-read compatibility for the exact proven literal only.
3. Add the forward DB CHECK `NOT VALID` constraint for future lowercase reason codes.
4. Add the canonical trust-catalog bootstrap/reconciliation tool using the existing publication repository.
5. Prove direct invalid future inserts are rejected by PostgreSQL.
6. Prove current command schema still rejects uppercase reason codes.
7. Prove the historical event remains byte-for-byte unchanged.
8. Run full affected regression.
9. Deploy the corrected API.
10. Publish the first V2 config through `publishConfigRelease`.
11. Run fresh device → signed V2 Bootstrap → refresh → revoke/invalidation live acceptance.

No other repair is authorized.
