# S2-L7 H4/H5 candidate/canary evaluation foundation R1

Status: `IMPLEMENTED_CANDIDATE`; architect acceptance is not claimed.

## A. Preflight and ancestry

This bounded slice started from the accepted local S2-L6 incident head:

- commit: `44954d71d28257d885feaa270526abcf72fb04e3`
- tree: `41276bdbbd8c38694510d3fd7690a2e93c5bfb4f`
- parent: `43f7e0fac056ce3aab40a092ba66e8857c8bc25b`
- branch: `feature/stream2-l7-h4-h5-foundation-r1-2026-09-18`

The accepted scheduler correction `75011e57127629bad4369878d8e53f4cbe7911ac`,
L5B head `da779208e4897932f3ec2827f16ba8c726be38f3`, and L5A head
`c289534c94063ab72d812e48506668ad008f0cfd` remain in ancestry. `git fetch --all
--prune` was run. Remote verification was `origin/main=
bc718cc5c677ad0eb4598e7de3ad766473ff0847` and
`origin/integration/i1-c1-srv5-2026-09-16=
23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.

The user worktree contained unrelated dirty Stream-1 work and was not edited.
The active S2-L6 worktree was clean; the new branch uses its exact accepted
head. All visible local worktrees were inspected before selecting migration
`0021`; the highest accepted Health/S2-L6 migration was `0020`, with no
collision found.

Toolchain used for validation: Node `v24.20.0`, pnpm `10.34.5`, PostgreSQL
`18.0`, using the repository-local disposable container on loopback port
`55432`.

## B. Existing authority audit

| Area | Finding | Classification |
| --- | --- | --- |
| P7 adapter/profile lifecycle | P7 owns DRAFT/CANDIDATE/PUBLISHED/RETIRED, publication, assignments, rollout, pause/resume, completion, and rollback | KEEP; Health only reads identities |
| H0 | `validateH0ProfileCandidate` parses the persisted P7 schema, requires `CANDIDATE`, validates content, and checks the fingerprint | KEEP; H4 reuses it |
| H1/H2/H3 classifier | Existing six-state classifier and contour/fallback semantics | KEEP; H4/H5 consume results |
| H4 evaluation | No existing model or persistence | ADD in `packages/server/health/src/evaluation.ts` |
| H5/canary | No existing model, signal, or persistence | ADD in the same Health-owned contract |
| Candidate-vs-baseline result storage | No existing suitable table | ADD `health_profile_evaluations` |
| Availability restriction | No existing Health restriction authority | ADD non-executing typed recommendation |
| Rollback signal | No existing Health signal | ADD non-executing H5 recommendation |
| Current-vs-candidate admin read model | Not present | DEFER to the later bounded admin task |
| Incidents | S2-L6 `health_incidents` is the sole lifecycle authority | KEEP; no incident table or competing lifecycle |

No product profile lifecycle or browser runner was duplicated.

## C. H4 candidate evaluation

The deterministic logical identity is the SHA-256 of canonical identity fields:

`provider`, `surface`, `target`, `variant`, monitoring layer, exact baseline and
candidate profile revision IDs, Health suite machine key/revision, phase,
browser family/version, and controlled environment class.

Phases are `H4_CANDIDATE`, `H5_CANARY`, and `H5_POST_ROLLOUT`. Execution/run
UUIDs are evidence references only and are never part of the logical key.

H4 accepts a candidate only through the existing H0 boundary. A non-candidate,
fingerprint mismatch, schema violation, executable profile field, or wrong
revision identity yields `INVALID_CANDIDATE`. A target with no legitimate
product candidate can be represented as `NOT_APPLICABLE` with readiness states:
`PROFILE_CANDIDATE_AVAILABLE`, `NO_PRODUCT_PROFILE_AUTHORITY`,
`CANDIDATE_NOT_PRESENT`, `NOT_OBSERVABLE_IN_THIS_LAYER`, and
`SESSION_REQUIRED_FOR_DEEP_EVALUATION`.

Baseline and candidate observations must match provider, surface, target,
variant, monitoring layer, browser family and exact browser version, environment
class, suite machine key/revision, and their exact profile revision IDs. Any
uncertainty is fail-closed as `INCONCLUSIVE`; an explicit environment-uncertain
contour produces `ENVIRONMENT_BLOCKED`. No-session observations are supported
without authenticated sessions.

The result vocabulary is `PASS`, `FAIL`, `INCONCLUSIVE`,
`ENVIRONMENT_BLOCKED`, `INVALID_CANDIDATE`, and `NOT_APPLICABLE`. `PASS`
requires a comparable baseline/candidate pair, positive candidate evidence, and
no contour regression. Candidate success does not publish, activate, or roll
out a profile.

The complete state matrix is explicit in `H4_COMPARISON_MATRIX`:

| Baseline \ Candidate | HEALTHY | DRIFT | DEGRADED | BROKEN | UNKNOWN | MAINTENANCE |
| --- | --- | --- | --- | --- | --- | --- |
| HEALTHY | PASS | FAIL | FAIL | FAIL | INCONCLUSIVE | INCONCLUSIVE |
| DRIFT | PASS | INCONCLUSIVE | FAIL | FAIL | INCONCLUSIVE | INCONCLUSIVE |
| DEGRADED | PASS | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| BROKEN | PASS | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| UNKNOWN | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| MAINTENANCE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |

`MAINTENANCE` is never interpreted as candidate quality or regression. A
non-healthy baseline is not hidden: only a positively proven healthy candidate
can pass the improvement rows, and equal/non-healthy outcomes remain
inconclusive.

H4 also compares every contour. A required contour changing from pass to drift,
degraded, broken, or unknown is a regression; a critical contour regression
wins over aggregate improvement. Fallback-selected behavior is preserved in
the contour semantics, and page identity is compared as its own contour.
Evidence is limited to existing safe evidence references. Raw DOM, response
content, profile payloads, and secrets are not stored.

The bounded repeatability policy is configurable and schema-validated: required
successful comparable executions `1..8`, maximum environment-inconclusive
executions `0..8`, and maximum regression executions `0..8`. The default is one
positive comparable execution, zero allowed environment-inconclusive executions,
and zero regression executions. `aggregateH4Executions` performs no unbounded
retry.

## D. H5 canary and post-rollout evaluation

H5 requires the product-owned observed revision to be `PUBLISHED`; Health never
starts the rollout. H5 canary consumes control/baseline and candidate/canary
observations under the same frozen identity rules.

Canary recommendations are:

- `CONTINUE`: candidate is healthy and no worse on comparable contours;
- `HOLD`: candidate is drifted and evidence is insufficient to increase rollout;
- `RESTRICT`: a bounded compatibility problem is proven, but not necessarily a
  global product failure;
- `ROLLBACK_RECOMMENDED`: a strong core regression is proven;
- `INCONCLUSIVE`: environment, maintenance, or comparability prevents reliable
  comparison.

The H5 result always includes `executionAuthority=false`. A canary signal never
changes rollout percentage, pause/resume state, assignment mode, profile state,
or assignment revision.

`H5_POST_ROLLOUT` consumes the P7 current/published identity truthfully and
reports `STABLE`, `REGRESSION`, `RECOVERED`, or `INCONCLUSIVE`. A post-rollout
identity is distinct from the old canary identity; an in-flight old canary
observation cannot become a post-rollout mutation.

## E. Restriction and rollback signal contracts

The Health restriction signal contains provider, surface, exact profile revision,
browser family, exact observed browser version, target, reason, evaluation key,
optional incident reference, severity, safe evidence references, and `issuedAt`.
It contains `recommendation=RESTRICT` and `executionAuthority=false`.

The version guard rejects a caller-provided broader range than the exact
observed version. Provider, surface, profile revision, and browser-family
mismatches are rejected by `assertSignalAppliesTo`. Therefore Chrome evidence
cannot restrict Firefox, a Work surface cannot restrict Standard, and an old
candidate signal cannot apply to a newer candidate revision. Rollback
recommendations reference the exact evaluation and its Health execution/evidence
scope; Health never calls `rollbackProfileAssignment`.

## F. Incident integration

H4/H5 results reference safe Health executions and may carry the existing
S2-L6 incident reference in an external signal. They do not create a second
incident table or deduplication identity. Candidate evidence can demonstrate a
candidate improvement, but it cannot resolve a production incident. Production
recovery remains owned by the actual current-profile Health run and the existing
S2-L6 lifecycle authority. No undocumented automatic transitions among
`CANDIDATE_FIX`, `CANDIDATE_PASS`, `CANARY_ROLLOUT`, or `ROLLOUT` were added.

## G. Persistence and migration

Migration `0021_s2_l7_h4_h5_evaluations.sql` is additive. It adds the phase and
status enums and `health_profile_evaluations`, keyed by a unique deterministic
evaluation SHA-256. The row stores bounded identity columns, exact profile
revision references, suite/browser/environment authority, outcome/recommendation,
safe result JSON, first/latest execution IDs, and first/latest timestamps. Raw
profile payloads and raw browser/provider content are not stored.

The repository uses PostgreSQL uniqueness for concurrent logical creation. The
newest update wins by `(evaluatedAt, executionId)`; stale replay returns the
newest row without changing it. Exact profile and suite revisions are frozen in
the logical identity, so a changed candidate or suite creates a separate
authority. JSON date hydration is validated on readback.

Real PostgreSQL tests prove migration survival of existing scheduler/profile
rows, duplicate idempotency, stale-update rejection, and independent-connection
concurrent creation. Existing S2-L6 scheduler, incident lifecycle, and incident
migration tests were rerun against PostgreSQL 18.

## H. Test and gate evidence

- H0 plus full Health domain: `118/118` focused Health tests pass;
- Health typecheck: pass;
- DB typecheck: pass;
- DB unit tests: `12/12` pass;
- H4/H5 PostgreSQL evaluation persistence: `4/4` pass;
- S2-L6 scheduler PostgreSQL regression: `17/17` pass;
- S2-L6 incident lifecycle PostgreSQL regression: `7/7` pass;
- S2-L6 incident migration PostgreSQL regression: `2/2` pass;
- PostgreSQL version: `18.0`;
- authenticated sessions provisioned: `0`;
- real LLM calls: `0`;
- real Send count: `0`.

Repository-wide recursive tests, recursive typecheck, Health-runner/API/worker/
portal/admin builds, lint, format, docs, bridge, and diff checks passed. The
repository integration command was also run with the repository's sequential
integration configuration; suites requiring additional opt-in flags remained
skipped by their existing guards.

## I. Boundaries and privacy

Changed production paths are limited to `packages/server/health/**`,
`packages/server/db/**`, the additive DB migration, and this Stream-2 document.
The one-line explicit `connectionString!` correction is in the existing
S2-L6 migration integration fixture and changes no runtime authority. No
`apps/extension/**`, control-client, bridge-core, marketplace, auth/bootstrap,
Work runtime, dispatch/replay, rare-sync, product adapter, rollout, or release
path was modified. No shared P7 contract was mutated.

The stored/signal schemas allow only opaque IDs, content SHA-256 values, schema
versions, declarative field paths, suite/environment identifiers, and safe
evidence references. No cookies, storage state, auth headers, passwords, OTPs,
session handles, private conversation IDs, seller data, raw DOM, or assistant
content are persisted or emitted.

## J. Deferred boundary and next step

The final admin UI and current-vs-candidate read surface are intentionally
deferred. The next bounded S2-L7 step should add minimal read-only Health/admin
visibility for the persisted baseline, candidate, evaluation, incident,
recommendation, evidence references, and timestamps, followed only if required
by the architect audit by a separate P7 availability-hook integration task.

Known deferred items remain only:

- `ENVIRONMENT_DEFERRED`: Stream-2 publication credentials;
- `ENVIRONMENT_DEFERRED`: provisioned technical LLM sessions for future
  authenticated live validation;
- `ENVIRONMENT_DEFERRED`: Ozon/WB S2-A1 public-document access protection.

No profile is published, activated, rolled out, restricted, paused, resumed,
completed, or rolled back by this foundation.
