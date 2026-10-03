# B06 GitHub publication gate Phase 2 source — 2026-10-03

Task: `B06-GITHUB-PUBLICATION-GATE-PHASE2-SOURCE-20261003`

## Scope

This change implements the reviewed Phase-2 **source gate only**. It does not enable branch protection, a repository ruleset, a required status check on `main`, pull-request-only publication, a merge queue, signed-commit enforcement, or any bypass actor.

The existing governed publication route remains a direct non-force fast-forward from an exact task-publication candidate after its current CI checks.

## Gate identity

The Coordination workflow adds one job/check named:

`octoport-publication-gate`

It runs only for `push` events whose `github.ref_name` begins with `controller/task-publication/`.

The gate has a direct local dependency on the existing `safety` job in the same workflow. It does **not** poll the final result of the Coordination workflow, avoiding a self-cycle.

The gate polls only these canonical external workflow identities:

- Server CI — .github/workflows/server-ci.yml
- Extension CI — .github/workflows/extension-ci.yml
- Extension I1-C1 client — .github/workflows/extension-i1-ci.yml
- Documentation CI — .github/workflows/documentation.yml

Every accepted run must match the exact display name, canonical workflow path, github.sha, task-publication github.ref_name, and event=push. The GitHub Actions response must also bind both repository.full_name and head_repository.full_name to MaksimUnimax/runtime-fixtures. A same-name run from a missing/unexpected workflow path or repository identity fails closed and cannot fill a required slot.

## Permissions and credentials

The gate job grants only:

- `contents: read`
- `actions: read`

It uses the GitHub-provided `github.token` through `GITHUB_TOKEN`. The script has no anonymous fallback and never prints the token, Authorization header, response headers, or raw API error bodies.

The GitHub REST API version is pinned to `2022-11-28`.

## Fail-closed run selection

For each required external workflow there must be exactly one distinct matching `run_id`.

A GitHub rerun of that same `run_id` with a higher `run_attempt` is allowed and the highest attempt is authoritative. Multiple distinct matching run IDs are rejected as ambiguous.

Missing, queued, in-progress, failed, cancelled, skipped, neutral, stale, malformed, or indeterminate evidence never becomes PASS.

## Bounded acquisition

- GitHub job timeout: 55 minutes.
- Internal deadline: 50 minutes.
- Poll interval: 20 seconds.
- API pagination: 100 rows/page, maximum 10 pages.
- Per-request timeout: at most 20 seconds and recomputed before every page so it never exceeds the then-remaining internal deadline.
- After every API fetch, the monotonic deadline is re-checked before PASS can be accepted; a response arriving at or after the deadline fails closed.
- Network errors, HTTP 429 and HTTP 5xx may retry only inside the deadline.
- HTTP 401/403, malformed payloads, invalid repository/SHA/ref identity, wrong/missing canonical workflow path, mismatched run repository/head-repository identity, and pagination overflow fail immediately.
- `Retry-After` / `X-RateLimit-Reset` waits are honored only when they fit inside the deadline; otherwise the gate fails closed.
- Error output uses stable sanitized codes rather than raw response material.

## Enforcement boundary

This task is not authorization to protect `main`.

Before the unique check can be required on `main`, the accepted B06 design still requires source and canary evidence, including docs/product candidates, missing/failed workflow behavior, rerun/ambiguity behavior, rate-limit/API errors, and a temporary protected canary branch proving that the existing direct-push publication route is accepted only when the exact SHA already has the successful gate check.

The gate proves exact-SHA CI state. It does **not** prove that a particular actor used Octoport `task_publication`; actor provenance remains separate future hardening.

## Acceptance evidence

Focused and full coordination tests, exact candidate review, task-branch canary, five required CI workflows, governed publication, main readback, and post-main CI are recorded in the operational task evidence under `/root/octoport-control/logs/A/`.

Evidence level: `SOURCE_AND_TASK_BRANCH_CANARY` only until the later protected-canary/admin phases are separately accepted.
