# M4Q R2 — canonical ChatGPT Work Pass B visibility/reconciliation prompt

WORK_ID: OCTOPORT_SEO_M4Q_R2_VISIBILITY_RECONCILIATION_2026-09-23_R1

CONTINUE THE EXISTING OCTOPORT SEO PROGRAM.

THIS IS AN EXECUTION TASK.
THIS IS M4Q R2 PASS B ONLY.

THIS IS NOT A NEW PROJECT.
THIS IS NOT PROVIDER EXECUTION.
THIS IS NOT YANDEX SEARCH ACQUISITION.
THIS IS NOT WORDSTAT ACQUISITION.
THIS IS NOT ALICE.
THIS IS NOT M5 EXECUTION.
THIS IS NOT M6 PROVIDER EXECUTION.
THIS IS NOT FINAL CLUSTERING.
THIS IS NOT QUERY->PAGE OWNERSHIP.
THIS IS NOT SITE ARCHITECTURE.

Repository:
MaksimUnimax/runtime-fixtures

Branch:
seo/wordstat-batch-01-2026-09-16

You are given TWO mandatory attached Yandex Marketing Bridge export files:

1. search-octoport-m4q-r2-b001-20260923-r225-0-24.json
2. search-octoport-m4q-r2-b001-20260923-r225-25-44.json

======================================================================
0. FIRST ACTION — LIVE PREFLIGHT
======================================================================

Fetch the live remote branch and record START_HEAD.

Read in full:

- docs/seo/LEVEL1/README.md
- docs/seo/EXECUTION_RULES.md
- docs/seo/WORK_HANDOFF_RULE.md
- docs/seo/QUALITY_FIRST_RESOURCE_RULE.md
- docs/seo/PRODUCT_TRUTH.md
- docs/seo/METHODOLOGY.md
- docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md
- docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md
- docs/seo/serp/competitors/M4Q_R2_PASS_B_PRE_HANDOFF_MANIFEST_2026-09-23_R1.md
- docs/seo/serp/competitors/M4Q_R2_KNOWN_QUERY_VISIBILITY_REOPEN_GATE_2026-09-23_R1.md
- docs/seo/serp/competitors/M4Q_R2_PASS_A2_MAIN_CHAT_ACCEPTANCE_2026-09-23.md
- docs/seo/serp/competitors/M4Q_R2_COMPLETE_EXPORT_ACCEPTANCE_2026-09-23_R1.md
- docs/seo/serp/competitors/M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md
- docs/seo/serp/competitors/M4_PROGRESS.md

Read all six accepted M4Q R2 Pass A2 return files under:

docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/

Read the accepted M4C files required by the pre-handoff manifest, including at minimum:

- M4C_HARDENED_COMPETITOR_REGISTRY.tsv
- M4C_COVERAGE_LEDGER.tsv
- M4C_URL_LEDGER.tsv
- M4C_COMPETITOR_CANDIDATE_REGISTER.tsv
- M4C_M6_DEMAND_GAP_CANDIDATES.tsv
- M4C_RETURN_MANIFEST.json

Also read:

- docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md
- docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv

Verify the frozen blob identities declared in the pre-handoff manifest before analysis.

If a material frozen authority differs:
VERDICT = HOLD_AUTHORITY_DRIFT
and stop.

Do not use superseded M4Q R1 source-limitation state as if R2 provider evidence did not happen.
Do preserve the still-valid reverse-index recall limitation described below.

======================================================================
1. VERIFY THE TWO ATTACHED EXPORT FILES BEFORE USING THEM
======================================================================

Compute exact bytes and SHA256.

Required attachment identities:

FILE 1
name = search-octoport-m4q-r2-b001-20260923-r225-0-24.json
bytes = 9207000
sha256 = 4e9890bfba1006e116523701d61d0edfc82f6305b68d412101eb5f4aaec4aeb7

FILE 2
name = search-octoport-m4q-r2-b001-20260923-r225-25-44.json
bytes = 7586040
sha256 = d185d8a11cfbe70beb10418da7341000481d3faa7856a8ed62a1237cfe73e254

