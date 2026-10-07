# C07 — Chrome 0.2.13 live transition preflight R1 — 2026-10-06

## Boundary

This result is source-only and read-only. It prepares the exact catalog/profile
readiness target for repaired Chrome 0.2.13 after accepted source canonical inputs
and migration0058 recovery evidence. It does not perform release, policy, config,
profile, assignment, database, service, authentication, browser or deployment
mutation.

Current reconstructed base: `fd70caad0162bbf1b9482186b4b2a5975261001f`.

The original accepted three-path source patch was reconstructed unchanged onto
`fd70caad...` after the pre-existing Finish-to-Start test-harness race was fixed
separately in main. The later independent review of reconstructed candidate
`8b9a9208...` found a Chrome-target TypeScript default-generic conflict and this
receipt's stale historical base statement; both are corrected in the successor
bytes under fresh independent review.

Accepted source inputs:

- Chrome repaired artifact SHA-256 `7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4`;
- product version `0.2.13`, contract `control_plane_v2`;
- Chrome policy key `store1.chrome.v2`, minimum browser major `147`;
- repaired Chrome profile `chatgpt-web-chrome-v1` with compatibility-derived
  fingerprint distinct from the accepted Opera profile;
- migration0058 recovery evidence remains accepted history; this source-only
  adapter does not grant or reuse deployment authority.

## Implementation

`store-chrome0213-transition-preflight.ts` is intentionally a thin target adapter.
It reuses `analyzeStoreReleaseTransition()` unchanged. No POST planner is added.
The Chrome target explicitly parameterizes the generic transition target/report
away from their historical Opera defaults. The runtime target is constructed from
the accepted repaired-release and Chrome-policy canonical inputs plus the repaired
Chrome profile target.

The generic analyzer must see all of these exact live readbacks before reporting
READY: browser-specific release artifact, Chrome policy revision, active signed
config linked to that policy, active ChatGPT web profile revision with the exact
Chrome fingerprint, and a DIRECT Chrome assignment. Missing/unavailable reads stay
MISMATCH/UNKNOWN according to the existing analyzer.

The `migrationLevel: 58` target metadata names the current migration0058 schema
line; it is informational in the existing analyzer and grants no migration or live
mutation authority.

## Safety invariants

Historical Chrome `8d0664dd...`, Opera minimum `136`, the Opera profile fingerprint,
or a config missing the exact Chrome policy link cannot satisfy this target.
Opera/Yandex keep their historical Chromium artifact and Firefox keeps its accepted
Firefox artifact; this task does not change their policy authority.

Actual owner-test deployment, live catalog/profile publication, ordinary extension
authentication, provider access and LIVE_OWNER useful flow remain separate gates.

## Focused verification

On the current reconstructed parent/base
`fd70caad0162bbf1b9482186b4b2a5975261001f`, after the review correction:

- Node `v24.20.0`;
- Chrome transition preflight tests: 6/6 PASS;
- existing generic release-transition analyzer tests: 12/12 PASS;
- combined focused total: 18/18 PASS;
- workspace package typecheck: all five participating workspace projects completed
  without an error;
- Prettier exact TypeScript task files: PASS;
- ESLint exact TypeScript task files: PASS;
- `git diff --check`: PASS.

A standalone single-file `tsc` invocation was also used diagnostically because the
independent review had identified a TypeScript contract defect. That invocation is
not a project-supported gate and reports pre-existing workspace-resolution/type
errors when canonical inputs are compiled outside their project configs. The
original impossible intersection with Opera-default target literals is removed;
the corrected candidate still requires a fresh independent exact-candidate review
and the normal five exact CI workflows before publication.

The historical sparse-checkout dependency misses and the earlier candidate's
Finish-to-Start harness race remain preserved evidence; neither is reclassified as
a product failure by this correction.
