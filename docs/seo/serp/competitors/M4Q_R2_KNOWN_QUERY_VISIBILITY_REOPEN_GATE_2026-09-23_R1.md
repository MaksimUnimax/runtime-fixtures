# Octoport SEO — M4Q R2 bounded known-query Yandex visibility reopen gate R1

Date: 2026-09-23
Status: PREPARED / QUERY-MANIFEST WORK REQUIRED BEFORE PROVIDER EXECUTION
WORK_ID: OCTOPORT_SEO_M4Q_R2_QUERY_MANIFEST_2026-09-23_R1
Repository: MaksimUnimax/runtime-fixtures
Branch: seo/wordstat-batch-01-2026-09-16
Preparation base HEAD: 8f7b6d79064724fb9720d5fe46a3ca04a46fe73c

## 1. Why M4Q is reopened

M4Q R1 was correctly accepted with:

`RANKING_QUERY_LANE = SOURCE_UNAVAILABLE_DECLARED_LIMITATION`

because no legitimate external reverse-index corpus was available.

Owner has now explicitly authorized a corrective enrichment using the already available Yandex Marketing Bridge.

This R2 does NOT claim to implement arbitrary competitor-domain -> unknown-query reverse indexing.

It creates a separate evidence lane:

```text
KNOWN_QUERY_YANDEX_VISIBILITY
known exact query
-> current Yandex Search SERP
-> authorized competitor domain/page presence
-> rank / ranking URL / result evidence
```

The residual limitation remains:

```text
UNKNOWN_QUERY_REVERSE_INDEX_RECALL
= SOURCE_UNAVAILABLE_DECLARED_LIMITATION
```

Therefore R2 can materially reduce the M4Q limitation without pretending to discover queries that are absent from the accepted known query/candidate universe.

## 2. Current accepted upstream state

```text
M2R = ACCEPTED
M2R_LINEAGE_ROWS = 1123
M2R_CONSERVATIVE_NORMALIZED_STRINGS_INCLUDING_SEEDS = 808

M3 = CLOSED
M3_ACCEPTED_QUERY_SET = 15

M4A = ACCEPTED
M4A_AUTHORIZED_COMPETITORS = 60

M4C_R1 = ACCEPTED
M4C_COMPETITOR_CANDIDATE_OCCURRENCES = 8431
M4C_M6_DEMAND_GAP_CANDIDATES = 5973

M4Q_R1 = ACCEPTED_WITH_SOURCE_LIMITATION
M4 = ACCEPTED_WITH_DECLARED_M4Q_SOURCE_LIMITATION
```

M4C acceptance is preserved during R2 acquisition.
It is not invalidated merely because new evidence is being acquired.

After R2 Search evidence is accepted, Main Chat must perform dependency reconciliation against M4C and M6 before changing downstream authority.

## 3. Frozen inputs

Exact frozen files and Git blob identities are in:

`docs/seo/serp/competitors/M4Q_R2_QUERY_MANIFEST_AUTHORITY_2026-09-23_R1.tsv`

Work must verify all required frozen blobs before analysis.

## 4. Fresh provider/method research

Current official Yandex Search API documentation was rechecked on 2026-09-23.

Official sources:
- https://yandex.cloud/ru/services/search-api
- https://yandex.cloud/en/docs/overview/concepts/quotas-limits
- https://aistudio.yandex.ru/ru/docs/search-api/concepts/web-search
- https://aistudio.yandex.ru/ru/docs/search-api/operations/web-search
- https://aistudio.yandex.ru/ru/docs/search-api/api-ref/WebSearch/search
- https://aistudio.yandex.ru/ru/docs/search-api/api-ref/WebSearchAsync/search
- https://aistudio.yandex.ru/ru/docs/search-api/pricing

Current relevant provider facts:
- Yandex Search API returns results from Yandex search databases.
- Text Search supports synchronous and deferred modes.
- Current documented result limit is up to 250 results per query.
- Query hard limits: 400 characters and 40 words.
- Current quotas include 10,000 synchronous requests/hour and 35,000 deferred requests/hour; both have a 10 requests/second class limit.
- Deferred result retrieval has separate polling limits.
- Deferred processing has a documented minimum of 5 minutes and maximum result retention of 12 hours.

Provider capability != Bridge capability.

Before any live provider command Main Chat must re-verify:
- current installed/accepted Yandex Marketing Bridge build;
- exact supported protocol;
- exact result prefix;
- selected lifecycle;
- exact current pricing;
- request/cost bound.

## 5. Bridge authority already proven

Current accepted project/bridge evidence proves ordinary Yandex Search through Yandex Marketing Bridge.

