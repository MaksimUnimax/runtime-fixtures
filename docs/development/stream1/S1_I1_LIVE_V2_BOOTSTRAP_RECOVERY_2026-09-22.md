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
