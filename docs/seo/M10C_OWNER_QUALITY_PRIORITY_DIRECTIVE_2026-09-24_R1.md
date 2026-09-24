# Octoport SEO — M10C owner quality-priority directive — 2026-09-24 R1

Status: **BINDING OWNER EXECUTION PRIORITY FOR REMAINING M10C**

Owner instruction:
`Сильно не надо экономить на запросах, качество важнее. Если есть сомнения в результате — делай запросы.`

## Operational interpretation

Cost minimization is not a decision criterion for skipping evidence that is materially useful.

For every remaining M10C case:
- execute the first accepted snapshot;
- if any decision-relevant uncertainty remains, use the allowed repeat rather than closing solely to save cost;
- treat materially unstable sources, framing, marketplace scope, capability boundary, incomplete citations/body, or conflicting answer roles as reasons to collect additional evidence;
- do not perform blind retries after technical failure or unknown provider outcome;
- do not batch requests merely for convenience;
- persist and independently read back each paid result before deciding the next execution.

## Existing M10B bounded-repeat contract

The accepted M10B case rows currently specify `max_snapshots = 2`.

Owner quality priority changes how aggressively the second snapshot is used; it does not silently erase that accepted bound.

If material doubt remains after two valid snapshots:
```text
DO_NOT_FORCE_CLOSURE_FOR_COST
DO_NOT_ISSUE_AN_UNGOVERNED_THIRD_REQUEST
MAIN_CHAT_MUST_RECORD_A_BOUNDED_CASE_AMENDMENT
THEN_ADDITIONAL_PROVIDER_EVIDENCE_MAY_BE_RELEASED_IF_JUSTIFIED
```

This keeps quality above cost while preserving exactly-once provider accounting and durable authority.

## Applicability

Applies prospectively to all remaining M10C diagnostic cases and to any reopened case whose additional information gain is specifically documented.

Does not retroactively change already accepted raw evidence.