Historical accepted M3 used the deferred lifecycle:

```text
start
-> submitN
-> collectN
-> exportPage
```

with actual `SEARCH_ASYNC_BATCH_RESULT_V1` evidence.

Example accepted M3 settings:
- SEARCH_TYPE_RU
- region = 225
- GROUP_MODE_FLAT
- docsInGroup = 1
- FAMILY_MODE_MODERATE
- FIX_TYPO_MODE_OFF
- relevance descending

Historical M3 used top-20 because its question was representative intent analysis.

M4Q R2 has a different question: detect authorized competitor visibility in a bounded known-query universe.

Planned depth target:

`TOP_100_ORGANIC_PER_EXACT_QUERY`

Reason:
- one exact query must have enough depth to detect competitor visibility beyond only first-page leaders;
- Yandex officially permits deeper result retrieval;
- the resulting large matrix will be processed in Work, not Main Chat.

The exact executable Bridge schema for this top-100 acquisition is NOT released by this gate.
It must be reverified after the Work manifest is accepted.

## 6. Two-pass Work architecture

### Pass A — current task

Work builds the complete query universe and Search execution manifest.

No provider calls.

### Provider acquisition — later

Main Chat executes only the accepted `SEARCH_REQUIRED` exact-query set through Yandex Marketing Bridge.

All provider lifecycle evidence must be durably persisted and remote-read back.

### Pass B — after provider acquisition

A second Work task processes the complete SERP corpus and creates the large:

`exact query × authorized competitor × ranking URL × rank`

visibility matrix plus M4Q/M4C/M6 reconciliation.

Main Chat will not build that matrix manually.

## 7. Work trigger for Pass A

Inputs requiring cross-file full-volume reconciliation include:
- 1123 M2R lineage rows;
- 15 M3 exact queries;
- 8431 M4C candidate occurrences;
- 5973 M4C M6 grouped candidates;
- 60-authorized-competitor registry and coverage context.

This is a large-data semantic/join task.

```text
WORK_TRIGGER = MET
MAIN_CHAT_FULL_VOLUME_QUERY_SELECTION = FORBIDDEN
SAMPLING = FORBIDDEN
FIRST_N = FORBIDDEN
```

## 8. Query-universe principle

Every eligible source occurrence must be accounted for.

Work may deduplicate only by exact-safe comparison identity.

Allowed exact-safe normalization for comparison:
- Unicode NFC;
- trim outer whitespace;
- collapse internal whitespace;
- case-fold/lowercase.

Do NOT:
- stem;
- lemmatize;
- merge synonyms;
- merge morphology;
- replace characters such as ё/е as if identical;
- translate;
- invent a cleaner search query.

`NORMALIZED_EQUALITY != SEMANTIC_EQUIVALENCE`

## 9. Search query must come from evidence

Every executable query must be an exact observed source phrase.

Allowed origins:
- accepted M2R observed Wordstat seed/direct/association phrase;
- accepted M3 exact query;
- exact raw M4C competitor-candidate wording where it is a plausible user Search query;
- exact raw candidate occurrence supporting an M4C M6 group.

Forbidden:
- assistant-generated query expansion;
- synthetic paraphrase;
- keyword concatenation;
- rewriting a heading into an invented query merely to make it searchable.

## 10. Mandatory disposition for every source candidate

Every candidate occurrence/group must reconcile to one terminal preparation status.

Allowed statuses:

```text
SEARCH_REQUIRED
SEARCH_REQUIRED_CONTROL_REFRESH
ALREADY_COVERED_CURRENT_NO_REQUERY
NO_INCREMENTAL_SEARCH_INFORMATION_GAIN
NOT_A_PLAUSIBLE_SEARCH_QUERY
OUT_OF_PRODUCT_SCOPE
PROVIDER_LIMIT_INVALID
HOLD_AMBIGUOUS
EXACT_DUPLICATE_OF_EXECUTION_QUERY
```

No silent omission.

### M3 controls

The 15 accepted M3 exact queries must be explicitly accounted.

Because R2 asks for a current top-100 visibility surface while historical M3 was top-20 and captured 2026-09-16/17, Work may route the 15 queries as:

`SEARCH_REQUIRED_CONTROL_REFRESH`

where the new depth/current snapshot has explicit information gain.

Do not count this as blind duplicate acquisition.

## 11. Information-gain decision

A query is `SEARCH_REQUIRED` only if current Yandex visibility can materially improve at least one named decision:

