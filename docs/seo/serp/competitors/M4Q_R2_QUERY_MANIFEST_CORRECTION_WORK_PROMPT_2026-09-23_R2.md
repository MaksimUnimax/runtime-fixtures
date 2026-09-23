# M4Q R2 — canonical ChatGPT Work Pass A2 query-authority correction prompt

WORK_ID: OCTOPORT_SEO_M4Q_R2_QUERY_MANIFEST_2026-09-23_R2

CONTINUE THE EXISTING OCTOPORT SEO PROGRAM.

THIS IS A CORRECTIVE EXECUTION TASK.
THIS IS M4Q R2 PASS A2 ONLY.

THIS IS NOT A NEW PROJECT.
THIS IS NOT PROVIDER EXECUTION.
THIS IS NOT YANDEX SEARCH ACQUISITION.
THIS IS NOT WORDSTAT ACQUISITION.
THIS IS NOT M5.
THIS IS NOT M6 EXECUTION.
THIS IS NOT FINAL VISIBILITY-MATRIX BUILD.
THIS IS NOT CLUSTERING OR PAGE OWNERSHIP.

Repository:
MaksimUnimax/runtime-fixtures

Branch:
seo/wordstat-batch-01-2026-09-16

## 0. First action — live preflight

Fetch the live branch and record START_HEAD.

Read in full:

- docs/seo/LEVEL1/README.md
- docs/seo/EXECUTION_RULES.md
- docs/seo/WORK_HANDOFF_RULE.md
- docs/seo/QUALITY_FIRST_RESOURCE_RULE.md
- docs/seo/PRODUCT_TRUTH.md
- docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md
- docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md
- docs/seo/serp/competitors/M4Q_R2_QUERY_MANIFEST_CORRECTION_AUTHORITY_2026-09-23_R2.tsv
- docs/seo/serp/competitors/M4Q_R2_PASS_A_R1_MAIN_CHAT_QA_2026-09-23.md
- docs/seo/serp/competitors/M4Q_R2_QUERY_MANIFEST_CORRECTION_GATE_2026-09-23_R2.md
- all six R1 Work-return files under:
  docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R1/
- docs/seo/serp/competitors/M4_PROGRESS.md

Verify all 24 frozen blobs in the correction authority manifest.

If any required frozen blob differs materially:
VERDICT = HOLD_AUTHORITY_DRIFT
and stop.

## 1. Purpose

R1 passed mechanical accounting but failed Main Chat semantic admission QA.

R1 wrongly allowed pure competitor-derived page/content wording to become Yandex Search provider commands without independent query authority.

Correct this over the COMPLETE 15,542-row universe.

Do not preserve R1 SEARCH_REQUIRED merely because R1 selected it.

Do not manually delete only the examples named by Main Chat.

Apply the corrected rule globally.

## 2. What remains valid from R1

R1 mechanical properties are accepted as baseline:

SOURCE_UNIVERSE_ROWS = 15542
UNIQUE_UNIVERSE_IDS = 15542
ALL_ROWS_FIXED_WIDTH = true
SILENT_SOURCE_LOSS = 0
SOURCE_PROVENANCE_JOINS = PASS

R1 output may be reused as a lossless starting ledger.

But every execution-related semantic disposition must be independently re-evaluated.

## 3. Binding query-authority hierarchy

### Tier A — M3 exact Search authority

An exact accepted M3 query is a real accepted Search query.

Query authority:
M3_EXACT_QUERY_AUTHORITY

It may be:
SEARCH_REQUIRED_CONTROL_REFRESH

when current top-100/current-date visibility adds information.

All 15 M3 queries must be explicitly accounted.

### Tier B — M2R observed Wordstat phrase

An exact phrase observed in accepted M2R Wordstat evidence has demand/query evidence.

Query authority:
M2R_OBSERVED_WORDSTAT_QUERY_AUTHORITY

It is NOT automatically executable.

Before SEARCH_REQUIRED, re-evaluate from ORIGINAL M2R ledger fields:

- raw_phrase
- evidence_type
- observed_count
- seed_total_count
- marketplace_scope
- task_family_primary
- task_family_secondary
- intent_class
- fit_class
- contamination_flags
- capability_state
- observed_vs_inferred
- lineage_notes
- reconciliation_reason

