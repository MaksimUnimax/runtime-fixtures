# A04 — WB warehouse sort code-unit determinism successor R2 — 2026-10-04

Status: **SOURCE CANDIDATE — FOCUSED VALIDATION / INDEPENDENT REVIEW PENDING**

Task: `A04-WB-WAREHOUSE-SORT-DETERMINISM-SOURCE-SUCCESSOR-R2-20261004`.

## Defect

Independent review of STD-09 found that equal-unit warehouse ties used JavaScript `localeCompare()` without a pinned locale, so ordering could vary by runtime locale. The same comparator defect was found in the shared `warehouse_sort` calculator and both STD-08 stock aggregation paths.

Historical STD-08 and STD-09 receipts/results are preserved and are not rewritten by this successor.

## Candidate boundary

This candidate changes only:
- `tests/regression/extension-core/business-scenario-coverage.mjs`;
- `tests/regression/extension-core/wb-sales-geography-field-schema-slice.mjs`;
- `tests/regression/extension-core/wb-stock-field-schema-slice.mjs`;
- this receipt.

Warehouse-name ties use explicit ECMAScript string/code-unit ordering:
`a < b ? -1 : a > b ? 1 : 0`.

No Unicode normalization, `Intl.Collator`, default locale, or pinned locale is introduced. Primary sort remains units/on-hand descending.

Each affected validator includes a local equal-unit regression using `Z` and `Ä`; code-unit ordering requires `Z` before `Ä`. Shared business numeric fixtures and the stock fixture are intentionally unchanged.

## Preserved semantics

The candidate does not change sale/return separation, duplicate `saleID` fail-closed behavior, office-directory reference-only semantics, transit exclusion from on-hand stock, seller warehouse ID joins/completeness, `MISSING_NOT_ZERO`, operation mappings, provider contracts, runtime/package/auth/DB/service/live behavior.

## Required verification

Before acceptance:
- the three focused validators must PASS;
- readback must show no warehouse tie path still uses `localeCompare`;
- `git diff --check` must PASS;
- risk-bounded extension-core consumer checks must PASS;
- one independent `gpt-6-luna` exact-candidate review is required;
- publication requires fresh-base compatibility, governed task-publication, five exact-SHA CI, non-force main readback, task-ref cleanup, and lifecycle closure.

Evidence level remains SOURCE only. This successor does not by itself promote historical STD-08/STD-09 live acceptance.