Both must prove:

schema = YMB_SEARCH_ASYNC_EXPORT_PAGE_V1
job_id = octoport-m4q-r2-b001-20260923
revision = 225
total_items = 45
terminal job summary = 45 SUCCEEDED / 0 unresolved / all_successful=true

Page 1:
indices 0..24
item_count = 25
result_row_count = 2500
next_after = 24
has_more = true

Page 2:
indices 25..44
item_count = 20
result_row_count = 2000
next_after = 44
has_more = false

Combined:

indices = exactly 0..44
unique indices = 45
gaps = 0
overlaps = 0
normalized rows = 4500
each query = exactly 100 normalized results
query text/order = exact match to accepted M4Q_R2_SEARCH_EXECUTION_MANIFEST_R2.tsv

If any of these fail:
VERDICT = HOLD_INPUT_EVIDENCE_IDENTITY
and stop.

Do not reconstruct missing rows from raw XML if normalized evidence is missing.
Do not silently repair an export.

======================================================================
2. BINDING ANALYTICAL QUESTION
======================================================================

This pass is the full-volume current known-query visibility analysis promised by M4Q R2.

For every one of the 45 accepted exact queries, determine:

1. which of the 60 authorized competitors are visible in current Yandex top-100;
2. at which exact ranks;
3. through which ranking URLs;
4. with what title/snippet evidence;
5. whether the match is exact authorized host/domain/equivalence or ambiguous;
6. for the 15 historical M3 control queries, what materially changed versus the accepted 2026-09-16/17 top-20 baseline;
7. whether current evidence materially enriches or changes an M4Q/M4C/M6 decision named in the accepted execution manifest.

This is a CURRENT BOUNDED KNOWN-QUERY VISIBILITY PASS.

It is NOT arbitrary competitor-domain -> unknown-query reverse indexing.

The surviving limitation must remain explicit:

KNOWN_QUERY_TOP100_ENRICHMENT = COMPLETE
ARBITRARY_DOMAIN_TO_UNKNOWN_QUERY_REVERSE_INDEX_RECALL = NOT_PROVEN / LIMITATION_ACTIVE

======================================================================
3. FULL-VOLUME SERP LEDGER — NO ROW LOSS
======================================================================

Process ALL 4500 normalized result rows.

Create one ledger row for every normalized SERP result.

Required fields in M4Q_R2_SERP_RESULT_LEDGER.tsv at minimum:

- execution_query_id
- exact_query_text
- query_authority_class
- batch_id
- export_source_file
- source_item_index
- operation_id
- result_rank
- rank_bucket
- result_url_raw
- result_url_normalized
- result_host
- result_domain
- result_title
- result_snippet_or_passage
- authorized_competitor_match_status
- authorized_competitor_id
- authorized_competitor_name
- competitor_role_class
- competitor_match_basis
- competitor_match_confidence
- competitor_match_notes
- m4c_exact_url_match_status
- m4c_url_id
- m4c_entity_id
- evidence_time_or_provider_response_time_if_available
- claim_boundary

Rank buckets:

1..3 = TOP3
4..10 = TOP10
11..20 = 11_20
21..100 = 21_100

Do NOT drop non-competitor rows.
They remain in the 4500-row ledger with authorized_competitor_match_status = NO_AUTHORIZED_MATCH or equivalent.

There must be exactly one row per query/rank if the normalized export itself has one result for every rank.

If duplicate/missing rank keys exist, preserve them and report them; do not silently force a perfect 1..100 sequence.

======================================================================
4. AUTHORIZED COMPETITOR MATCHING
======================================================================

The 60-row M4C_HARDENED_COMPETITOR_REGISTRY.tsv is the competitor identity authority.

Match current SERP rows only using evidence supported by that registry and accepted equivalence data.

Allowed match bases include, where explicitly authorized:

- exact authorized host
- exact authorized domain
- explicit accepted host/domain equivalence
- exact accepted ranking URL/canonical URL lineage

Forbidden:

- fuzzy brand-name match by title alone
- invented sibling-host equivalence
- silent regional/mobile/subdomain equivalence not present in authority
- mapping unrelated marketplace/native pages to a vendor because the snippet mentions its name
- resolving collisions by convenience

