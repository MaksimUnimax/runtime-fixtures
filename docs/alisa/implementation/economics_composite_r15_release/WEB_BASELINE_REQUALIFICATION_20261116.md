# R15 web baseline requalification — 16 November 2026

**Phase A source proposal. Current-source CI, the new actual builder PLAN and the new candidate package have not run. No deployment or readiness is granted.**

The period rollout changed the preserved web release after the original R15 package was built. This proposal updates the builder's expected baseline from the exact `a4f9746191db765b6498acede3764db5225b3a22` source. The filename `baseline_20261115.json` is retained because it is part of the frozen five-file builder interface. The 15 November builder and activation reports remain historical evidence for their own bytes and environment.

## Observed change

[PR438](https://github.com/MaksimUnimax/runtime-fixtures/pull/438) retains installer commit `a1c47395a4fdce06c35aef63fde73d8050e5eb70`. [PR440](https://github.com/MaksimUnimax/runtime-fixtures/pull/440), commit `03311ff0fc3904412997d3fdc31e7ab66580d709`, records its later web installation and live period acceptance. Those are separate from this R15 source proposal.

Two finite read-only observations supply the changed baseline values:

- `WEB_BASELINE_ACTUAL_READBACK_R1.json`, completed 2026-11-16 03:15:28 UTC, SHA256 `1842d9d7c1d17d7aa80e766ee59dd759d524091c9ac09bd3c784d6534ae45e51`: all eleven expected services stable; web PID 1563285 and process cwd under the new web root; exact web pointer; four manifest hashes; exact six-field APPLIED receipt; original R15 attempt and three publication targets absent.
- `APT_VENV_ACTUAL_READBACK_R1.json`, completed 2026-11-16 03:19:54 UTC, SHA256 `86e813b8d804e2d9a7d6bd0861e0d33be4e16413f11bcc99a93bdd293da42504`: the new web `.venv` literal and resolved target; platform and authority literals unchanged; native `.venv` absent. Its package-manager observations do not grant cleanup and are outside this source change.

| Baseline field | Previous value | New value |
|---|---|---|
| `observed_on` | `2026-11-15` | `2026-11-16` |
| `bases.web.root` | `/opt/alisa-platform/stage/releases/alisa-public-guidance-e0cc5b5aea966213` | `/opt/alisa-platform/stage/releases/alisa-catalog-period-dea0498f51980cdc` |
| `bases.web.manifest_sha256` | `6eb0e9987ab0383ab259e64cdb5f36dc78dd607dcba7a3379b1525f1da1f3d2b` | `f9724dfdad8eb8b197863e83b658bdeeb9002a942409babd94bb05e2a6cef42f` |
| `bases.web.venv_link` | `/opt/alisa-platform/stage/releases/alisa-customer-catalog-8b8b919993c38128/.venv` | `/opt/alisa-platform/stage/releases/alisa-public-guidance-e0cc5b5aea966213/.venv` |

The extra web dependency link is deliberate: the pinned rollout driver creates `new_web/.venv -> old_web/.venv`. The chain still resolves to `/opt/alisa-platform/stage/releases/alisa-store-enrollment-592cc8bb006a4991/.venv`. Keep every release in that dependency chain. Its literal link must not be replaced with the resolved target merely because they reach the same environment.

Exactly those four JSON leaves change. The three product-role roots/manifests, their dependency links, publisher, Python/Node expectations, lockfile hashes and unit/process cwd suffixes are retained. The two observations did not rehash every manifest-listed file, executable, publisher or lockfile. They establish the metadata change; the unchanged builder's full `snapshot()` must revalidate all retained expectations before a new PLAN is accepted.

## Source identities and dependency boundary

The product remains `1964d60f9a7598fefa2e10a0affcda0cce0f1f34`. Its 96 input paths/bytes are outside this change; the activation source-index pin remains `3b6bee51f233398d46c15646b3435edf147ee19e9cdf7abe74ae8908472dc26b`. No product code, installed helper, release, workflow, test, security policy or activation state-machine behavior changes in Phase A. Existing PR435/PR436 remain frozen; publication belongs in a separate reviewed branch.

The new baseline file is 2874 bytes, SHA256 `f91345ecef7efdea485cc914dc18b9baaf1b2a6002501e0a9fcf23bae6301e3e`. The four executable/review builder inputs remain byte-for-byte:

| Builder file | SHA256 |
|---|---|
| `build_candidate.py` | `68f502a20d4f869a7d6e0bd81dab37e174693cd1a673ded195331a832cf47839` |
| `release_contract.py` | `48a7f0ebb53213e38b188af169fab54f6101ccadf478200f1770b36a31198633` |
| `inspect_native.py` | `e310616f618ee63ca27372404e0f6639d01e4235975d0ae35f1aec5921d5a3e7` |
| `compatibility_review.json` | `a6f8eecbb603b82afa578de626df4f1e9af02250434df9a19b58efbbab3dc97a` |

The frozen activation contract intentionally remains unchanged in Phase A. It still binds the old baseline SHA and old `PRODUCT_PLAN` (`7e86513fd831d74d89eb0ab3aaf5ce8f851ec936d5e09a0684516a7eee25cb73`). Therefore it is not a tool for the new builder/package. No guessed replacement PLAN hash or disabled guard is introduced.

## Required order

1. Review and publish the Phase A baseline plus this record on a separate branch. Verify the published bytes. Require successful CI for that exact head before transferring or executing its builder. The existing `.github/workflows/alisa-platform-ci.yml` already watches `economics_composite_r15_release/**` and invokes `tests/test_builder.py`; no new workflow or runner is needed. Documentation and every other applicable existing check must also pass.
2. Transfer the exact five reviewed builder files into a new owned location, preserving all old tooling and receipts. Independently verify all five hashes and the unchanged 96-input product index before invoking the existing builder `plan` command with the full product commit above. Use the existing trusted builder invocation setup: `build_candidate.py` imports its verified sibling `release_contract`; direct isolated-mode script execution without that import setup is not equivalent. Root owns the finite wrapper, resource limits and execution.
3. Preserve the real planner stdout as a new immutable PLAN file, its exit status and safe stderr. The builder must return `PLAN_NOT_BUILT`, `production_deployed=false`, the exact source commit/input map and five tool hashes; its current full snapshot must pass. Derive the new PLAN SHA256 from those exact output bytes, including the final newline. Do not synthesize PLAN by editing an old receipt or by hashing only this metadata proposal. A refusal is retained and diagnosed before retry.
4. Only after that measured PLAN exists, make the Phase B activation source change: replace `BUILD_TOOLS['baseline_20261115.json']` with the new baseline hash and replace `PRODUCT_PLAN` with the actual new PLAN SHA256. Keep `PRODUCT`, `SOURCE_INDEX`, all other builder/helper pins and runtime behavior unchanged. Recompute the four-file activation tool hash from the final bytes; review the exact diff and publish without force.
5. Require the exact final head's applicable CI before installing the new activation tooling. The unchanged activation workflow must still run the source suite and the actual private-directory, native-credential lifecycle, selector consumer and PostgreSQL gates. The accepted a4 evidence was 134 source tests plus 10/15/6/20 gate checks; prior success is not a result for the new head. The final PR's release-path delta may also retrigger the existing platform CI; no path-filter or required-check bypass is proposed.
6. With fresh resource accounting, build a new private candidate bundle from the real PLAN and the same 96 product inputs using the accepted builder, then verify it against its measured PREPARED SHA256. Preserve the old bundle: the retained failed R5 unit still references it. Do not manufacture the new package by overwriting old PLAN/PREPARED bytes. New package construction and its three later publications must each retain the current reserve; do not assume both fit simultaneously from one old free-space sample.
7. Only the resulting exact package, final activation source and fresh coordination/readiness can proceed to a separate activation plan/prepare. Actual apply still requires the existing browser/voice window tied to that plan, tool and package, and all existing readiness guards. A new baseline or successful package does not resolve four UNKNOWN, authorize replay, or grant live admission.

## Verification scope

This proposal was prepared by static source/data comparison only; no tests, product imports, builder PLAN, build, activation command, server mutation or Git write were performed by its author. The existing builder file declares 36 tests, including distinct preserved bases/environment, prepared receipt/inventory checks and independent web unit/process cwd guards. Their current-source execution belongs to Phase A CI. No new test is needed merely to mirror four observed constants, and no existing assertion is weakened.

The prior builder requires exact web pointer and process cwd in `live_references()` before completing `verify_prepared()`. Consequently the old R15 package cannot become compatible by requesting a new activation plan alone: its internal refusal is `LIVE_POINTER_CHANGED:web`, mapped by the activation CLI to `ACTIVATION_DEPENDENCY_UNAVAILABLE`. This source proposal replaces the expected baseline through the reviewed builder process; it does not bypass that boundary.

**Next step:** independently review the exact four-leaf baseline diff and this staged dependency plan, then publish Phase A and obtain exact-head existing CI. The new `PRODUCT_PLAN`, PREPARED identity and activation tool identity remain unmeasured until their respective stages actually run.

