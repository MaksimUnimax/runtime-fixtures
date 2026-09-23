# Octoport SEO — M4Q R2 Pass A2 query-authority correction gate

Date: 2026-09-23
Status: PREPARED / FULL-VOLUME WORK CORRECTION REQUIRED
WORK_ID: `OCTOPORT_SEO_M4Q_R2_QUERY_MANIFEST_2026-09-23_R2`
Repository: MaksimUnimax/runtime-fixtures
Branch: seo/wordstat-batch-01-2026-09-16
Preparation base HEAD: 75fd8d5bbb153991a3b322192d934839b4f9fc48

## Purpose

Correct only the semantic admission defect found by Main Chat in Pass A R1.

Do not redo provider acquisition: none occurred.

Do not discard the mechanically valid R1 accounting work.

Re-evaluate the complete 15,542-row query universe under an explicit query-authority hierarchy.

## Frozen authority

Use:
`M4Q_R2_QUERY_MANIFEST_CORRECTION_AUTHORITY_2026-09-23_R2.tsv`

Expected frozen rows = 24.

## Main Chat correction authority

Read:
`M4Q_R2_PASS_A_R1_MAIN_CHAT_QA_2026-09-23.md`

Its query-authority hierarchy is binding for Pass A2.

## Query-authority rule

An executable Yandex Search query MUST have at least one of:

```text
M3_EXACT_QUERY_AUTHORITY
M2R_OBSERVED_WORDSTAT_QUERY_AUTHORITY
```

Pure M4C competitor-derived wording is not sufficient.

```text
M4C_PAGE_HEADING
M4C_CANDIDATE_TERM
M4C_M6_GROUP
```

without an exact-safe M2R/M3 authority match must not enter the provider execution manifest.

## M2R rule

M2R is observed demand/query evidence but not an automatic Search authorization.

Re-evaluate:
- evidence_type;
- fit_class;
- contamination_flags;
- capability_state;
- observed_vs_inferred;
- marketplace/task family;
- information gain.

Association-only/contaminated/boundary phrases require explicit justification or a non-execution disposition.

## New allowed disposition

Add:

`DEFER_TO_M6_DEMAND_VALIDATION`

Meaning:
competitor-derived wording remains potentially useful, but it has no independent query/demand authority for M4Q R2 provider execution.

This status is not a rejection of the topic and not a zero-demand claim.

## Hard gates

```text
SOURCE_UNIVERSE_ROWS = 15542
ALL_SOURCE_ROWS_REACCOUNTED = 15542/15542
SILENT_SOURCE_LOSS = 0

M3_ROWS_ACCOUNTED = 15/15
M2R_ROWS_ACCOUNTED = 1123/1123
M4C_CANDIDATE_ROWS_ACCOUNTED = 8431/8431
M4C_M6_GROUP_ROWS_ACCOUNTED = 5973/5973

EVERY_EXECUTION_QUERY_HAS_QUERY_AUTHORITY = true
PURE_M4C_ONLY_EXECUTION_QUERIES = 0
EXECUTION_QUERY_EXACT_DUPLICATES = 0
SYNTHETIC_QUERIES_CREATED = 0

M2R_CONTAMINATION_FIELDS_REVIEWED = true
M2R_ASSOCIATION_ONLY_EXECUTION_ROWS_HAVE_EXPLICIT_INFO_GAIN = true

PROVIDER_CALLS = 0
YANDEX_SEARCH_EXECUTION = 0
WEB_ACQUISITION_BY_WORK = 0

FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
COMPETITOR_TOPIC_AS_PROVEN_DEMAND = 0
OPEN_CRITICAL_DEFECTS = 0
```

## Outputs

Exactly six corrected outputs:

1. M4Q_R2_SOURCE_MANIFEST_R2.md
2. M4Q_R2_QUERY_UNIVERSE_LEDGER_R2.tsv
3. M4Q_R2_SEARCH_EXECUTION_MANIFEST_R2.tsv
4. M4Q_R2_BATCH_PLAN_R2.tsv
5. M4Q_R2_QA_R2.md
6. M4Q_R2_RETURN_MANIFEST_R2.json

## Publication

Work writes nothing to GitHub.

Return one ZIP containing exactly the six outputs.

Owner uploads unpacked files to:

`docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/`

Provider execution remains blocked until Main Chat remote-readback and acceptance.
