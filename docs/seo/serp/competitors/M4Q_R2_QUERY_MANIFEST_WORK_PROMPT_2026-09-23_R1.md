# M4Q R2 — canonical ChatGPT Work query-manifest execution prompt

WORK_ID: OCTOPORT_SEO_M4Q_R2_QUERY_MANIFEST_2026-09-23_R1

CONTINUE THE EXISTING OCTOPORT SEO PROGRAM.

THIS IS AN EXECUTION TASK.
THIS IS M4Q R2 QUERY-MANIFEST BUILD ONLY.

THIS IS NOT A NEW PROJECT.
THIS IS NOT PROVIDER EXECUTION.
THIS IS NOT WORDSTAT ACQUISITION.
THIS IS NOT A YANDEX SEARCH API RUN.
THIS IS NOT FINAL M4Q VISIBILITY MATRIX BUILD.
THIS IS NOT M5.
THIS IS NOT M6 DEMAND VALIDATION.
THIS IS NOT CLUSTERING.
THIS IS NOT PAGE OWNERSHIP.

Repository:
MaksimUnimax/runtime-fixtures

Branch:
seo/wordstat-batch-01-2026-09-16

## 0. First action — live preflight

Fetch the live remote branch and record START_HEAD.

Read in full:

- docs/seo/LEVEL1/README.md
- docs/seo/EXECUTION_RULES.md
- docs/seo/WORK_HANDOFF_RULE.md
- docs/seo/QUALITY_FIRST_RESOURCE_RULE.md
- docs/seo/PRODUCT_TRUTH.md
- docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md
- docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md
- docs/seo/serp/competitors/M4Q_R2_QUERY_MANIFEST_AUTHORITY_2026-09-23_R1.tsv
- docs/seo/serp/competitors/M4Q_R2_KNOWN_QUERY_VISIBILITY_REOPEN_GATE_2026-09-23_R1.md
- docs/seo/serp/competitors/M4Q_R1_SOURCE_LIMITATION_ACCEPTANCE_2026-09-22.md
- docs/seo/serp/competitors/M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md
- docs/seo/serp/competitors/M4_PROGRESS.md

Verify every required frozen Git blob in:
docs/seo/serp/competitors/M4Q_R2_QUERY_MANIFEST_AUTHORITY_2026-09-23_R1.tsv

Expected required frozen rows = 18.

If any required frozen blob differs materially:

VERDICT = HOLD_AUTHORITY_DRIFT

Stop before analysis.

## 1. Large-data rule

Process the COMPLETE authorized input universe.

LARGE DATA != SAMPLE
LARGE DATA != FIRST-N
LARGE DATA != TRUNCATE
LARGE DATA != SUMMARY-BEFORE-FULL-ANALYSIS

Main input scales include:
- M2R lineage: 1123 rows;
- M3 query set: 15 exact queries;
- M4C competitor candidate occurrences: 8431;
- M4C M6 grouped candidates: 5973;
- authorized competitor registry: 60.

Do not process a representative subset.

## 2. Exact purpose

Build the bounded exact-query execution manifest that Main Chat may later use with Yandex Marketing Bridge to measure:

known exact query
-> current Yandex organic SERP
-> which of the 60 authorized competitors ranks
-> at what rank
-> with which ranking URL

This Work run does NOT call Yandex.

This Work run does NOT build the final query×competitor visibility matrix.

That matrix belongs to a second Work pass AFTER provider evidence exists.

## 3. M4Q R2 evidence boundary

M4Q R2 can close only the known-query visibility lane.

It cannot discover arbitrary unknown queries belonging to competitor domains.

Preserve:

KNOWN_QUERY_YANDEX_VISIBILITY = TARGET_OF_R2

and separately:

UNKNOWN_QUERY_REVERSE_INDEX_RECALL =
SOURCE_UNAVAILABLE_DECLARED_LIMITATION

