# M6 — canonical ChatGPT Work pre-acquisition reconciliation prompt

WORK_ID: OCTOPORT_SEO_M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1

CONTINUE THE EXISTING OCTOPORT SEO PROGRAM.

THIS IS AN EXECUTION TASK.
THIS IS M6 PRE-ACQUISITION RECONCILIATION ONLY.

THIS IS NOT A NEW PROJECT.
THIS IS NOT WORDSTAT EXECUTION.
THIS IS NOT YANDEX SEARCH EXECUTION.
THIS IS NOT ALICE.
THIS IS NOT M7.
THIS IS NOT FINAL CLUSTERING.
THIS IS NOT QUERY->PAGE OWNERSHIP.
THIS IS NOT SITE ARCHITECTURE.
THIS IS NOT M1 LIVE CRAWL EXECUTION.

Repository:
MaksimUnimax/runtime-fixtures

Branch:
seo/wordstat-batch-01-2026-09-16

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
- docs/seo/SEO_MASTER_ROADMAP_2026-09-16.md
- docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md
- docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md
- docs/seo/LEVEL2/M7_M8_SEARCH_FREEZE_AND_SEMANTIC_MASTER_RULES.md
- docs/seo/M5_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md
- docs/seo/M6_PRE_ACQUISITION_RECONCILIATION_GATE_2026-09-23_R1.md
- docs/seo/serp/M3_METHOD_RETROSPECTIVE_AND_CONTROL_DEBT_2026-09-18.md
- docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md
- docs/seo/work/M2R_RECONCILIATION_MAIN_CHAT_RETURN_QA_2026-09-17.md
- docs/seo/wordstat/M2_WORDSTAT_RETRO_GATE_AUDIT_2026-09-16.md
- docs/seo/serp/competitors/M4Q_R2_PASS_B_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md
- docs/seo/serp/competitors/M4Q_R2_TARGETED_M4C_RECHECK_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md
- docs/seo/technical/CURRENT_SITE_BASELINE_2026-09-16.md
- docs/seo/serp/competitors/M4_PROGRESS.md

If current governing or accepted authority materially differs from the frozen M6 gate:

VERDICT = HOLD_AUTHORITY_DRIFT

and stop.

======================================================================
1. NO PROVIDER / NO WEB
======================================================================

This Work task performs full-volume reconciliation only.

Forbidden:

WORDSTAT_EXECUTION
YANDEX_SEARCH_EXECUTION
ALICE_EXECUTION
GENSEARCH_EXECUTION
WEB_ACQUISITION_BY_WORK
NEW LIVE SITE CRAWL
GITHUB_WRITES

Required:

PROVIDER_CALLS = 0

Do not emit an executable Bridge command.

The output provider manifest is a CANDIDATE plan requiring separate Main Chat acceptance.

======================================================================
2. CURRENT PROVIDER / BRIDGE FACTS
======================================================================

Use the accepted fresh-research facts frozen in:

docs/seo/M6_PRE_ACQUISITION_RECONCILIATION_GATE_2026-09-23_R1.md

Binding current distinctions:

WORDSTAT OFFICIAL:
- GetTop supports phrase, regions, devices and numPhrases up to 2000.

CURRENT YMB 0.1.9 WORDSTAT:
- supports GetTop;
- supports regions;
- supports DEVICE_ALL / DEVICE_DESKTOP / DEVICE_PHONE / DEVICE_TABLET;
- supports batch up to 500 phrases.

SEARCH OFFICIAL:
- supports region;
- supports FORMAT_XML and FORMAT_HTML;
- supports userAgent for device/browser-sensitive results.

CURRENT YMB 0.1.9 SEARCH:
- fixed FORMAT_XML;
- does not accept userAgent;
- supports region.

Therefore:

CURRENT_BRIDGE_FULL_SERP_HTML = NOT_SUPPORTED
CURRENT_BRIDGE_SEARCH_DEVICE_USERAGENT_CONTROL = NOT_SUPPORTED
CURRENT_BRIDGE_REGIONAL_SEARCH_CONTROL = SUPPORTED

Do not turn provider capability into Bridge capability.

======================================================================
3. PRIMARY DEMAND-CANDIDATE SOURCE A — M4C R1
======================================================================

Read in full:

docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_M6_DEMAND_GAP_CANDIDATES.tsv

Required Git blob:

345b1aa7c1aac4f283b3d36361aa33cad369e267

Required data rows:

5973

These rows are competitor-derived validation candidates only.

They are NOT proven demand.

======================================================================
4. PRIMARY DEMAND-CANDIDATE SOURCE B — R2 TARGETED OVERLAY
======================================================================

