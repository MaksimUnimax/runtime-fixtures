# B02/B05 — release transition preflight — 2026-09-29

Status: **SOURCE + DISPOSABLE POSTGRESQL ACCEPTANCE / LIVE CATALOG READBACK UNKNOWN**

Controller assignment: `B-L2-FLOW-CORRECTION-20260929T0730Z`.

## Purpose

Provide one read-only release-transition inventory before sequential live catalog attempts. Reuse existing compatibility/config/profile/assignment authorities; do not add a second activation mechanism and do not mutate live catalog/DB.

## Implementation

Feature commit: `5f5c3368229a19aeab345ebc361ef23cc2adec5c`.

Assigned files:

- `tooling/server/store-release-transition-preflight.ts`
- `tooling/server/store-release-transition-preflight.test.ts`
- `tests/integration/server/store-release-transition-preflight.integration.test.ts`

The helper:

- derives target source/tree/version/contract/package SHA and package bytes from the authoritative `b1_release_candidate_v2` manifest;
- validates the exact Chromium package bytes against that manifest;
- derives the target STORE profile fingerprint from the existing STORE1 profile content plus the manifest extension version;
- reads only existing admin GET endpoints for release, policy, latest config, adapter, surface, profile revisions and assignment;
- follows pagination;
- emits a single complete `READY | MISMATCH | UNKNOWN` report and preserves independent mismatches when one source is UNKNOWN;
- has no catalog mutation path and does not emit credentials;
- contains no hard-coded 0.2.8 source/head/tree/artifact pin.

## Verification

Focused unit:
`pnpm exec vitest run tooling/server/store-release-transition-preflight.test.ts`
→ **7/7 PASS**.

Focused static:
- ESLint PASS
- Prettier PASS
- `git diff --check` PASS.

Disposable PostgreSQL/API integration:
`B heavy --db -- pnpm exec vitest run tests/integration/server/store-release-transition-preflight.integration.test.ts`
→ **4/4 PASS**.
The test uses real admin GET handlers and B repositories and asserts DB transition counts are unchanged by every preflight.

Resource receipt:
`/root/octoport-control/resource-jobs/fb76c4ac8da54e15bc166fb0da633ee2/receipt.json`
- command exit 0
- OOM kill 0
- cleanup verified
- peak 566231040 bytes.

Workspace typecheck resource receipt:
`/root/octoport-control/resource-jobs/715b1d99be784aa899523258fa92ffdd/receipt.json`
- command exit 0
- OOM kill 0
- cleanup verified
- peak 1879048192 bytes.

## Current STORE 0.2.8 read-only observation

Authoritative current candidate manifest:
`/root/octoport-control/logs/C/store-release-028-8c6ade80/candidate/B1_RC_MANIFEST.json`

Target:
- source head `8c6ade801b7441f0b64eb850f46b86c4b61dc39e`
- source tree `d2dcd6adc4c96f9fa9a7b743a0d1abd82485740f`
- product `0.2.8`
- artifact SHA-256 `63943ebc63f37fa4c8718ae252149dfd2b90a1d9dbc4b9637d35023f0c15ae48`.

Current protected admin read returned HTTP 401 for release/policies/config/adapters, so the report correctly returns **UNKNOWN** rather than fabricating a catalog transition. Output:
`/root/octoport-control/logs/B/store-release-transition-preflight-store028-8c6-current.json`.

Observed flags:
- `readOnly=true`
- `catalogMutationExecuted=false`
- live DB/API mutation: **0**
- direct SQL writes: **0**
- auth bypass: **0**.

C already owns normal protected-session refresh and authorized activation/readback after its STORE 0.2.8 CI. No owner action is required from this B result.

## Integration note

B branch then merged accepted site-only main `2827d97afd746b5c04b3e0a8a479e457489a2827` as merge `156454fdf83057c1f2719c8b21897f06d29fd707`.

A branch-only `static-site` workflow on that merge fails because the workflow assertion still expects the previous stylesheet query while accepted main contains the new dark-owner stylesheet. B changed no site path and must not repair `apps/site`. Accepted main server/extension checks are 10/10 SUCCESS.

## Boundary

This is a preflight/read-model helper only. It does not authorize release publication, policy/config publication, profile/assignment mutation, production deploy, live DB changes, package publication, or STORE submission. C remains sole main/live integrator.
