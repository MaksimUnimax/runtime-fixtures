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

## C intake rework — profile floor independence

C rejected the first submitted candidate f21ba467dc318ef4e28bf650cc21f114718d8d5d with exact handoff:

/root/octoport-control/peer-handoffs/B/C-B-B02-RELEASE-PREFLIGHT-PROFILE-FLOOR-REWORK-20260929-0827.request.json

The finding was correct: the first helper rebuilt the profile compatibility fingerprint with minimumExtensionVersion=manifest.productVersion. That incorrectly coupled package release identity to AI profile compatibility.

Accepted STORE 0.2.8 semantics keep:

- package / compatibility policy / config target at 0.2.8;
- canonical AI profile compatibility floor at 0.2.7;
- canonical published profile SHA-256 cab55851bd2d571c19de5d44f3f8b3c40ff0ba3eb44e346307a2578894b1b2c1;
- existing DIRECT assignment to that published profile revision.

### Correction

The transition helper now imports and uses canonical STORE1_PROFILE_SHA256 from the existing Store1 planner authority. It no longer computes a profile fingerprint from manifest.productVersion.

The B1 manifest remains authoritative for release transition identity: source head/tree, package product version, contract, migration level, package filename/bytes/SHA. Profile compatibility authority is intentionally independent.

### Corrected verification

Focused unit: 8/8 PASS.
- B1 target 0.2.8 and 0.2.9 both retain canonical Store1 profile SHA.
- Target 0.2.8 plus published canonical profile SHA and DIRECT assignment reports profileRevision/assignment READY.
- Wrong published profile SHA reports PROFILE_TARGET_REVISION_MISSING / MISMATCH.

Disposable PostgreSQL + real admin GET integration: 4/4 PASS.
- Known previous release 0.2.7 leaves profileRevision + assignment READY while release/policy/config show the transition gap.
- Exact 0.2.8 release/policy/config with canonical 0.2.7-floor profile is READY.
- Wrong/incomplete catalog authority remains fail-closed.
- All preflight requests remain GET-only and the transition DB snapshot is unchanged.

Resource receipt: /root/octoport-control/resource-jobs/2f951c44122146989a567243a0fa7996/receipt.json
- command exit 0; OOM kill 0; cleanup verified; peak 736100352 bytes.

Workspace typecheck after rework:
/root/octoport-control/resource-jobs/9a3dc76a126c4745adf36ffa62bf9049/receipt.json
- command exit 0; OOM kill 0; cleanup verified; peak 2111832064 bytes.

Focused ESLint, Prettier and git diff --check all exit 0.

The current protected live catalog read remains a separate C-owned session/readback boundary. No live write, direct SQL, auth bypass, package publication or deployment was performed by B.