- which of the 60 authorized competitors actually ranks for this exact known query;
- which ranking URL/page role owns that visibility;
- whether a competitor-derived candidate is Search-visible at all;
- whether multiple candidate wordings expose materially different competitor sets;
- whether M4C/M6 routing should be enriched/de-risked by current Search evidence;
- whether a known M3 control needs top-100/current refresh for comparability.

Frequency alone does not decide Search inclusion.

Competitor recurrence alone does not decide Search inclusion.

## 12. Provider hard-limit precheck

Executable exact query must satisfy:
- non-empty;
- <=400 Unicode characters;
- <=40 whitespace-delimited words.

Invalid rows are not silently shortened.

Use:
`PROVIDER_LIMIT_INVALID`

with exact basis.

## 13. Desired provider observation contract

This section describes the evidence target, not yet an executable Bridge command.

For each accepted execution query target:

```text
search type = Russian
region = 225
page = 0
desired organic depth = 100
group mode = FLAT
docs per group = 1
family mode = MODERATE
fix typo = OFF
sort = relevance descending
```

Device-specific visibility is NOT claimed by this R2 unless the selected current Bridge protocol explicitly exposes and records a device/user-agent control.

`DEFAULT_OR_UNSPECIFIED_DEVICE != ALL_DEVICE_PROOF`

## 14. Batch planning

Work must partition all `SEARCH_REQUIRED*` exact queries into deterministic complete chunks.

Planning ceiling:

`MAX_QUERIES_PER_EXECUTION_UNIT = 500`

This is chunking, not sampling.

Every execution query must appear in exactly one planned chunk.

Provider mode field must be:

`DEFERRED_PREFERRED_PENDING_CURRENT_BRIDGE_CAPABILITY_PREFLIGHT`

Do not assume current async implementation solely from historical docs.

If current Bridge cannot execute the desired deferred contract, Main Chat will explicitly choose a supported fallback or hold for Bridge repair.

## 15. Required Work outputs — exactly 6

1. `M4Q_R2_SOURCE_MANIFEST.md`
2. `M4Q_R2_QUERY_UNIVERSE_LEDGER.tsv`
3. `M4Q_R2_SEARCH_EXECUTION_MANIFEST.tsv`
4. `M4Q_R2_BATCH_PLAN.tsv`
5. `M4Q_R2_QA.md`
6. `M4Q_R2_RETURN_MANIFEST.json`

## 16. Output schema requirements

### QUERY_UNIVERSE_LEDGER

At minimum:

```text
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
```

Preserve one occurrence/accounting row where source lineage matters.

### SEARCH_EXECUTION_MANIFEST

Exactly one row per unique exact query to be sent to Yandex Search.

At minimum:

```text
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
```

### BATCH_PLAN

One row per complete chunk:
- batch_id;
- first/last execution query ID;
- query count;
- exact query IDs;
- desired provider settings;
- mode preference;
- current Bridge capability status = REVERIFY_REQUIRED;
- cost = RECHECK_BEFORE_EXECUTION;
- raw persistence target.

## 17. Hard QA

Prove at minimum:

```text
LIVE_BRANCH_FETCHED = true
FROZEN_AUTHORITY_BLOBS_MATCH = 18/18
UNLISTED_INPUT_FILES_USED = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0

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

FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
COMPETITOR_TOPIC_AS_PROVEN_DEMAND = 0
```

## 18. Stop/HOLD

Return `HOLD_AUTHORITY_DRIFT` if a frozen blob differs.

Return `PARTIAL_REWORK_REQUIRED` if source accounting cannot reach zero residual without dropping rows.

Return `HOLD_QUERY_IDENTITY_AMBIGUITY` if a candidate cannot be safely represented without synthesizing a new query and the ambiguity is material.

Do not fake PASS.

## 19. Publication

Work MUST NOT write to GitHub.

Return ONE ZIP containing exactly the six outputs.

Owner uploads all six unpacked outputs together to:

`docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R1/`

Main Chat then:
1. remote-readbacks;
2. independently QA's counts/provenance/dispositions;
3. accepts/rejects the execution manifest;
4. re-verifies current Yandex Search pricing and Bridge command surface;
5. only then issues the first provider command.

## 20. Cursor

```text
M4 = ACCEPTED_WITH_DECLARED_M4Q_SOURCE_LIMITATION
M4Q_R2 = CORRECTIVE_ENRICHMENT_PREPARATION
M4C = ACCEPTED / DEPENDENCY_RECHECK_AFTER_R2_EVIDENCE
M5 = PAUSED_BY_OWNER_AUTHORIZED_M4Q_R2_ENRICHMENT
M6 = NOT_STARTED
M7 = BLOCKED

NEXT = FULL_VOLUME WORK QUERY-MANIFEST BUILD
```
