# C07 — Store transition browser-generic core R1 — 2026-10-06

## Scope

Source-only refactor of the existing read-only store release transition analyzer.
No catalog/profile/database/service/authentication/browser/provider/deployment or
LIVE_OWNER mutation is performed.

Fresh base: `ecae32277f2a0b6935884ce27e823fffbbebf4b5`.

This result closes the two independent review findings raised against the prior
Chrome transition candidate `018bf946...`:

1. `CHROME_TARGET_INTERSECTS_OPERA_LITERAL_CONTRACT`;
2. `GENERIC_ANALYZER_DIAGNOSTICS_STILL_OPERA_SPECIFIC`.

## Type contract

`StoreReleaseTransitionTarget` now parameterizes only the four browser-specific
literal fields:

- browser family;
- minimum browser version;
- policy key;
- profile key.

Their defaults remain the existing Opera constants. Existing unparameterized
Opera callers therefore retain the same narrow compile-time contract and runtime
behavior. Shared canonical identities remain narrow: adapter `chatgpt` and
surface `web` are not generalized.

`AnyStoreReleaseTransitionTarget` is the browser-neutral analyzer input alias.
`StoreReleaseTransitionReport` is generic over the exact target, and
`analyzeStoreReleaseTransition()` / `runStoreReleaseTransitionPreflight()` retain
the caller's target literals in `report.target`.

A compile-time Chrome target (`chrome`, `147`, `store1.chrome.v2`,
`chatgpt-web-chrome-v1`) is present in the regression test and compiles under the
repository strict/bundler TypeScript options. The returned report preserves the
literal `browserFamily: "chrome"`, proving the previous impossible `never`
intersection is gone.

## Diagnostics

Machine codes remain unchanged:

- `ASSIGNMENT_MISSING`;
- `ASSIGNMENT_CONFLICT`.

Only human details became browser-neutral:

- `Target browser account assignment is missing.`
- `Multiple exact target browser account assignments exist.`

Runtime regression covers both missing and conflict Chrome assignment cases and
asserts that neither diagnostic contains `Opera`.

## Verification

- `store-release-transition-preflight.test.ts`: 12/12 PASS;
- Prettier exact task files: PASS;
- ESLint exact task files: PASS;
- strict TypeScript compile with repository compiler semantics
  (`target ES2024`, `module ESNext`, `moduleResolution bundler`, `strict`,
  `noUncheckedIndexedAccess`): PASS;
- `git diff --check`: PASS.

An earlier ad-hoc NodeNext compile was rejected as non-authoritative because it
mixed workspace symlink sources under the wrong module-resolution mode. It
produced unrelated repository/import errors. The accepted local typecheck uses
the actual `tsconfig.base.json` semantics.

## Nonclaims

This task does not implement the Chrome live-transition adapter itself and does
not claim live Chrome catalog readiness. The current owner-test Chrome authority
gap remains separate. The Chrome successor must consume this generic core only
after its separately claimed popup Finish→Start product fix is accepted.