If a row is materially ambiguous:
preserve AMBIGUOUS / HOLD identity state with exact evidence and do not force assignment.

Native marketplace surfaces and context/baseline entities retain their accepted registry role.

======================================================================
5. VISIBILITY MATRIX
======================================================================

Create M4Q_R2_COMPETITOR_VISIBILITY_MATRIX.tsv from the complete ledger.

One row per observed authorized competitor ranking occurrence.

Required fields at minimum:

- execution_query_id
- exact_query_text
- authorized_competitor_id
- authorized_competitor_name
- competitor_role_class
- rank
- rank_bucket
- ranking_url
- ranking_host
- title
- snippet_or_passage
- match_basis
- match_confidence
- source_item_index
- operation_id
- m4c_exact_url_match_status
- m4c_url_id
- m3_relation
- information_gain_question
- downstream_decision
- stop_interpretation
- claim_boundary

Do not manufacture rows for competitors that are absent from a query.

Zero visibility belongs in summary tables, not as fake rank rows.

======================================================================
6. QUERY VISIBILITY SUMMARY — EXACTLY 45 ROWS
======================================================================

Create M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv with exactly one row per execution query.

Required fields at minimum:

- execution_query_id
- exact_query_text
- query_authority_class
- m3_relation
- m2r_evidence_summary
- information_gain_question
- downstream_decision
- total_serp_rows
- authorized_competitor_occurrences_top100
- authorized_competitors_unique_top100
- authorized_competitors_top3
- authorized_competitors_top10
- authorized_competitors_top20
- authorized_competitors_21_100
- top3_competitor_ids
- top10_competitor_ids
- top20_competitor_ids
- top100_competitor_ids
- native_marketplace_occurrences
- ambiguous_match_count
- no_authorized_competitor_top100
- m3_historical_comparison_status
- m3_material_change_summary
- m4q_decision_effect
- m4c_dependency_effect
- m6_routing_effect
- stop_rule_satisfied
- evidence_boundary_notes

A valid no-authorized-competitor top100 observation means only:

NO AUTHORIZED COMPETITOR OBSERVED IN THIS CURRENT EXACT-QUERY TOP100 SNAPSHOT.

It must never be translated into zero demand, zero pages, or no market.

======================================================================
7. COMPETITOR VISIBILITY SUMMARY — EXACTLY 60 ROWS
======================================================================

Create M4Q_R2_COMPETITOR_VISIBILITY_SUMMARY.tsv with exactly one row for every authorized competitor, including zero-visibility competitors.

Required fields at minimum:

- authorized_competitor_id
- authorized_competitor_name
- role_class
- queries_visible_top100
- queries_visible_top20
- queries_visible_top10
- queries_visible_top3
- total_ranking_occurrences_top100
- best_rank
- ranking_url_count
- ranking_urls
- query_ids
- rank_bucket_counts
- ambiguous_rows_related
- current_visibility_status
- claim_boundary

Do not rank competitors as “best/worst”.
These are descriptive current visibility facts only.

======================================================================
8. M3 CONTROL RECONCILIATION
======================================================================

All 15 accepted M3 exact queries must be accounted for.

Historical M3 is a 2026-09-16/17 top-20 baseline, not a current top-100 truth.

For each M3 control classify current evidence conservatively:

- NO_MATERIAL_CHANGE
- ENRICH_BEYOND_TOP20
- CURRENT_RANKING_URL_CHANGE
- CURRENT_COMPETITOR_SET_CHANGE
- MIXED_CHANGE
- HOLD_COMPARABILITY

Do not claim causal change.
Do not interpret ordinary rank movement as demand change.

If the historical M3 artifact does not expose enough exact comparable rank/URL detail for a particular claim, use HOLD_COMPARABILITY rather than inference.

======================================================================
9. M4C / M6 RECONCILIATION
======================================================================

Create M4Q_R2_M4C_M6_RECONCILIATION.tsv with exactly 45 query-level rows.

For each query answer its accepted information-gain question from the execution manifest.

