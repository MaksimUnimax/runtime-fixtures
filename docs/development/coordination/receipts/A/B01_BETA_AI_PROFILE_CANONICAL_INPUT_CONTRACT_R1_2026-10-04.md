# B01 beta AI/profile canonical-input contract R1

Task: `B01-BETA-AI-PROFILE-CANONICAL-INPUT-CONTRACT-R1-20261004`

## Source binding

- Task base: `9b7a745362ed53aec5b69ac51b9323459e9df79e`.
- Fresh remote main at final local pre-candidate check: `f203d8d32bb3010e193d55e9513f1f98b44c55e1`.
- The task base is an ancestor of fresh main.
- Task paths and required dependency paths have no drift from task base to fresh main.
- Accepted predecessor RESULT: `/root/octoport-control/logs/A/b01-beta-critical-canonical-input-candidates-r1-20261004/RESULT.json`, SHA256 `9316cf49275f703e2895f3eaf5453fa109ca8290552cff1ce2bd044f5360acb9`, independently reviewed PASS.

## Contract boundary

`beta_ai_profile_canonical_inputs_v1` exposes only product-required beta surface status and the committed bounded predecessor slice supported by accepted source.

Required product surfaces are exactly `CHATGPT_STANDARD`, `CHATGPT_WORK`, and `ALICE`; `betaWideCatalogProven=false`.

Only `CHATGPT_STANDARD` has committed input, and only for the historical Store1/Opera reviewer slice:

- adapter: `chatgpt` / `ChatGPT` / `STORE-1 Standard reviewer slice`;
- surface: `web` / `Web`;
- `variantId=null`, which authorizes no `ai_variants` row;
- profile: `chatgpt-web-opera-v1` / `ChatGPT Web Opera`;
- evidence version `0.2.11`, Opera minimum `136`, minimum extension `0.2.7`, contract `control_plane_v2`;
- exact profile content+compatibility fingerprint `cab55851bd2d571c19de5d44f3f8b3c40ff0ba3eb44e346307a2578894b1b2c1`.

`CHATGPT_WORK` and `ALICE` remain `MISSING_CANONICAL_INPUT`. No selector, variant, browser row, profile, account assignment, or cohort authority is inferred for them.

Dynamic DB/runtime authority is excluded: generated row ids/timestamps, registry lifecycle status, profile revision id/number/state/publication principals, and account/assignment/cohort authority. The contract reuses `AdapterProfileContentV1Schema`, `ProfileCompatibilityConstraintsV1Schema`, and `validateProfileContent`; it introduces no second profile validator and no remote-code/provider-transport authority.

## Store1 consumer refactor

`tooling/server/store1-opera-admin-activation.ts` now derives adapter/surface/profile semantic values and profile content/compatibility from the canonical Store1 input. Existing public `STORE1_*` exports and planner behavior are preserved. Runtime DB ids, CAS/readback state, and assignment authority remain runtime inputs.

## Local validation

No dependency install, Docker, DB, credential, network, provider, browser, admin, service, product package, GitHub, live, or production action was performed.

The sparse worktree reused already-installed dependencies only. Initial test attempts failed before collection because sparse workspace dependency source/config files were absent; the harness was repaired by materializing unchanged dependency packages from the same Git HEAD and linking already-installed Zod. Those harness failures are not product evidence.

Passing checks:

- full `@product/adapter-registry` Vitest: 3 files / 16 tests PASS;
- `tooling/server/store1-opera-admin-activation.test.ts`: 35 tests PASS;
- `@product/adapter-registry` `tsc --noEmit`: PASS;
- bounded ESLint: PASS;
- Prettier check: PASS;
- `git diff --check`: PASS;
- runtime fingerprint readback equals `cab55851bd2d571c19de5d44f3f8b3c40ff0ba3eb44e346307a2578894b1b2c1`.

The server has no local Node 24.20.0 executable. Local checks therefore ran under installed Node 22 and are pre-publication evidence only. Final acceptance still requires the normal governed five exact-SHA CI workflows on the project-pinned product environment before main publication.

## Evidence level

`SOURCE_LOCAL_PRECHECK_ONLY`

No DB writer/seed, beta-wide catalog, current 0.2.12 AI-profile catalog, live registration, or production readiness is claimed.

## Independent review R1 and bounded rework

Exact candidate 9343f1d122d23a15b242af1234ed951543d9fd02 received REWORK_REQUIRED from independent gpt-6-luna review.

Required corrections were:

- bind the parsed profile content and compatibility to the exact accepted source pair instead of accepting arbitrary shared-schema-valid values alongside the fixed fingerprint literal;
- make exported canonical input objects runtime-immutable because TypeScript as-const does not prevent mutation.

R2 rework keeps the shared profile schemas as the shape authority, adds exact-pair fail-closed checks, recursively freezes both exported canonical graphs, and adds negative drift plus deep-freeze tests. No beta surface, selector, profile, browser, DB identity, or runtime authority was added. A fresh exact-candidate independent review is required after the rework commit.
