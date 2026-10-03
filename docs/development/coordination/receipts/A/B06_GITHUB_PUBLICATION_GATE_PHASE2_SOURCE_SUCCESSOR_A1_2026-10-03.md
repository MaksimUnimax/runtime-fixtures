# B06 GitHub publication gate Phase2 source successor A1 — 2026-10-03

## Scope

Fresh-main successor to published ed9ea6e4 after later live and reproduction evidence invalidated its Phase2 enforcement eligibility. This result changes only the Phase2 workflow/gate implementation, tests, and this receipt. It does not enable branch protection, rulesets, required checks, repository visibility changes, bypass actors, or product/live runtime behavior.

## Required-check semantics

- The exact future required context `octoport-publication-gate` is named only when the event is `push` **and** the ref is `controller/task-publication/**`. A workflow-dispatch run on a task-like ref gets only the distinct not-applicable name.
- Non-task refs use the distinct check name `octoport-publication-gate-not-applicable`.
- On task refs the gate job uses `always()` after `safety`; when `needs.safety.result != success`, it fails before checkout or REST polling.
- Successful task-ref execution retains `contents: read` and `actions: read`, exact repository/head-repository/SHA/ref/push identity, run-id/attempt disambiguation, bounded pagination and deadline checks.

## Rate-limit semantics

- HTTP 429 is rate-limit evidence; when no stronger retry/reset delay exists, the bounded retry default is 60 seconds.
- HTTP 403 is rate-limit only after identity proof: primary proof is numeric-zero `X-RateLimit-Remaining`; secondary proof is a bounded parsed JSON `message` explicitly identifying GitHub secondary rate limiting. `Retry-After` by itself is delay metadata, not proof.
- Primary `X-RateLimit-Remaining: 0` uses valid `Retry-After` / reset metadata when present and otherwise a bounded 60-second default.
- Secondary-rate-limit 403 reads at most 16 KiB of error body, then uses valid `Retry-After` / reset metadata when present and otherwise a bounded 60-second default.
- Ordinary 401/403 remains `AUTH_OR_PERMISSION` fail-closed.
- Raw HTTP error body/message is never included in exception/result text.
- A rate-limit delay that cannot fit the internal deadline returns `RATE_LIMIT_DEADLINE`; network/5xx retain generic transient backoff.

## Verification

- Focused publication-gate suite: 29/29 PASS.
- Full coordination unittest discovery: 445 PASS with 7 documented skips.
- Resource-runner suite: 17 PASS with 7 documented skips.
- Release-safety: 42/42 PASS.
- Browser-proof: 1/1 PASS.
- Documentation check, py_compile and git diff --check: PASS.
- Workflow YAML parse: PASS.

## Preserved boundary

Phase2 remains source/canary work only. No task-publication actor provenance claim is added. Phase1 owner/admin decision remains separate. GitHub admin enforcement stays disabled until fresh source plus live task/non-task/failing-safety/protected-canary evidence is accepted.
