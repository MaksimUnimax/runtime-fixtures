# B09 STORE-1 v2 signature preflight — 2026-09-27

Status: **SOURCE VALIDATED REWORK CANDIDATE / NO LIVE REQUESTS / NO CATALOG WRITES**

## Scope

Controller assignments: `STREAMS-AUDIT-20260927-0701`, corrected by `STREAMS-AUDIT-20260927-0743`.

B09 binds the accepted STORE-1 Opera package and its packaged verifier/trust bundle to current admin config metadata and an ordinary authenticated no-AI v2 bootstrap before an executable planner may return a catalog POST. It does not read signing private material or introduce a signing/attestation service.

Earlier candidates `b2c5e990`, `ef754939`, and `506d6dc` are superseded by this rework. The controller reproduced caller-forgeable JSON proof provenance at `ef754939`; `506d6dc` closed that bypass but did not yet prove intended packaged HTTPS origin and envelope freshness at the executable composition boundary.

## Source behavior

- Exact package authority is pinned to source `e7d66152bdb77918b65115486c9829ef7a634e69`, tree `01ae2c1d84a354a11d919a313f8d9909d1285b6a`, version `0.2.4`, contract `control_plane_v2`, and ZIP SHA-256 `0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c`.
- The bounded ZIP parser loads packaged `service_worker.js` and `shared/bootstrap_verifier.js`. LOCAL DEVELOPMENT config is rejected.
- Exact packaged config supplies the trusted control origin; current package readback is `https://api.octoport.ru`.
- The executable wrapper performs package evidence read + packaged verifier + authenticated-context check + freshness check before constructing a process-local trusted planner capability.
- Ordinary/deserialized JSON `verified:true` is never executable authority. The pure CLI preview is marked `executionAuthority:false`.
- The v2 signed payload does **not** sign device ID or browser identity. B09 does not claim otherwise: device/browser/account/origin are bound by the ordinary authenticated transport request/response in the same executing call, while account/config/key/schema/canonical bytes are additionally checked in the signed envelope.
- Authenticated response context must match expected reviewer account, device, Opera browser/version, and the exact packaged control origin.
- Effective freshness uses `max(now, signed serverTime) < expiresAt`; equality at `expiresAt` fails closed.
- A config CAS invalidates the old capability. Another signed bootstrap preflight is required before the next catalog POST.
- Reviewer identity/admission remains a separate prerequisite; beta stays CLOSED and no SQL/admin bypass is added.

## Verification

Environment: Node 24.20.0, pnpm 10.34.5.

- Focused planner + packaged-signature tests: **32/32 PASS**.
  - supervisor: `octoport-test-b-bc87b49daf244fbea05033defa9c14b3.service`
  - cleanup verified.
- STORE-1 whole-sequence PostgreSQL integration: **3/3 PASS** on B disposable PostgreSQL.
  - supervisor: `octoport-test-b-4a1170ba485540fdb337802062906083.service`
  - production-entry regression proves forged JSON, tampered signature, wrong authenticated account/origin, and exact-expiry failures produce no catalog DB mutation; a real synthetic Ed25519 envelope through the packaged-verifier path can return the bounded release POST; full sequence still refreshes proof after config CAS and replay is mutation-free.
  - cleanup verified.
- Controller unsigned-proof reproducer rerun against current changed tree: **BLOCKED**, code `STORE1_V2_SIGNATURE_PREFLIGHT_UNTRUSTED`, `networkRequests=0`.
  - supervisor: `octoport-test-b-4035dddba47a4baa9de665a3adf59724.service`
- Exact accepted local STORE package evidence read: PASS.
  - supervisor: `octoport-test-b-05f50e78ec694b95ae5193f38ed293af.service`
  - artifact SHA matched accepted authority;
  - packaged control origin: `https://api.octoport.ru`;
  - canonical trust-bundle SHA-256: `c0bce660c6d6c2c1fa2f4cb57c336aa12c5b638ec74fcf56faf4615ca8e3d4c7`;
  - active packaged key: `octoport-preprod-2026-09-19`.
- Targeted ESLint: PASS.
  - supervisor: `octoport-test-b-8f0bdaf2be314ca691839fd752c4aae3.service`
- Final Prettier/docs/diff/guard are run immediately before commit.

## Negative coverage

Focused and integration coverage rejects caller-fabricated/deserialized proof, bad/tampered signature, unknown packaged key, config/key/account mismatch, wrong authenticated device/browser/origin, signed payload expiry at the exact boundary, noncanonical payload, development packaged config, and mismatched package bytes. These failures do not authorize a catalog POST.

## Boundary

This is SOURCE evidence only. No live API request, protected credential read, live database mutation, reviewer provisioning, compatibility/catalog mutation, deployment, billing action, or browser-store action was performed.

C-owned dormant subscription-access v3 remains separate. After this B09 safe boundary, B starts its v3 producer/API work only when the exact C shared foundation is accepted/published for B consumption.