Read in full:

docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv

Required Git blob:

dc9aa037a5da3101c72d4c6460109e4f69d5eea2

Required data rows:

133

Source status accounting:

ALREADY_PRESENT = 14
NEW_CANDIDATE = 64
POSSIBLE_VARIANT = 19
OUT_OF_SCOPE = 24
AMBIGUOUS = 12

All 133 must remain accounted.

Primary candidate-source universe:

5973 + 133 = 6106 rows

M6_DEMAND_CANDIDATE_RECONCILIATION.tsv must contain exactly 6106 data rows.

======================================================================
5. EXISTING WORDSTAT AUTHORITY — REUSE FIRST
======================================================================

Read in full:

docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv

Required Git blob:

9343048ed82f129b3f7433c46899e6f255a420a8

Required rows:

1123

Accepted current counts:

CONSERVATIVE_NORMALIZED_PROVIDER_STRINGS = 787
CONSERVATIVE_NORMALIZED_STRINGS_INCLUDING_SEEDS = 808

Also read:

- docs/seo/work/M2R_FULL_VOLUME_RECONCILIATION_2026-09-17.md
- docs/seo/work/M2R_RECONCILIATION_MAIN_CHAT_RETURN_QA_2026-09-17.md
- docs/seo/wordstat/M2_WORDSTAT_RETRO_GATE_AUDIT_2026-09-16.md

Existing exact-safe demand evidence must be reused.

Never schedule a Wordstat call merely to reproduce evidence already sufficient for the current decision.

Historical B01 envelope-format debt is not a reason for replay.

======================================================================
6. CURRENT M4Q ROUTING AUTHORITY
======================================================================

Read in full:

docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/M4Q_R2_QUERY_UNIVERSE_LEDGER_R2.tsv

Required Git blob:

23b1a272ddfae3bf03d2b4a57525a773ace7fdac

Required rows:

15542

This is supporting routing authority.

Do not add 15542 to the 6106 primary source-row accounting.

Use its accepted dispositions, especially:

DEFER_TO_M6_DEMAND_VALIDATION

to join current M4-derived wording to M6.

Do not turn M4C-only wording into query authority if M3/M2R authority is absent.

======================================================================
7. CURRENT M5 ROUTING AUTHORITY
======================================================================

Read in full:

docs/seo/work_return/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1/M5_INPUT_DISPOSITION_LEDGER.tsv

Required Git blob:

9f0ec02927c16046ec0d836133a5e660b8d29dbd

Required rows:

1000

Relevant current routing:

SEARCH_OR_M6_ONLY_NOT_AI_DIAGNOSTIC = 188
HOLD_AMBIGUOUS = 28

M5 rows are routing context only.

M5 hypotheses are NOT provider gaps.

M5_HYPOTHESIS_AS_PROVIDER_GAP = 0

======================================================================
8. CURRENT M4Q / TARGETED RECONCILIATION
======================================================================

Read in full:

docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_M4C_M6_RECONCILIATION.tsv

and:

docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_M4C_M6_RECONCILIATION.tsv

Use them to determine whether a demand observation could change a named downstream decision.

Search visibility itself is not demand.

======================================================================
9. EXACT-SAFE IDENTITY
======================================================================

For comparison only:

- Unicode NFC;
- outer trim;
- collapse internal whitespace;
- case-fold/lowercase.

Do not silently merge:

- morphology;
- synonyms;
- marketplace differences;
- distinct seller tasks;
- broad semantic themes.

Preserve POSSIBLE_VARIANT separately.

If one provider candidate covers multiple source rows only because the source wording is exact-safe identical, preserve all source-row provenance.

======================================================================
10. REQUIRED CANDIDATE DISPOSITIONS
======================================================================

Every one of the 6106 primary rows gets exactly one final disposition.

Allowed:

REUSE_EXISTING_WORDSTAT_EVIDENCE
EXACT_DUPLICATE_OF_REUSED_OR_PROVIDER_CANDIDATE
PROVIDER_REQUIRED_DEMAND_VALIDATION
NO_INCREMENTAL_INFORMATION_GAIN
OUT_OF_PRODUCT_SCOPE
HOLD_AMBIGUOUS
OWNER_OR_PRODUCT_FACT_REQUIRED

A provider-required row must satisfy all:

1. legitimate source wording;
2. product/task fit is material;
3. current accepted Wordstat does not already answer it;
4. current M4/Search evidence establishes a named decision that demand evidence could change;
5. valid zero is interpretable;
6. provider result can change an M6/M7 decision.

