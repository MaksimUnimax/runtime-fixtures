# C06 Chrome c8dd exact-artifact readiness reconciliation R3

Task: `C06-CHROMEC8DD-EXACT-ARTIFACT-READINESS-RECONCILIATION-R3-20261006`.

## Exact fresh-main boundary

- fresh base: `c8dd58f3ee6cfb0ccef2841e9be47e7f8c17b7a7`
- fresh base tree: `c62c1814ee3c809d870d2d7556fdcedcafbbd7c1`
- predecessor readiness base: `e44a2b5bd724f231cd6bb478074624c6534adc1f`
- accepted Start/runtime source: `087eab3394aac5164e8b3d16459eabf0697895d9`
- exact repaired Chrome 0.2.13 ZIP SHA-256: `7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4`
- exact repaired Chrome ZIP bytes: `2300829`

The complete `e44a2b5b..c8dd58f3` delta changes exactly five C07/canonical-input paths:

- `docs/development/coordination/receipts/A/C07_CHROME0213_7D12_RELEASE_CANONICAL_SUCCESSOR_R1_2026-10-06.md`
- `packages/server/compatibility/src/beta-release-canonical-inputs.test.ts`
- `packages/server/compatibility/src/beta-release-canonical-inputs.ts`
- `tooling/server/store-multibrowser-successor-preflight.test.ts`
- `tooling/server/store-multibrowser-successor-preflight.ts`

The four accepted Chrome Start/runtime repair paths are byte-identical between `e44a2b5b` and `c8dd58f3`: popup/runtime plus the two Start regression/diagnostic files. No prior browser/product test is relabeled as rerun on c8dd.

## What c8dd changes

The accepted c8dd C07 successor adds a repaired-Chrome source canonical input for 0.2.13:

- Chrome -> `7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4`
- Opera -> `8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463`
- Yandex Chromium -> `8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463`
- Firefox -> `b987ce3a24258d3922f61b2d650c17ef029d895a25aab0ec6d27cccacec3c037`

This closes the earlier **SOURCE_CANONICAL_INPUT** gap for the exact repaired Chrome artifact. It does not by itself mutate or prove a live release catalog, policy activation, installed server state, authentication, deployment, or production.

The pre-existing operator candidate `OCTOPORT-0_2_13-CHROME-7d12ddcb` remains `PREPARING`. Its stored limitations were written before c8dd and correctly did not inherit old 8d/b987 authority. This task does not rewrite that operator record; downstream owner/operator readiness must consume accepted c8dd evidence through its own governed update.

## Preserved evidence

### SOURCE — PASS

The Start/runtime repair remains exact source `087eab33...`, independently reviewed and published with five required CI. The c8dd delta does not touch those four product/test paths.

### INSTALLED_SYNTHETIC / Google Chrome — PASS for prior exact evidence

The accepted installed-development Google Chrome 147 fixture remains evidence for the exact repaired source/package boundary. Ten Ozon/WB Start/HELP/visibility/Finish scenarios passed, including one-send binding, no replay, store switch, result delivery and Finish.

This is not ordinary owner authentication.

### EXACT PREPRODUCTION ZIP — PASS for identity and signed-out installation

Exact repaired ZIP `7d12ddcb...`, 2,300,829 bytes, is the same retained package identity cited by the accepted Chrome repair evidence. Exact Google Chrome 147 signed-out installation passed with MV3 service worker, support snapshot, no external requests and no page errors.

### SOURCE_CANONICAL_INPUT — PASS on c8dd

Current main now contains an accepted additive repaired-Chrome canonical input selecting exact `7d12ddcb...` for Chrome while preserving 8d for Opera/Yandex and b987 for Firefox. The c8dd source receipt explicitly limits this to source canonical input plus exact retained package byte identity.

### LIVE catalog/policy activation — NOT_ACCEPTED

No evidence in c8dd proves that a live server catalog or policy was mutated to the repaired Chrome identity. Source canonical input and live activation remain distinct boundaries.

## Current C06 status

| Boundary | Status | Exact meaning |
| --- | --- | --- |
| Start/runtime SOURCE | PASS | Accepted exact 087e repair; c8dd leaves paths unchanged |
| INSTALLED_SYNTHETIC Chrome 147 | PASS | Prior 10-case installed-development fixture |
| Exact 7d12 PREPRODUCTION ZIP identity | PASS | Exact SHA/size and retained package identity |
| Exact ZIP signed-out Chrome install | PASS | Accepted Google Chrome 147 signed-out evidence |
| 7d12 SOURCE_CANONICAL_INPUT | PASS | Accepted on current main c8dd |
| Live release catalog/policy activation for 7d12 | NOT_ACCEPTED | No live mutation/readback established by c8dd |
| Ordinary Octoport login on exact ZIP | NOT_ACCEPTED | No ordinary signed login evidence |
| authenticated/workAllowed on exact ZIP | NOT_ACCEPTED | Synthetic fixture auth is not ordinary login |
| Full stores/credential transfer/import/export acceptance | NOT_ACCEPTED | No complete exact-package acceptance proof |
| Real Standard/Work/Alice useful flow | NOT_ACCEPTED | No exact-package LIVE_OWNER end-to-end proof |
| Provider error/429 and full recovery matrix | NOT_ACCEPTED | Not closed by this evidence-only reconciliation |
| Deployment / production | NOT_ACCEPTED | No authority or execution claimed |

## Historical publication state

Two historical publication states are distinct and remain preserved. Registration `f0f40b3c6b186f27383d1f862a125f2773c06f180f5744cb4244bc114a9be55a` is the earlier stale READY registration whose governed publish-main call was explicitly platform-blocked before execution. Registration `f43e656d20e614cfd186e9abbf9ae41a69daec40a1b580572bb9dcf42e32e9e3` belongs to predecessor candidate `bccd194e...` and remains historical `TASK_REF_PUBLISHED`; its records contain no READY attempt. This task retries neither historical blocked action, deletes neither task ref manually, and mutates neither registration.

Because current main advanced to c8dd and changed exact-artifact source authority, this is a new fresh-base reconciliation rather than a retry of the blocked predecessor.

## Verification notes

A fresh Git readback proved the five-path e44→c8dd delta, byte identity of the four Start/runtime paths, and the repaired-Chrome canonical mapping in current source.

A local attempt to rerun the two canonical-input TypeScript suites from this fresh worktree did not collect tests because the isolated worktree has no workspace package dependency links for `@product/shared` and `@product/contracts`. No dependency installation or cross-worktree module substitution was performed. This is setup-only evidence, not a product-test failure. The accepted c8dd source publication already carries its own focused verification and required publication gates.

This task performs no browser launch, authentication, provider/marketplace request, DB/service mutation, package rebuild, operator readiness transition, live catalog mutation, deployment or production action.
