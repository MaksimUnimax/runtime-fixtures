# C07 STORE 0.2.13 release canonical input successor — R1

Task: `C07-STORE0213-RELEASE-CANONICAL-INPUT-SUCCESSOR-R1-20261006`

## Exact base

- Fresh base: `origin/main = 087eab3394aac5164e8b3d16459eabf0697895d9`
- Base tree: `7c72525e6e91c2ddda65e5d8ca0226846c04ae66`
- Historical canonical release input remains exact `0.2.12`; it was not relabeled or replaced.
- This source result grants no deployment, DB, catalog, package-build, auth, provider, marketplace, admin, signing, or live-publication authority.

## Additive 0.2.13 authority

The compatibility package now exposes a separate deeply-frozen `STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1` with:

- product version `0.2.13`
- contract `control_plane_v2`
- release channel `stable`
- browser set `chrome, opera, yandex_chromium, firefox`
- Chromium carrier SHA-256 `8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463`
- Firefox carrier SHA-256 `b987ce3a24258d3922f61b2d650c17ef029d895a25aab0ec6d27cccacec3c037`
- browser-specific persistence only; no release-level single-digest flattening.

The multibrowser successor preflight now explicitly models the accepted transition:

- current immutable release: `0.2.12`
- successor release: `0.2.13`
- exact successor digest checks come from the additive 0.2.13 canonical input.

The existing Opera profile minimum remains the previously accepted `136`. Chrome, Yandex Chromium, and Firefox still carry no selected minimum browser version and remain `browserMinimumDecisionRequired=true`. `beta-opera-policy-canonical-inputs.ts` was not modified.

## Exact package proof

Read-only preflight used the accepted preserved candidate:

- manifest: `/root/octoport-control/logs/C/c01-store0213-package-prep-r1-20261006/candidate/B1_RC_MANIFEST.json`
- source: `40c139fcb39733cdae6f4f57cad7239993c5e46f`
- source tree: `ec8faf8d4cfa4294ef29461a5b2dd85603e9afca`
- Chromium ZIP bytes: `2298442`, `bytesVerified=true`
- Firefox ZIP bytes: `4282254`, `bytesVerified=true`
- result: `/root/octoport-control/logs/A/c07-store0213-release-canonical-input-successor-r1-20261006/EXACT_PACKAGE_PREFLIGHT.json`
- result SHA-256: `269b65cca430104b37a760615311027075aea8bdf975ec712d043f35312574e3`

The package manifest remains migration level 57 evidence. This source contract does not relabel it as migration58 or as a deployed server.

## Checks

- Focused Vitest: 2 files, 23/23 PASS.
  - evidence SHA-256: `cf8d616da4c7a424fbc4d528c6f55313b084936aaaed6e206f13e531f805a842`
- ESLint on all four changed TypeScript files: PASS, no diagnostics.
  - empty successful log SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- Workspace `pnpm typecheck`: PASS under supervised build profile.
  - evidence SHA-256: `8739cb52f156590a46beb4bd41516e1971a0a55b38614ef78ec24b2003631120`
- Prettier check: PASS.
  - evidence SHA-256: `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20`
- Bridge boundary guard: PASS.
  - evidence SHA-256: `d2e53be2b7a5aa9208a600162dcae8e4b9dde2ab3a00b0151e28cca5ed1f40f5`
- `git diff --check`: PASS.
- Diff is limited to the four task TypeScript paths plus this receipt; no policy canonical input, migration, lockfile, package metadata, package bytes, or live state changed.

Two author-side invocation mistakes are not counted as product/test failures:
- an earlier resource-run attempt used unsupported profile name `test` and stopped in argparse before tests;
- an earlier one-line exact-preflight shell command had quoting syntax error before `tsx`; the accepted exact-package preflight above then ran successfully through a small read-only evidence runner.

## Remaining gates

1. Exact candidate is committed on this fresh base; `9c7795cc..087eab33` changed none of the five task paths.
2. Independent `gpt-6-luna` read-only review.
3. Reconcile against a fresh `origin/main`; if source publication remains warranted, use governed task-publication, exact five CI, ready-main, non-force push and readback.
4. Live 0.2.13 catalog publication and compatibility-policy/config activation remain separate authorized operations.
5. Exact `d7303f29...` owner-test deployment remains separately authority-gated.
