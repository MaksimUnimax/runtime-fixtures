# B02 — 0.2.12 live catalog/admin gate reconciliation — 2026-10-03

Status: **SOURCE_CONTRACT_COMPATIBLE / LIVE_ADMIN_CATALOG_READBACK BLOCKED**

Evidence level: **SOURCE + READ-ONLY LIVE HTTP STATUS ONLY**.

This result does not authorize or claim live catalog/profile compatibility, authenticated Work, READY_FOR_OPERATOR, LIVE_OWNER, store submission, deployment, or production.

## Exact package/source identity

Exact branded Chromium STORE candidate:

- candidate: `OCTOPORT-0_2_12-CHROMIUM-44870cd7`;
- ZIP SHA256: `44870cd7260dd109168680d6aa17252fafef7e894c0d9b48a8ceff90b29265df`;
- source publication: `1616a88e35766a1d17055216d1348def50989b9f`;
- contract: `control_plane_v2`.

Packed runtime markers already read from the exact ZIP include `/v1/bootstrap`, `/v1/auth/refresh`, `/v1/sync`, and `control_plane_v2`.

Privacy-safe source compatibility evidence:
`/root/octoport-control/logs/B/a03-0212-chromium-current-backend-source-compatibility-preflight-20261003.json`

SHA256: `e7f4b0a1c19b679771ed68886593def0735d5b78d0ec3162c7b09c533c5b7b78`.

## Fresh-current-main source readback

Fresh inspected `origin/main`: `328d0cdc267e7e9ebc790a16f6a125949a6b0b76`.

`git diff 1616a88e..328d0cdc` across `apps/api`, `packages/server`, `packages/contracts`, `packages/control-client`, `apps/extension`, and `apps/health-runner` returned **zero changed paths**.

Exact representative blobs are identical between `1616a88e` and `328d0cdc`:

- `packages/control-client/src/config.js` → `7c0a8019703929bc201995ed9e38e7c1706a459b`;
- `packages/control-client/src/client.js` → `999db01fe0f7f48372ee46cdfbe3040ff68419fa`;
- `apps/api/src/bootstrap-routes.ts` → `5e5c8a92a75aa49f217a32c7545a09ef5c6e2559`;
- `apps/api/src/refresh-routes.ts` → `10d70f882e7eedd2162adf0dca03746ed5d96bd8`;
- `apps/api/src/sync-routes.ts` → `cd7d114c061ce561f311e67f772dd0c8c452d496`;
- `packages/server/bootstrap/src/index.ts` → `03044c8501697a71446ae161cb0bdbe3daee007d`;
- `packages/server/remote-config/src/index.ts` → `48d88f777217c8c5472a6e28e2bc8b83dc43083c`.

Therefore the known 0.2.12 source/API compatibility statement remains valid on the inspected current main.

## Protected session metadata

Protected technical portal-session artifact:
`/root/octoport-control/tmp/C/store1-owner-tech-20260928/portal-session-c.json`

The file is mode `0600`. The saved privacy-safe probe records `metadata_expired=false`, `adminSessionIssued=false`, and API origin `https://api.octoport.ru`.

Cookie values were used only in memory for the bounded GET requests. They were not printed or copied into this receipt or the stored evidence.

## Read-only live admin probe

Privacy-safe probe evidence:
`/root/octoport-control/logs/B/c06-0212-live-catalog-readonly-admin-session-preflight-20261003.json`

SHA256: `492661338fb1cca44bc3944f160cd58b5e676c42285b291b592d301afad3879c`.

Two GET-only admin catalog probes returned:

1. `/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2` → **HTTP 401**;
2. `/v1/admin/ai/registry/adapters?limit=1` → **HTTP 401**.

No POST/PUT/PATCH/DELETE request, direct SQL, catalog mutation, profile mutation, config publication, browser action, provider action, or store action occurred.

## Interpretation

HTTP 401 proves **ADMIN_SESSION_REQUIRED** for this protected catalog readback.

It does **not** prove that the live catalog is empty, that the 0.2.12 profile is absent, or that the live backend is compatible or incompatible.

Therefore `current_compatible_backend_verified` must remain `false`. The exact Chromium and Firefox 0.2.12 operator candidates remain `PREPARING`.

## Existing normal next path

The project already has a read-only release-transition/catalog helper that uses protected admin GET endpoints and fails closed on incomplete authority.

A later legitimate admin session may rerun that existing GET-only preflight. The previously platform-blocked OTP/admin-session refresh must not be retried through an alternate tool or replaced with direct DB mutation.

## Result

**PASS as a B02 evidence reconciliation only.**

The source/API boundary is compatible and unchanged through inspected current main, while the live profile/catalog boundary remains honestly blocked on a valid admin session.