A Tier-B query can execute only if:
1. exact text remains source-observed;
2. product/task fit is material;
3. contamination does not make the current Search call misleading or wasteful;
4. current top-100 visibility among the 60 competitors can change a named decision;
5. provider limits pass.

Examples that require adversarial review, not automatic acceptance:
- FNS/accounting/statutory-report wording;
- human-role/hiring terms;
- buyer-navigation terms;
- odd brand/entity associations;
- marketplace/external-intelligence phrases beyond confirmed product scope;
- association-only noise.

ASSOCIATION != AUTOMATIC SEARCH AUTHORITY FOR EXECUTION.

EMPTY_SUCCESS_SEED != POSITIVE DEMAND.
It may still be a named Search control only when a concrete information-gain question exists.

TOTALCOUNT_ONLY_SEED must retain its evidence limitation.

### Tier C — pure M4C competitor-derived wording

A row whose only query source is:
- M4C candidate occurrence;
- M4C M6 group;
- competitor page/title/heading/content wording;

and which has NO exact-safe M2R or M3 query authority is NOT directly executable in this M4Q R2 Search pass.

This is true even if:
- it looks like a natural-language query;
- Yandex would probably return results;
- the competitor topic is relevant;
- it occurs many times in competitor pages.

Use the best applicable non-execution status:

DEFER_TO_M6_DEMAND_VALIDATION
NO_INCREMENTAL_SEARCH_INFORMATION_GAIN
NOT_A_PLAUSIBLE_SEARCH_QUERY
OUT_OF_PRODUCT_SCOPE
HOLD_AMBIGUOUS
PROVIDER_LIMIT_INVALID

If such a Tier-C source row exact-safe matches a Tier-A/Tier-B execution query, preserve its provenance using:
EXACT_DUPLICATE_OF_EXECUTION_QUERY

with the real execution query ID.

## 4. Core boundary

Enforce:

COMPETITOR_PAGE_HEADING != QUERY_AUTHORITY
COMPETITOR_TOPIC != PROVEN_DEMAND
M4C_M6_GROUP != YANDEX_SEARCH_COMMAND
SEARCH_RESULTS_EXIST != DEMAND_PROOF

A Search API response to a competitor article title does not convert that title into a meaningful search-demand query.

## 5. New disposition

Add exactly:

DEFER_TO_M6_DEMAND_VALIDATION

Definition:
competitor-derived wording may contain useful semantic information, but lacks M3/M2R query authority for this M4Q R2 provider lane.

This status means:
- not rejected;
- not zero demand;
- not provider-ready;
- preserved for M6 information-gain/demand-validation routing.

## 6. Full-volume reclassification

Reclassify all 15,542 universe rows.

Required source accounting:

M2R = 1123/1123
M3 = 15/15
M4C candidate occurrences = 8431/8431
M4C M6 groups = 5973/5973

No source row may disappear.

Every row gets one terminal Pass-A2 preparation status.

## 7. Query identity

Keep R1 exact-safe identity rule:

Unicode NFC
-> trim outer whitespace
-> collapse internal whitespace
-> Unicode case-fold/lowercase

Do not:
- stem;
- lemmatize;
- synonym merge;
- translate;
- rewrite;
- fix spelling;
- invent a shorter query;
- strip headline punctuation to manufacture a query.

Exact executable query text must remain an observed exact phrase from M3 or M2R.

## 8. Execution eligibility hard gate

Every final execution query must include a new field:

query_authority_class

Allowed executable values only:

M3_EXACT_QUERY_AUTHORITY
M2R_OBSERVED_WORDSTAT_QUERY_AUTHORITY
M3_AND_M2R_QUERY_AUTHORITY

Forbidden in execution manifest:

M4C_ONLY
COMPETITOR_DERIVED_ONLY
NO_QUERY_AUTHORITY

Hard assertions:

EVERY_EXECUTION_QUERY_HAS_QUERY_AUTHORITY = true
PURE_M4C_ONLY_EXECUTION_QUERIES = 0

## 9. M2R adversarial review

Do not inherit current R1 execution IDs as proof.

Re-check every M2R phrase that would become provider-ready.

At minimum explicitly test for:

- accounting/tax/FNS/statutory-report contamination;
- human analyst/assistant/job/vacancy contamination;
- buyer-side marketplace navigation;
- unrelated brands/entity associations;
- generic AI noise;
- image/infographic-only adjacent intent;
- autobidder/real-time mutation scope;
- external market/competitor/niche intelligence beyond product authority;
- exact phrase that is observed but whose Search visibility cannot change an Octoport decision.

If contaminated but still useful as a deliberate control, state the exact control question and downstream decision.

Otherwise do not execute.

## 10. Information-gain gate

Every final execution query must have a query-specific information gain statement.

Generic repeated wording such as:
"Does any competitor rank?"
is insufficient by itself when no downstream decision changes.

For each query record:
- why this exact query matters;
- what current Search could change;
- which M4Q/M4C/M6 decision it affects;
- why existing M3/M2R evidence is insufficient;
- stop interpretation.

Controls may share a standardized template only where the same exact decision class genuinely applies.

## 11. Provider planning

No provider calls.

For each accepted provider-ready query preserve desired settings:

SEARCH_TYPE_RU
region 225
page 0
planned depth 100
GROUP_MODE_FLAT
docsInGroup 1
FAMILY_MODE_MODERATE
FIX_TYPO_MODE_OFF
relevance descending

These remain planning fields only.

Current Bridge capability will be reverified by Main Chat after Pass A2 acceptance.

## 12. Batch planning

MAX_QUERIES_PER_EXECUTION_UNIT = 500

Deterministic complete batching.

No quota-driven deletion.

If final provider-ready queries <=500:
one batch is acceptable.

If >500:
create complete sequential batches.

Every provider-ready execution query must appear exactly once.

## 13. Required corrected outputs — exactly six

1. M4Q_R2_SOURCE_MANIFEST_R2.md
2. M4Q_R2_QUERY_UNIVERSE_LEDGER_R2.tsv
3. M4Q_R2_SEARCH_EXECUTION_MANIFEST_R2.tsv
4. M4Q_R2_BATCH_PLAN_R2.tsv
5. M4Q_R2_QA_R2.md
6. M4Q_R2_RETURN_MANIFEST_R2.json

## 14. Corrected universe ledger

Preserve the R1 required fields and add at minimum:

query_authority_class
query_authority_source_ids
m2r_evidence_type
m2r_fit_class
m2r_contamination_flags
m2r_capability_state
r1_preparation_status
r2_preparation_status
r1_execution_query_id
r2_execution_query_id
correction_reason

For non-M2R rows, M2R-specific fields may be empty.

## 15. Corrected execution manifest

One row per final provider-ready unique query.

Required fields:

execution_query_id
exact_query_text
exact_safe_comparison_key
query_authority_class
query_authority_source_ids
source_universe_row_ids
source_classes
marketplace_scope
task_or_candidate_groups
existing_demand_evidence
m3_relation
m2r_evidence_summary
m2r_contamination_review
information_gain_question
downstream_decision
why_existing_evidence_insufficient
planned_search_type
planned_region
planned_page
planned_depth
planned_group_mode
planned_docs_in_group
planned_family_mode
planned_fix_typo_mode
planned_sort
provider_limit_check
batch_id

Do not require R1 execution IDs to remain stable.
R2 IDs may be rebuilt deterministically.

## 16. R1 -> R2 correction report in QA

Report:

R1_EXECUTION_QUERIES = 387
R1_M3_OR_M2R_AUTHORITY_EXECUTION_QUERIES = 77
R1_PURE_M4C_ONLY_EXECUTION_QUERIES = 310

Then report final:

R2_EXECUTION_QUERIES =
R2_M3_AUTHORITY_QUERIES =
R2_M2R_AUTHORITY_QUERIES =
R2_M3_AND_M2R_AUTHORITY_QUERIES =
R2_PURE_M4C_ONLY_EXECUTION_QUERIES = 0

R1_EXECUTION_REMOVED_OR_DEFERRED =
R1_EXECUTION_RETAINED =
NEW_EXECUTION_QUERIES_NOT_IN_R1 =

Do not force these counts to any target.

## 17. Hard QA

Prove:

