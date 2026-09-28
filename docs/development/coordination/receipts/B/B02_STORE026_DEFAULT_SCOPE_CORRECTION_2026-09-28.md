# B02 — STORE0.2.6 default bootstrap profile scope correction — 2026-09-28

Status: **SOURCE CANDIDATE; NOT LIVE / NOT DEPLOYED**.

Task: `B02_DIRECT_ASSIGNMENT_REAL_OWNER_RESOLUTION`.
Base at investigation start: `59d5d43abd9a70847d865626bbbd4b4477acb903` with canonical main `d448e41b741561f1516f41df81a60f3c6f5ad9ca`.

## Real owner-test finding

A/C completed the normal technical owner flow for the exact frozen STORE0.2.6 Opera package without injecting extension auth state:

- package SHA-256 remains `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`;
- Opera `136.0.6008.22`, extension `0.2.6`;
- normal device authorization succeeded and account matched the protected portal session;
- bootstrap HTTP status `200`, configVersion `2`, extension/browser compatibility `SUPPORTED`;
- extension observed `authenticated=true` but `workAllowed=false`;
- detected AI was `chatgpt / web / variant=null`;
- bootstrap returned `aiStatus=UNAVAILABLE`, `profilePresent=false`, client failure `BOOTSTRAP_PROFILE_INCOMPATIBLE`.

Evidence is the privacy-safe A response `C-A-STORE026-CATALOG-READY-20260928-1544.response.json` plus the A technical-auth receipt. Manual email login, provider calls and live AI work remain untested and are not claimed here.

## Root cause

The accepted STORE1 admin activation planner created/read:

- a profile bound to concrete variant `standard_composer_v1`;
- an ACCOUNT assignment bound to the same non-null variant.

That is an **EXACT** assignment scope.

The canonical bootstrap resolver intentionally handles `detected.variant=null` by selecting only the **DEFAULT** assignment where `variant_id IS NULL`. It also verifies `profile.variantId === assignment.variantId`. Therefore the activated exact profile/assignment are invisible to the real `variant=null` bootstrap and the fail-closed `NO_PROFILE`/incompatible client result is expected.

This is a B02 catalog activation scope defect, not an extension validator/auth defect.

## Correction

`tooling/server/store1-opera-admin-activation.ts` now targets the actual default bootstrap scope:

- new profile identity key: `chatgpt-standard-opera-default-v1`;
- profile `variantId=null`;
- assignment `variantId=null`, `browserFamily=opera`, `subjectKind=ACCOUNT`;
- DIRECT assignment still selects the same immutable accepted profile content/fingerprint and keeps candidate null / percentage 0;
- profile/assignment readbacks are fetched across the Standard surface and filtered locally for `variantId=null`;
- existing legacy exact profile/assignment remain immutable history and are ignored for default selection.

A new profile key is necessary because `adapter_profiles.machine_key` is globally unique; the already-created exact profile cannot be duplicated under the same key. No old row is deleted or rewritten.

The C catalog executor already accumulates admin profile/assignment response items unchanged, including `variantId`, so no C transport/schema change is required.

## Verification

Pinned Node `v24.20.0`, pnpm `10.34.5`.

Targeted source tests:

- `tooling/server/store1-opera-admin-activation.test.ts`: **27/27 PASS**;
- `packages/server/bootstrap/src/ai-resolution.test.ts`: **7/7 PASS**;
- combined: **34/34 PASS**.

New regressions prove:

1. a legacy variant-scoped `chatgpt-standard-opera-v1` profile is treated as history and planner requests creation of the new default profile with `variantId=null`;
2. a legacy exact Opera ACCOUNT assignment does not conflict with an absent default assignment; planner requests a new assignment with `variantId=null`.

Additional checks:

- `@product/bootstrap` typecheck PASS;
- targeted Prettier PASS;
- targeted ESLint PASS;
- `git diff --check` PASS.

## C handoff / live boundary

B must not mutate the owner-test catalog directly.

After exact candidate intake, C can reuse its existing admin-only catalog executor to:

1. create/reuse the new default profile through ordinary admin APIs;
2. publish the same accepted profile content fingerprint;
3. create/reuse the default Opera ACCOUNT assignment and append DIRECT selection;
4. rerun signed read-only preflight and the normal technical device/bootstrap flow;
5. require real `profilePresent=true` / resolved AI before work/profile-dependent acceptance.

No direct SQL, no STORE ZIP change, no client validator weakening, no beta opening, no manual email-login claim.