Frequency, competitor recurrence, Search rank, or NEW_CANDIDATE status alone is insufficient.

======================================================================
11. WORDSTAT PROVIDER CANDIDATE DESIGN
======================================================================

Do not execute.

For every proposed Wordstat action record:

- provider_candidate_id;
- linked M6 source rows / gap IDs;
- exact source phrase;
- proposed measurement mode;
- region;
- device;
- numPhrases;
- why current M2R is insufficient;
- exact information gain;
- positive interpretation;
- valid-zero interpretation;
- failure interpretation;
- unknown interpretation;
- stop rule;
- persistence path;
- downstream decision;
- Bridge capability state;
- execution_allowed_after_main_chat_acceptance.

Do not blindly reuse historical numPhrases=2000.

Choose depth based on information need.

Do not invent Wordstat operator semantics without source evidence; flag any operator-dependent exact-form plan for Main Chat re-verification before execution.

======================================================================
12. M3 CONTROL DEBT — ALL 15 QUERIES
======================================================================

Read:

- docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md
- docs/seo/serp/M3_METHOD_RETROSPECTIVE_AND_CONTROL_DEBT_2026-09-18.md

Read accepted M4A:

- M4A_SERP_OCCURRENCES_CLASSIFIED.tsv
- M4A_QUERY_PROFILES.tsv
- M4A_PAIRWISE_TOP10_SIMILARITY.tsv

Pairwise authority:

docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_PAIRWISE_TOP10_SIMILARITY.tsv

Required Git blob:

66a7e080adecb0231bf9cc60834248e5c03a2c67

Expected complete pairwise query pairs:

105/105

Read accepted M4Q R2 current query visibility summaries, which include all 15 M3 controls at a later 2026-09-23 timestamp.

For each of 15 M3 queries independently decide:

A. overlap control:
- REUSE_ACCEPTED_M4A
- HOLD

B. temporal organic repeat:
- REUSE_ACCEPTED_M4Q_R2_CURRENT_SNAPSHOT
- ADDITIONAL_REPEAT_HAS_INFO_GAIN
- HOLD

C. regional sensitivity:
- NO_MATERIAL_INFO_GAIN
- SEARCH_REGION_PROVIDER_CANDIDATE
- HOLD

D. full-SERP HTML:
- NO_MATERIAL_INFO_GAIN
- HOLD_BRIDGE_CAPABILITY_REQUIRED
- ALTERNATE_AUTHORIZED_METHOD_REQUIRED

E. device/browser:
- NO_MATERIAL_INFO_GAIN
- HOLD_BRIDGE_CAPABILITY_REQUIRED
- ALTERNATE_AUTHORIZED_METHOD_REQUIRED

No quota-based selection.

No blind M3 replay.

======================================================================
13. IMPORTANT BRIDGE LIMITATION
======================================================================

Current official Yandex API supports HTML and userAgent.

Current YMB 0.1.9 Search protocol does not.

Therefore Work MUST NOT generate an executable current-Bridge command pretending to request:

FORMAT_HTML

or:

userAgent

If a selected M3 control requires them:

BRIDGE_CAPABILITY_STATUS = HOLD_BRIDGE_CAPABILITY_REQUIRED
EXECUTION_ALLOWED = false

Regional XML Search may be provider-candidate planning if information gain is proven.

======================================================================
14. TEMPORAL REUSE RULE
======================================================================

M4Q R2 current Search evidence was captured 2026-09-23.

Historical M3 baseline is 2026-09-16/17.

For all 15 M3 exact queries, test whether this accepted later snapshot already satisfies the organic temporal-repeat purpose.

If yes:

NO NEW TEMPORAL SEARCH CALL.

If no:
state exactly what remains unknown and why another later snapshot would add decision value.

======================================================================
15. M1 PRE-M7 DEPENDENCY
======================================================================

Current M1 authority:

docs/seo/technical/CURRENT_SITE_BASELINE_2026-09-16.md

This is SOURCE AUDIT / NOT PRODUCTION CRAWL.

M1 still needs later closure of:

- live URL/HTTP/redirect/indexability;
- live rendered/indexable content;
- crawlable links/orphans as applicable;
- robots/sitemap live;
- Yandex Webmaster readiness/ownership;
- Google Search Console readiness/ownership;
- Metrika/approved measurement readiness;
- indexed/branded baseline where legitimately available;
- source-vs-live divergence.

This Work task does NOT execute M1.

Record M1_PRE_M7_DEPENDENCY in the gap register.

M7 cannot be released while M1 remains open.