LIVE_BRANCH_FETCHED = true
FROZEN_AUTHORITY_BLOBS_MATCH = 24/24
UNLISTED_INPUT_FILES_USED = 0

SOURCE_UNIVERSE_ROWS = 15542
SOURCE_UNIVERSE_IDS_UNIQUE = 15542
M2R_ACCOUNTED = 1123/1123
M3_ACCOUNTED = 15/15
M4C_CANDIDATE_ACCOUNTED = 8431/8431
M4C_M6_GROUPS_ACCOUNTED = 5973/5973

ALL_UNIVERSE_ROWS_TERMINAL = true
DISPOSITION_COUNTS_RECONCILE = true
SILENT_SOURCE_LOSS = 0

EVERY_EXECUTION_QUERY_HAS_QUERY_AUTHORITY = true
PURE_M4C_ONLY_EXECUTION_QUERIES = 0
EXECUTION_QUERY_EXACT_DUPLICATES = 0
SYNTHETIC_QUERIES_CREATED = 0
PROVIDER_LIMIT_VIOLATIONS = 0

M2R_CONTAMINATION_FIELDS_REVIEWED = true
M2R_EXECUTION_QUERIES_WITH_UNRESOLVED_CONTAMINATION = 0
ASSOCIATION_ONLY_EXECUTION_ROWS_HAVE_EXPLICIT_INFO_GAIN = true

EVERY_EXECUTION_QUERY_HAS_PROVENANCE = true
EVERY_EXECUTION_QUERY_HAS_QUERY_SPECIFIC_INFO_GAIN = true
EVERY_EXECUTION_QUERY_IN_EXACTLY_ONE_BATCH = true
MAX_BATCH_SIZE <= 500

PROVIDER_CALLS = 0
YANDEX_SEARCH_EXECUTION = 0
WORDSTAT_EXECUTION = 0
ALICE_EXECUTION = 0
WEB_ACQUISITION_BY_WORK = 0

COMPETITOR_TOPIC_AS_PROVEN_DEMAND = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
OPEN_CRITICAL_DEFECTS = 0

## 18. Stop conditions

HOLD_AUTHORITY_DRIFT if any frozen required blob differs materially.

PARTIAL_REWORK_REQUIRED if full source accounting does not reconcile.

HOLD_QUERY_AUTHORITY_AMBIGUITY if a material provider-ready query cannot be assigned valid M3/M2R query authority without inventing evidence.

Do not fake PASS.

## 19. Before return

Re-fetch remote branch and record END_OBSERVED_HEAD.

Classify any drift.

## 20. Return

WORK MUST NOT WRITE TO GITHUB.

Create ONE ZIP containing EXACTLY the six corrected files.

Final response must state:

WORK_ID =
START_HEAD =
END_OBSERVED_HEAD =
AUTHORITY_DRIFT_STATUS =
VERDICT =

SOURCE_UNIVERSE_ROWS =
R1_EXECUTION_QUERIES =
R2_EXECUTION_QUERIES =
R2_M3_AUTHORITY_QUERIES =
R2_M2R_AUTHORITY_QUERIES =
R2_M3_AND_M2R_AUTHORITY_QUERIES =
R2_PURE_M4C_ONLY_EXECUTION_QUERIES =

DEFER_TO_M6_DEMAND_VALIDATION_ROWS =
HOLD_AMBIGUOUS_ROWS =
OUT_OF_PRODUCT_SCOPE_ROWS =
NO_INCREMENTAL_SEARCH_INFORMATION_GAIN_ROWS =
NOT_A_PLAUSIBLE_SEARCH_QUERY_ROWS =

M2R_ACCOUNTED =
M3_ACCOUNTED =
M4C_CANDIDATE_ACCOUNTED =
M4C_M6_GROUPS_ACCOUNTED =

SYNTHETIC_QUERIES_CREATED =
SILENT_SOURCE_LOSS =
OPEN_CRITICAL_DEFECTS =

BATCH_COUNT =
MAX_BATCH_SIZE =

FILES_IN_ZIP = 6
ZIP_SHA256 =
GITHUB_WRITES = 0

Provide one real downloadable ZIP.

Owner uploads the six unpacked files to:

docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/

NO PROVIDER COMMAND IS RELEASED BY WORK.