Required fields at minimum:

- execution_query_id
- exact_query_text
- query_authority_class
- information_gain_question
- downstream_decision
- current_visibility_finding
- authorized_competitor_count
- material_new_competitors_vs_existing_evidence
- material_ranking_url_role_change
- m4q_effect
- m4c_effect
- m4c_affected_entity_ids
- m4c_affected_candidate_groups
- m6_effect
- m6_affected_candidate_ids_or_groups
- search_visibility_demand_boundary
- recommended_next_state
- confidence
- evidence_refs
- notes

Allowed general effect vocabulary should remain conservative, for example:

M4Q:
- ENRICH_KNOWN_QUERY_VISIBILITY
- NO_INCREMENTAL_MATERIAL_CHANGE
- HOLD_IDENTITY_OR_COMPARABILITY

M4C:
- NO_REOPEN_REQUIRED
- ENRICH_ACCEPTED_CONTEXT
- TARGETED_RECHECK_CANDIDATE
- HOLD

M6:
- KEEP_EXISTING_VALIDATION_ROUTE
- PRIORITIZE_EXISTING_VALIDATION_QUESTION
- DEPRIORITIZE_EXISTING_VALIDATION_QUESTION
- SEARCH_CONTROL_ONLY
- HOLD

Search visibility alone must never convert an M6 candidate into accepted demand.

Do not create new provider queries.

Do not execute Wordstat.

======================================================================
10. CLAIM BOUNDARIES — HARD
======================================================================

Preserve these distinctions everywhere:

SEARCH_VISIBILITY != WORDSTAT_DEMAND
COMPETITOR_RANKING != OCTOPORT_PRODUCT_FACT
COMPETITOR_PAGE_TOPIC != PROVEN_DEMAND
KNOWN_QUERY_TOP100_VISIBILITY != COMPLETE SEMANTIC RECALL
KNOWN_QUERY_TOP100_VISIBILITY != DOMAIN->UNKNOWN-QUERY REVERSE INDEX
NO AUTHORIZED COMPETITOR TOP100 != ZERO DEMAND
NO AUTHORIZED COMPETITOR TOP100 != ZERO INDEXED RESULTS
CURRENT SNAPSHOT != ALL-DATE PROOF
DEFAULT/UNSPECIFIED DEVICE != ALL-DEVICE PROOF
M4Q != FINAL CLUSTERING
M4Q != FINAL PAGE OWNERSHIP
M4Q != FINAL URL/H1/TITLE/IA

Do not weaken these boundaries for a cleaner narrative.

======================================================================
11. REQUIRED QA
======================================================================

Create M4Q_R2_PASS_B_QA.md.

At minimum report:

ATTACHMENT_SHA256_MATCH = 2/2
EXPORT_SCHEMA_MATCH = 2/2
EXPORT_JOB_ID_MATCH = 2/2
EXPORT_REVISION_MATCH = 2/2
FINAL_HAS_MORE_FALSE = true

QUERY_ORDER_MATCH = 45/45
QUERY_IDS_UNIQUE = 45/45

SERP_RESULT_ROWS = 4500/4500
QUERY_RESULT_COUNTS = 45/45 x 100
SILENT_SERP_ROW_LOSS = 0

UNIQUE_QUERY_RANK_KEYS =
DUPLICATE_QUERY_RANK_KEYS =
MISSING_EXPECTED_RANK_KEYS =
PRESERVED_PROVIDER_ANOMALIES =

AUTHORIZED_COMPETITORS_ACCOUNTED = 60/60
AUTHORIZED_COMPETITOR_MATCH_ROWS =
NO_AUTHORIZED_MATCH_ROWS =
AMBIGUOUS_COMPETITOR_MATCH_ROWS =
UNKNOWN_REGISTRY_REFS = 0

M3_CONTROL_QUERIES_ACCOUNTED = 15/15
M4C_RECONCILIATION_QUERIES_ACCOUNTED = 45/45
M6_ROUTING_QUERIES_ACCOUNTED = 45/45

SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_FACT_AS_OCTOPORT_FACT = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0