Do not relabel R2 as exhaustive competitor keyword recall.

## 4. Authorized source universe

Use only frozen inputs listed in the authority manifest.

Core query sources:

A. M2R observed Wordstat lineage:
docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv

B. accepted M3 query authority:
docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md

C. M4C occurrence-lossless competitor candidates:
docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COMPETITOR_CANDIDATE_REGISTER.tsv

D. M4C grouped M6 candidates:
docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_M6_DEMAND_GAP_CANDIDATES.tsv

Competitor authority:
- M4A competitor registry;
- M4C hardened competitor registry;
- M4C coverage ledger.

Do not use unlisted files as analytical inputs.

## 5. Parser contract

Accepted M4C TSV parser contract:

FIELD_SEPARATOR = literal TAB
RECORD_SEPARATOR = physical newline
DOUBLE_QUOTE = literal field character
CSV_QUOTE_SEMANTICS = DISABLED
PARSE_MODE = QUOTE_NONE / literal-tab

Do not use a generic CSV parser that treats double quote as a record-spanning quote delimiter.

## 6. Query identity

Every executable Search query MUST be an exact observed source phrase.

Allowed exact-safe comparison normalization:

1. Unicode NFC;
2. trim leading/trailing whitespace;
3. collapse internal whitespace;
4. Unicode case-fold/lowercase.

Do not:
- stem;
- lemmatize;
- merge synonyms;
- translate;
- rewrite;
- correct spelling;
- replace ё/е as equivalent;
- synthesize a nicer query.

NORMALIZED_EQUALITY != SEMANTIC_EQUIVALENCE.

Exact-safe duplicates may share one execution query only if all original provenance rows remain linked to it.

## 7. No synthetic query generation

Executable query text may come only from:

- observed M2R tested seed/direct-result/association phrase;
- exact accepted M3 query text;
- exact raw M4C candidate wording when it is a plausible Search query;
- exact raw candidate occurrence supporting an M4C M6 group.

Do not turn:
- a page heading;
- a long competitor sentence;
- a capability label;
- a matrix dimension;
- a normalized semantic key

into an invented Search query.

If an important candidate cannot be represented by an exact observed phrase, use HOLD_AMBIGUOUS or NOT_A_PLAUSIBLE_SEARCH_QUERY as appropriate.

## 8. Full source accounting

Every source row in the four query sources must be explicitly accounted.

Required:
- 1123/1123 M2R lineage rows;
- 15/15 M3 query rows;
- 8431/8431 M4C candidate occurrences;
- 5973/5973 M4C M6 grouped candidates.

No silent loss.

A source row can link to:
- an execution query;
- an exact duplicate execution query;
- a non-execution terminal disposition.

## 9. Mandatory terminal dispositions

Use exactly one primary preparation status for each universe row:

SEARCH_REQUIRED
SEARCH_REQUIRED_CONTROL_REFRESH
ALREADY_COVERED_CURRENT_NO_REQUERY
NO_INCREMENTAL_SEARCH_INFORMATION_GAIN
NOT_A_PLAUSIBLE_SEARCH_QUERY
OUT_OF_PRODUCT_SCOPE
PROVIDER_LIMIT_INVALID
HOLD_AMBIGUOUS
EXACT_DUPLICATE_OF_EXECUTION_QUERY

Every non-execution status must have a concrete basis.

## 10. M3 controls

Account for all 15 accepted M3 exact queries.

Historical M3 evidence is top-20 from 2026-09-16/17.

M4Q R2 asks a different question:
- current visibility;
- deeper planned top-100 competitor detection;
- comparison against the 60 current authorized competitor entities.

Therefore an M3 query may legitimately be:

SEARCH_REQUIRED_CONTROL_REFRESH

if its new current/deeper observation adds information.

Do not call such a refresh blind duplication.

## 11. Information-gain gate

