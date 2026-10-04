# Ozon capability status boundary

Status: **SOURCE TRACEABILITY / LIVE SEMANTIC ACCEPTANCE NOT RUN**.

This document preserves the distinction between the historical Ozon terminal set and the current canonical capability statuses. It exists because a terminal result is not the same thing as an unconditional clean PASS.

## Canonical sources

The boundary is derived from:

- `docs/product/readiness/TEST_PLAN.md`;
- `docs/product/readiness/BUSINESS_SCENARIOS.tsv`.

`TEST_PLAN.md` records that the historical Ozon set grew to 44 terminal results and that this record was followed by:

- CAP-24 being reopened;
- CAP-22 remaining PARTIAL;
- CAP-25 being added separately and remaining IN_PROGRESS.

The TSV is the current row-level source of those statuses.

## Current 45-row taxonomy

The canonical scenario order is:

- STD-01 .. STD-20;
- CAP-01 .. CAP-25.

The source gate recognizes only these status classes:

- `CLEAN_PASS`: exact `PASS`;
- `QUALIFIED_PASS`: `PASS_*`;
- `PARTIAL`: `PARTIAL_*`;
- `REOPENED`: `REOPENED_*`;
- `IN_PROGRESS`: exact `IN_PROGRESS`.

Any unknown status class fails closed.

Current counts are:

- 26 CLEAN_PASS;
- 16 QUALIFIED_PASS;
- 1 PARTIAL — CAP-22;
- 1 REOPENED — CAP-24;
- 1 IN_PROGRESS — CAP-25.

Therefore the current 45-row table is not a 45/45 clean-PASS table.

## Historical terminal 44

The historical terminal set is defined as:

- STD-01 .. STD-20;
- CAP-01 .. CAP-24.

CAP-25 is not part of that historical set.

When the **current** canonical statuses are projected onto those 44 historical IDs, the result is:

- 26 CLEAN_PASS;
- 16 QUALIFIED_PASS;
- 1 PARTIAL — CAP-22;
- 1 REOPENED — CAP-24.

The gate therefore explicitly rejects the interpretation “44 terminal = 44 clean PASS”.

This does not rewrite the historical terminal evidence. It keeps the historical execution fact and later/current status facts as separate dimensions.

## Qualified PASS and guidance gaps

Qualified PASS is intentionally not collapsed into CLEAN_PASS.

The current row whose historical Ozon status explicitly contains `GUIDANCE_GAP` is:

- CAP-16.

It remains `QUALIFIED_PASS`, not `CLEAN_PASS`.

CAP-18 remains `QUALIFIED_PASS` under
`PASS_WITH_PRODUCT_LEVEL_COVERAGE_AND_EXPLICIT_DATA_READINESS_GUIDANCE`.
Its guidance exposes the accepted composite `campaign/product/day` boundary
and distinguishes direct responses from explicit asynchronous report
start/status/download steps without inventing a provider latency duration.

CAP-21 remains `QUALIFIED_PASS` under
`PASS_WITH_RECOVERY_AND_EXPLICIT_DATA_READINESS_GUIDANCE`.
Its guidance exposes the accepted composite `product/search_text` boundary:
`product_queries` is the provider search-fact source, while
`product_content_rating` is own-card content context. Query/frequency/position
are provider facts only when returned; AI-created wording remains separate,
missing provider metrics stay incomplete rather than zero, and the returned
provider set is not advertised as an exhaustive semantic-query universe.
Runtime entitlement/preflight remains authoritative for availability.

Other qualified PASS rows retain their exact boundary/recovery/omission/coverage wording from the canonical TSV; this task does not simplify those statuses.

## CI enforcement

`tests/regression/extension-core/ozon-capability-status-boundary.mjs` reads the canonical TSV and `TEST_PLAN.md` and fails on:

- row count or canonical ID-order drift;
- CAP22/CAP24/CAP25 boundary drift;
- unknown status classes;
- current status-count drift;
- historical-terminal count/taxonomy drift;
- guidance-gap ID drift;
- loss of the historical warning from `TEST_PLAN.md`;
- any collapse of historical terminal count into clean-PASS count.

`business-scenario-coverage.mjs` imports this gate, so the normal core-contracts/Extension CI path enforces it.

## Evidence boundary

This is **SOURCE TRACEABILITY** only.

It does not claim:

- current live Ozon account values;
- live AI usefulness;
- CAP22 completion;
- CAP24 completion;
- CAP25 completion;
- owner semantic acceptance;
- production readiness.

Those remain separate evidence and manual/live gates.