======================================================================
16. REQUIRED OUTPUT 1 — SOURCE MANIFEST
======================================================================

Create:

M6_SOURCE_MANIFEST.md

Record all governing/current inputs, exact identities, parser rules, row counts, provider/Bridge capability facts, and authority drift.

======================================================================
17. REQUIRED OUTPUT 2 — 6106-ROW CANDIDATE RECONCILIATION
======================================================================

Create:

M6_DEMAND_CANDIDATE_RECONCILIATION.tsv

Exactly 6106 data rows.

At minimum:

- m6_source_row_id
- source_layer
- source_candidate_id
- registry_id
- raw_candidate_text
- normalized_exact_safe_key
- source_status
- source_evidence_refs
- product_scope_class
- m2r_exact_evidence_status
- m2r_source_refs
- m4q_route_status
- m5_route_status
- current_search_visibility_context
- information_gap_class
- m6_disposition
- provider_candidate_id
- disposition_reason
- claim_boundary

Required source layers:

M4C_R1_M6_CANDIDATE
M4Q_R2_TARGETED_CANDIDATE_DELTA

Required source accounting:

5973 + 133 = 6106

======================================================================
18. REQUIRED OUTPUT 3 — GAP REGISTER
======================================================================

Create:

M6_GAP_REGISTER.tsv

One row per deduplicated decision-level gap.

At minimum:

- m6_gap_id
- gap_class
- source_layers
- source_row_ids
- exact_open_question
- current_evidence_summary
- current_limitation
- information_gain_if_closed
- acquisition_required
- proposed_provider_or_source
- provider_candidate_ids
- valid_zero_meaning
- failure_unknown_boundary
- downstream_decision
- stop_rule
- reopen_rule
- current_state
- claim_boundary

Allowed classes include:

DEMAND_VALIDATION
SEARCH_INTENT_OR_VISIBILITY
M3_FULL_SERP_CONTROL
M3_DEVICE_CONTROL
M3_REGION_CONTROL
M3_TEMPORAL_CONTROL
M3_OVERLAP_CONTROL
OWNER_PRODUCT_FACT
M1_PRE_M7_DEPENDENCY
OTHER_EXPLICIT_HOLD

======================================================================
19. REQUIRED OUTPUT 4 — PROVIDER CANDIDATE MANIFEST
======================================================================

Create:

M6_PROVIDER_CANDIDATE_MANIFEST.tsv

Only candidate actions with a named information-gain contract or explicit Bridge capability hold.

At minimum:

- provider_candidate_id
- m6_gap_ids
- provider
- method
- exact_phrase_or_query
- search_type
- region
- devices_or_useragent_requirement
- response_format_requirement
- requested_depth
- current_evidence_insufficient_reason
- expected_information_gain
- positive_meaning
- valid_zero_meaning
- failure_meaning
- unknown_meaning
- stop_rule
- persistence_target
- downstream_decision
- bridge_capability_status
- execution_allowed
- notes

Allowed planned method classes:

WORDSTAT_GET_TOP
SEARCH_XML_REGION_CONTROL
SEARCH_XML_TEMPORAL_REPEAT
SEARCH_HTML_CONTROL_CAPABILITY_HOLD
SEARCH_USERAGENT_CONTROL_CAPABILITY_HOLD

Do not release provider execution.

======================================================================
20. REQUIRED OUTPUT 5 — M3 CONTROL PLAN
======================================================================

Create:

M6_M3_CONTROL_PLAN.tsv

Exactly 15 rows, one per accepted M3 exact query.

At minimum:

- m3_query_id
- exact_query_text
- current_decision_sensitivity
- historical_m3_baseline_ref
- current_m4q_r2_ref
- overlap_control_state
- temporal_control_state
- regional_control_state
- full_serp_html_control_state
- device_browser_control_state
- provider_candidate_ids
- expected_control_effect
- unresolved_blocker
- recommended_next_state
- notes

Do not conflate the five control dimensions.

======================================================================
21. REQUIRED OUTPUT 6 — QA
======================================================================

Create:

M6_QA.md

At minimum:

FROZEN_REQUIRED_BLOBS_MATCH =

M4C_BASE_M6_SOURCE_ROWS_ACCOUNTED = 5973/5973
TARGETED_OVERLAY_SOURCE_ROWS_ACCOUNTED = 133/133
TOTAL_PRIMARY_M6_SOURCE_ROWS = 6106/6106
SILENT_SOURCE_LOSS = 0

M2R_LINEAGE_REVIEWED = 1123/1123
M4Q_QUERY_UNIVERSE_REVIEWED = 15542/15542
M5_ROUTING_ROWS_REVIEWED = 1000/1000