PROVIDER_CALLS = 0
YANDEX_SEARCH_EXECUTION = 0
WORDSTAT_EXECUTION = 0
ALICE_EXECUTION = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES = 0

If any row-count/join invariant fails, do not fake PASS.

======================================================================
12. REQUIRED OUTPUTS — EXACTLY EIGHT
======================================================================

Produce exactly:

1. M4Q_R2_PASS_B_SOURCE_MANIFEST.md
2. M4Q_R2_SERP_RESULT_LEDGER.tsv
3. M4Q_R2_COMPETITOR_VISIBILITY_MATRIX.tsv
4. M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv
5. M4Q_R2_COMPETITOR_VISIBILITY_SUMMARY.tsv
6. M4Q_R2_M4C_M6_RECONCILIATION.tsv
7. M4Q_R2_PASS_B_QA.md
8. M4Q_R2_PASS_B_RETURN_MANIFEST.json

No extra final deliverables inside the ZIP.

Intermediate scratch files may exist locally but must not be packaged.

The return manifest must include for each of the seven non-self files:

- filename
- bytes
- SHA256
- row count where applicable
- role

For itself, use the repository's established self-hash policy; do not claim an impossible self-containing final SHA.

======================================================================
13. STOP CONDITIONS
======================================================================

HOLD_INPUT_EVIDENCE_IDENTITY
if either attached JSON is missing or hash/structure is wrong.

HOLD_AUTHORITY_DRIFT
if current governing/frozen authority has materially changed such that this prompt is stale.

PARTIAL_REWORK_REQUIRED
if all 4500 normalized rows or all 45 queries cannot be accounted without silent loss.

HOLD_COMPETITOR_IDENTITY
only when a material identity collision prevents conservative accounting.
Do not force-match ambiguous rows just to avoid HOLD.

======================================================================
14. BEFORE RETURN — DRIFT CHECK
======================================================================

Re-fetch the live remote branch and record END_OBSERVED_HEAD.

Classify drift since START_HEAD.

If branch advancement contains only unrelated/current downstream-safe changes and does not alter frozen authority, report:

AUTHORITY_DRIFT_STATUS = NONE or NON_BLOCKING

If rules, product truth, M4Q accepted query authority, accepted registry identity, or M4C authority changed materially:

AUTHORITY_DRIFT_STATUS = BLOCKING
VERDICT = HOLD_AUTHORITY_DRIFT

======================================================================
15. PUBLICATION / OWNER RELAY
======================================================================

WORK MUST NOT WRITE TO GITHUB.

Create exactly ONE downloadable ZIP containing exactly the eight final files.

Owner will extract the ZIP and upload all eight unpacked files together in one GitHub UI upload action to:

docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/

Do not ask the owner to decide paths.
Do not ask the owner to upload files one-by-one.
Do not package the two input JSON files in the output ZIP.

======================================================================
16. FINAL RESPONSE FORMAT
======================================================================

Final Work response must state at minimum:

WORK_ID =
START_HEAD =
END_OBSERVED_HEAD =
AUTHORITY_DRIFT_STATUS =
VERDICT =

INPUT_EXPORTS = 2/2
INPUT_EXPORT_SHA256_MATCH = 2/2
EXECUTION_QUERIES = 45/45
SERP_RESULT_ROWS = 4500/4500
AUTHORIZED_COMPETITORS = 60/60

VISIBILITY_MATRIX_ROWS =
AUTHORIZED_COMPETITOR_MATCH_ROWS =
NO_AUTHORIZED_MATCH_ROWS =
AMBIGUOUS_COMPETITOR_MATCH_ROWS =

M3_CONTROLS_ACCOUNTED = 15/15
M4C_RECONCILIATION_ACCOUNTED = 45/45
M6_ROUTING_ACCOUNTED = 45/45

SILENT_SERP_ROW_LOSS = 0
SEARCH_VISIBILITY_AS_DEMAND = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0

FILES_IN_ZIP = 8
ZIP_SHA256 =
GITHUB_WRITES = 0

Provide one real downloadable ZIP.

Do not continue to M5, M6 execution, M7, clustering or page ownership.