SEARCH_REQUIRED or SEARCH_REQUIRED_CONTROL_REFRESH is allowed only when current Yandex Search can materially improve one or more named decisions:

- whether any authorized competitor ranks for this exact query;
- ranking position and ranking URL;
- whether a competitor-derived phrase is actually Search-visible;
- whether exact variants expose materially different competitor sets;
- whether current Search evidence can enrich/de-risk M4C or M6 routing;
- whether the M3 control should be refreshed for top-100/current comparability.

Do not use:
- observed frequency alone;
- competitor occurrence count alone;
- arbitrary priority quota;
- "it may be interesting"

as sufficient justification.

## 12. Provider hard-limit precheck

The future Yandex Search query must be:
- non-empty;
- <=400 Unicode characters;
- <=40 whitespace-delimited words.

Do not truncate or rewrite invalid queries.

Use PROVIDER_LIMIT_INVALID.

## 13. Desired provider target — planning only

No command execution in this Work run.

For planned execution rows record the desired target:

search type = SEARCH_TYPE_RU
region = 225
page = 0
planned organic depth = 100
group mode = GROUP_MODE_FLAT
docs in group = 1
family mode = FAMILY_MODE_MODERATE
fix typo mode = FIX_TYPO_MODE_OFF
sort = relevance descending

These are desired evidence settings, not proof that the current installed Bridge protocol exposes every field.

Main Chat will reverify the live accepted Bridge command surface before paid execution.

Device-specific claims are forbidden unless the selected live protocol explicitly records device/user-agent control.

## 14. Deterministic batching

Partition every unique execution query into exactly one complete planned batch.

MAX_QUERIES_PER_EXECUTION_UNIT = 500

This is deterministic chunking, not sampling.

Batch IDs:
M4Q-R2-B001
M4Q-R2-B002
...

Sort execution queries deterministically by:
1. execution class: CONTROL_REFRESH before ordinary SEARCH_REQUIRED only for deterministic ordering, not analytical priority;
2. exact-safe comparison key;
3. exact query text.

Do not drop a query to keep the number of batches small.

Provider mode field:

DEFERRED_PREFERRED_PENDING_CURRENT_BRIDGE_CAPABILITY_PREFLIGHT

Bridge capability field:

REVERIFY_REQUIRED

Cost field:

RECHECK_CURRENT_PRICE_BEFORE_PROVIDER_EXECUTION

## 15. Required outputs — exactly 6

Create exactly:

1. M4Q_R2_SOURCE_MANIFEST.md
2. M4Q_R2_QUERY_UNIVERSE_LEDGER.tsv
3. M4Q_R2_SEARCH_EXECUTION_MANIFEST.tsv
4. M4Q_R2_BATCH_PLAN.tsv
5. M4Q_R2_QA.md
6. M4Q_R2_RETURN_MANIFEST.json

## 16. QUERY_UNIVERSE_LEDGER schema

Required fields:

universe_row_id
source_class
source_file
source_row_id_or_locator
raw_phrase
exact_safe_comparison_key
source_evidence_type
observed_count_if_any
marketplace_scope
task_family_or_candidate_group
fit_or_relation_state
m3_exact_query_relation
m4c_candidate_relation
source_provenance
search_information_gain_question
preparation_status
execution_query_id_if_any
terminal_reason

Additional fields are allowed only when useful and documented.

## 17. SEARCH_EXECUTION_MANIFEST schema

One row per unique exact query to be sent later.

Required fields:

execution_query_id
exact_query_text
exact_safe_comparison_key
source_universe_row_ids
source_classes
marketplace_scope
task_or_candidate_groups
existing_demand_evidence
m3_relation
information_gain_question
downstream_decision
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

Execution IDs:
M4QR2Q00001
M4QR2Q00002
...

No duplicate exact-safe comparison key.

## 18. BATCH_PLAN schema

Required fields:

