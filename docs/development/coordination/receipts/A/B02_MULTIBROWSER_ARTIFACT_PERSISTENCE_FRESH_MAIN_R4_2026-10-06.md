# B02 multibrowser artifact persistence — fresh-main R4

Task: `B02-MULTIBROWSER-ARTIFACT-PERSISTENCE-FRESH-MAIN-R4-20261006`

## Why R4 exists

R3 source and focused verification were independently accepted, but mandatory exact-candidate Coordination and release safety CI exposed one deterministic scope omission.

Exact rejected publication candidate:

- HEAD: `02da1cc32dfe4c72c0dd254c54149530188fa562`
- tree: `e3200587448bce94738f721be9c773f50b9a9f81`
- parent/current base: `d7f26119d4e1e73d6f45ea6127951583a1ae28e0`

GitHub Actions run `37384024013`, job `112012756349`, failed only the release-safety step:

- test: `repository release facts use current contract/version/migration tag`
- file: `tooling/b1/release-safety.test.mjs`
- assertion: actual migration level `58`, expected `57`
- upstream coordination Python unit tests: PASS
- bounded process lifecycle/concurrent admission: PASS

The same failure was reproduced locally on exact `02da1cc3` with Node 24: 41 PASS / 1 FAIL, `58 !== 57`.

Evidence:
`/root/octoport-control/logs/A/b02-multibrowser-artifact-persistence-fresh-main-r3-20261005/CI_REWORK_RELEASE_SAFETY_MIGRATION58_R1.json`.

## Root cause

B02 correctly adds migration `0058_extension_release_browser_artifacts` as journal index 46. `tooling/b1/release-lib.mjs::productFacts()` intentionally derives current repository migration level from the latest journal tag, so current repository facts correctly report migration level 58.

The release-safety current-repository assertion still hard-coded the previous value 57. This is the same accepted maintenance class documented in:

`docs/development/coordination/receipts/C/C_B18_RETENTION_API_SEMANTIC_OZON_INTAKE_2026-09-28.md`

where adding migration 0052 made the prior 51 assertion stale and only that current-repository assertion was updated.

This is not a defect in migration 0058 and does not authorize rewriting historical/frozen release authority.

## Exact R4 delta

R4 starts from exact `02da1cc3`.

Before this receipt was added, the only source delta from `02da1cc3` was:

`tooling/b1/release-safety.test.mjs`

with exactly one line changed:

- `assert.equal(facts.migrationLevel, 57);`

* `assert.equal(facts.migrationLevel, 58);`

The product version assertion remains `0.2.12`.
The contract version assertion remains `control_plane_v2`.

All 16 inherited R3 B02 paths were read back byte-identical to `02da1cc3`; no runtime, migration, repository, preflight, integration or R3 receipt byte changed.

## Focused verification

Node:

`/root/.nvm/versions/node/v24.20.0/bin/node`

Command:

`node --test tooling/b1/release-safety.test.mjs`

Result:

- tests: 42
- pass: 42
- fail: 0
- cancelled: 0
- skipped: 0

Log:

`/root/octoport-control/logs/A/B02-MULTIBROWSER-R4-RELEASE-SAFETY-R1.log`

SHA-256:

`32602476e32ed89bc85c9d40b171ffb2f699d35b3ef7d3873ffaef2dad95fea0`

`git diff --check`: PASS.

## Inherited accepted R3 evidence

R4 intentionally reuses the exact unchanged R3 product bytes and accepted verification:

- compatibility: 18/18 PASS
- transition + multibrowser preflight: 28/28 PASS
- compatibility typecheck: PASS
- DB typecheck: PASS
- migration 0058 static checks: PASS
- independent semantic/source review: PASS, P0/P1/P2 none
- single-parent identity/provenance review for `02da1cc3`: PASS, P0/P1/P2 none

R4 does not re-run disposable PostgreSQL solely for a test-assertion update. Exact-head Server CI remains authoritative before publication.

## Publication boundary

Rejected R3 task-publication registration `5a639d29139b1e41980770e41c14ea2d503bf8b5ddd268fd2f4122c76a00ca7b` was governed-superseded after the deterministic CI failure. Its task ref was deleted and registration closed. Main remained `d7f26119...`.

The earlier transport-only registration `75f63d86...` was separately governed-superseded after a non-interactive HTTPS push failure; no ref/main mutation occurred.

The stale no-push registration `fdcc6678...` remains preserved as lifecycle debt and is not publication authority.

R4 requires:

1. fresh independent `gpt-6-luna` review;
2. fresh-main compatibility check;
3. governed reconstruction to one parent if needed;
4. a fresh task-publication registration using the authorized SSH push URL;
5. five exact-candidate CI SUCCESS;
6. non-force main publication/readback;
7. task-ref cleanup, registration close, disk cleanup and strict queue completion.

## Non-claims

- SOURCE only.
- No package rebuild.
- No installed/browser acceptance.
- No ordinary auth.
- No LIVE_OWNER flow.
- No catalog/config/DB live mutation.
- No deployment or production claim.
- No historical 0.2.12 authority relabel.