REUSE_EXISTING_WORDSTAT_EVIDENCE =
EXACT_DUPLICATE =
PROVIDER_REQUIRED_DEMAND_VALIDATION =
NO_INCREMENTAL_INFORMATION_GAIN =
OUT_OF_PRODUCT_SCOPE =
HOLD_AMBIGUOUS =
OWNER_OR_PRODUCT_FACT_REQUIRED =
DISPOSITION_ACCOUNTING = 6106/6106

GAP_REGISTER_ROWS =
PROVIDER_CANDIDATE_ROWS =
WORDSTAT_PROVIDER_CANDIDATES =
SEARCH_PROVIDER_CANDIDATES =
BRIDGE_CAPABILITY_HOLD_ROWS =

M3_QUERIES_ACCOUNTED = 15/15
M3_OVERLAP_REUSE =
M3_TEMPORAL_REUSE_FROM_M4Q_R2 =
M3_REGION_PROVIDER_CANDIDATES =
M3_FULL_SERP_CAPABILITY_HOLDS =
M3_DEVICE_CAPABILITY_HOLDS =

M1_PRE_M7_DEPENDENCY_RECORDED = true

DUPLICATE_PROVIDER_ACQUISITION = 0
M5_HYPOTHESIS_AS_PROVIDER_GAP = 0
SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_TOPIC_AS_DEMAND = 0

PROVIDER_CALLS = 0
YANDEX_SEARCH_CALLS = 0
WORDSTAT_CALLS = 0
ALICE_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES = 0

OPEN_CRITICAL_DEFECTS =

======================================================================
22. REQUIRED OUTPUT 7 — RETURN MANIFEST
======================================================================

Create:

M6_RETURN_MANIFEST.json

Record exact bytes/SHA256/row counts for the six non-self outputs.

Use the established self-hash exclusion policy.

======================================================================
23. STOP CONDITIONS
======================================================================

HOLD_AUTHORITY_DRIFT:
current authority differs materially.

PARTIAL_REWORK_REQUIRED:
6106/6106 candidate source rows are not accounted.

HOLD_INPUT_IDENTITY:
a required frozen input blob differs.

Row-level HOLD is allowed.

Bridge capability HOLD is allowed and must not be converted into a fake command.

======================================================================
24. BEFORE RETURN
======================================================================

Re-fetch live remote branch.

Record END_OBSERVED_HEAD.

Classify authority drift.

Work must not write to GitHub.

======================================================================
25. PUBLICATION
======================================================================

Create exactly ONE downloadable ZIP containing exactly seven final files.

Owner uploads all seven unpacked files together to:

docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/

======================================================================
26. FINAL RESPONSE FORMAT
======================================================================

State:

WORK_ID =
START_HEAD =
END_OBSERVED_HEAD =
AUTHORITY_DRIFT_STATUS =
VERDICT =

M4C_BASE_M6_SOURCE_ROWS = 5973/5973
TARGETED_OVERLAY_SOURCE_ROWS = 133/133
TOTAL_PRIMARY_M6_SOURCE_ROWS = 6106/6106

REUSE_EXISTING_WORDSTAT_EVIDENCE =
EXACT_DUPLICATE =
PROVIDER_REQUIRED_DEMAND_VALIDATION =
NO_INCREMENTAL_INFORMATION_GAIN =
OUT_OF_PRODUCT_SCOPE =
HOLD_AMBIGUOUS =
OWNER_OR_PRODUCT_FACT_REQUIRED =

GAP_REGISTER_ROWS =
PROVIDER_CANDIDATE_ROWS =
WORDSTAT_PROVIDER_CANDIDATES =
SEARCH_PROVIDER_CANDIDATES =
BRIDGE_CAPABILITY_HOLD_ROWS =

M3_QUERIES_ACCOUNTED = 15/15
M3_OVERLAP_REUSE =
M3_TEMPORAL_REUSE_FROM_M4Q_R2 =
M3_REGION_PROVIDER_CANDIDATES =
M3_FULL_SERP_CAPABILITY_HOLDS =
M3_DEVICE_CAPABILITY_HOLDS =

M1_PRE_M7_DEPENDENCY_RECORDED = true

PROVIDER_CALLS = 0
YANDEX_SEARCH_CALLS = 0
WORDSTAT_CALLS = 0
ALICE_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0

FILES_IN_ZIP = 7
ZIP_SHA256 =
GITHUB_WRITES = 0

Provide one real downloadable ZIP.

Do not continue to provider execution, M1 live crawl, M7, M8, clustering or page ownership.