batch_id
execution_query_count
first_execution_query_id
last_execution_query_id
execution_query_ids
planned_search_type
planned_region
planned_page
planned_depth
planned_group_mode
planned_docs_in_group
planned_family_mode
planned_fix_typo_mode
planned_sort
provider_mode_preference
bridge_capability_status
cost_status
future_raw_persistence_target

The batch plan is not an executable Bridge command.

## 19. QA

Prove at minimum:

LIVE_BRANCH_FETCHED = true
FROZEN_AUTHORITY_BLOBS_MATCH = 18/18
UNLISTED_INPUT_FILES_USED = 0

PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
YANDEX_SEARCH_EXECUTION = 0
WORDSTAT_EXECUTION = 0
ALICE_EXECUTION = 0

M2R_LINEAGE_ROWS_ACCOUNTED = 1123/1123
M3_QUERY_ROWS_ACCOUNTED = 15/15
M4C_CANDIDATE_OCCURRENCES_ACCOUNTED = 8431/8431
M4C_M6_GROUPS_ACCOUNTED = 5973/5973
AUTHORIZED_COMPETITORS = 60

SILENT_SOURCE_LOSS = 0
EXECUTION_QUERY_EXACT_DUPLICATES = 0
SYNTHETIC_QUERIES_CREATED = 0
PROVIDER_LIMIT_VIOLATIONS_IN_EXECUTION_MANIFEST = 0

EVERY_EXECUTION_QUERY_HAS_INFORMATION_GAIN = true
EVERY_EXECUTION_QUERY_HAS_PROVENANCE = true
EVERY_EXECUTION_QUERY_IN_EXACTLY_ONE_BATCH = true
BATCH_QUERY_COUNT_MAX <= 500

ALL_UNIVERSE_ROWS_TERMINAL = true
DISPOSITION_COUNTS_RECONCILE = true

FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0
COMPETITOR_TOPIC_AS_PROVEN_DEMAND = 0

OPEN_CRITICAL_DEFECTS = 0

## 20. Stop conditions

If a frozen blob differs:
VERDICT = HOLD_AUTHORITY_DRIFT

If source accounting does not reconcile:
VERDICT = PARTIAL_REWORK_REQUIRED

If material query identity requires invention:
VERDICT = HOLD_QUERY_IDENTITY_AMBIGUITY

Do not fake PASS.

## 21. Before return

Re-fetch the branch and record END_OBSERVED_HEAD.

If remote HEAD advanced:
- classify changed paths;
- if authority/input changed materially, HOLD_AUTHORITY_DRIFT;
- otherwise report non-material drift explicitly.

## 22. Return

WORK MUST NOT WRITE TO GITHUB.

Create ONE ZIP containing EXACTLY the six required files.

Final response must state:

WORK_ID =
START_HEAD =
END_OBSERVED_HEAD =
AUTHORITY_DRIFT_STATUS =
VERDICT =

SOURCE_UNIVERSE_ROWS =
UNIQUE_EXACT_SAFE_QUERY_KEYS =
SEARCH_REQUIRED_ROWS =
SEARCH_REQUIRED_CONTROL_REFRESH_ROWS =
UNIQUE_EXECUTION_QUERIES =
BATCH_COUNT =
MAX_BATCH_SIZE =

M2R_ACCOUNTED =
M3_ACCOUNTED =
M4C_CANDIDATE_ACCOUNTED =
M4C_M6_GROUPS_ACCOUNTED =

SYNTHETIC_QUERIES_CREATED =
SILENT_SOURCE_LOSS =
OPEN_CRITICAL_DEFECTS =

FILES_IN_ZIP = 6
ZIP_SHA256 =
GITHUB_WRITES = 0

Then provide ONE REAL DOWNLOADABLE ZIP ARTIFACT LINK.

Owner will unpack and upload all six files together to:

docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R1/

After owner upload Main Chat performs independent QA.

NO PROVIDER COMMAND IS RELEASED BY WORK.
