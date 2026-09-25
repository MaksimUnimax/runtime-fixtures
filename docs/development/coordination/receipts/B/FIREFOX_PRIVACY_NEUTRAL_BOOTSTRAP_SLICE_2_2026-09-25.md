# Firefox privacy-neutral bootstrap — B slice 2

Date: 2026-09-25
Role: B
Task: FIREFOX_PRIVACY_NEUTRAL_BOOTSTRAP_SLICE_2
Status: SOURCE + DISPOSABLE POSTGRESQL CANDIDATE; NOT LIVE / NOT DEPLOYED

## Authority and base

- Shared contract authority: `docs/development/coordination/FIREFOX_PRIVACY_NEUTRAL_CONTRACT_2026-09-25.md`.
- B slice start HEAD: `7fc52da28791f191b7b03694bc79179d6e561597`.
- Fresh canonical main observed before finalization: `7945d62854e135421c3db003c603187b9f37866b`; it is already an ancestor of the B branch.
- No shared Zod/OpenAPI route contract, package manifest, migration, live DB, service, production or store action is changed by this slice.

## Implemented B-owned boundary

- Adds `LocalClientAuthorityMaterializer` for privacy-neutral `control_plane_v2` source materialization without extension/browser/version request inputs.
- Compatibility authority includes the deterministic newest 64 published releases with their contract/browser support facts.
- Linked compatibility sources are bounded to 32 policy revisions and 128 blocked versions per revision; malformed or duplicate source fails closed.
- Feature authority reuses existing account/device rollout selection and produces one selected source rule per feature; more than 128 linked feature keys or corrupt rollout source fails closed.
- AI authority reuses the existing one-statement P7 hierarchy/assignment/profile repository and materializes at most one candidate per applicable published browser-family assignment.
- Local AI candidate materialization deliberately defers browser/extension compatibility checks while preserving published profile identity, content fingerprint and compatibility object for the client-side signed check.
## Existing semantics preserved

- Identified server-side bootstrap resolver remains unchanged in behavior and continues to evaluate compatibility/features from client software inputs.
- Config release selection for `control_plane_v2` remains ordinary latest, matching the accepted existing resolver.
- Feature cohort selection calls the existing `selectRolloutCandidateV1`; no second hash/bucket algorithm is introduced.
- Profile rollout selection calls the existing `selectAssignedProfileRevision`; no second assignment algorithm is introduced.
- Repository release-support projection uses explicit enum-to-text aggregation so PostgreSQL enum arrays cannot silently break the authority reader.
- All corruption and bound checks return a fail-closed materializer failure; no list is truncated except the contract-authorized newest-64 release window.

## Verification

Node 24.20.0 / pnpm 10.34.5.

Final static scope:
- Prettier: PASS.
- ESLint: PASS.
- `git diff --check`: PASS.

Final supervised typecheck/unit:
- `@product/bootstrap typecheck`: PASS.
- `@product/remote-config typecheck`: PASS.
- `@product/db typecheck`: PASS.
- `@product/bootstrap test`: 60/60 PASS.
- `@product/remote-config test`: 53/53 PASS.
- resource job: `26751b54a1d64a16bcd293af46e7389c`
- log: `/root/octoport-control/logs/B/firefox-privacy-bootstrap-s2-final-static-unit-20260925.log`
- exit 0; OOM 0; cleanup verified.
Disposable PostgreSQL bootstrap authority acceptance:
- `tests/integration/server/p3-4-bootstrap.integration.test.ts`: 14/14 PASS.
- Proves legacy identified bootstrap remains green, metadata-free materialization, newest-64 ordering, account/device feature rollout selection, >32 policy fail-closed, >128 feature fail-closed, >128 blocked-version fail-closed and malformed linked policy fail-closed.
- resource job: `5181c8949d1d4d45bd016bcf726779cf`
- log: `/root/octoport-control/logs/B/firefox-privacy-bootstrap-s2-p3-4-r3-20260925.log`
- exit 0; OOM 0; cleanup verified.

Disposable PostgreSQL AI candidate acceptance:
- `packages/server/db/src/p7.3-bootstrap-ai.integration.test.ts`: 7/7 PASS.
- Includes family-scoped candidate materialization without client software metadata and one-statement coherence under a competing PostgreSQL mutation.
- resource job: `251f391211514617acaa51cc98a1a232`
- log: `/root/octoport-control/logs/B/firefox-privacy-bootstrap-s2-p7-3-20260925.log`
- exit 0; OOM 0; cleanup verified.

## Non-acceptance attempts

- An earlier focused combined gate exited 134 with OOM-kill=0 under an undersized 642 MiB estimate; the same typechecks and units passed under the corrected 2048 MiB supervised limit.
- The first PostgreSQL draft exposed an enum-array/text-array SQL mismatch and two invalid test-harness assumptions. The accepted reruns above are the evidence; failed attempts are not acceptance evidence.

## Handoff to C

C still owns shared schemas/OpenAPI, request-shape negotiation, signed `bootstrap_snapshot_v2` wire integration, envelope-size enforcement at the final payload boundary, HTTP route behavior and server-first integration/CI.
B has not claimed browser/Firefox acceptance, live migration, deploy, immutable artifact rollback or production readiness.
