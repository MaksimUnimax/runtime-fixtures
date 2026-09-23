# M6 pre-acquisition reconciliation QA

WORK_ID = OCTOPORT_SEO_M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1
START_HEAD = 409d2bde3f79432141400bd4258dfa23627bf99b
END_OBSERVED_HEAD = 409d2bde3f79432141400bd4258dfa23627bf99b
AUTHORITY_DRIFT_STATUS = NONE
VERDICT = PASS_PRE_ACQUISITION_PLAN_PENDING_MAIN_CHAT_ACCEPTANCE

FROZEN_REQUIRED_BLOBS_MATCH = 6/6
M4C_BASE_M6_SOURCE_ROWS_ACCOUNTED = 5973/5973
TARGETED_OVERLAY_SOURCE_ROWS_ACCOUNTED = 133/133
TOTAL_PRIMARY_M6_SOURCE_ROWS = 6106/6106
SILENT_SOURCE_LOSS = 0
M2R_LINEAGE_REVIEWED = 1123/1123
M4Q_QUERY_UNIVERSE_REVIEWED = 15542/15542
M5_ROUTING_ROWS_REVIEWED = 1000/1000
REUSE_EXISTING_WORDSTAT_EVIDENCE = 1
EXACT_DUPLICATE = 0
PROVIDER_REQUIRED_DEMAND_VALIDATION = 4
NO_INCREMENTAL_INFORMATION_GAIN = 2574
OUT_OF_PRODUCT_SCOPE = 1821
HOLD_AMBIGUOUS = 1676
OWNER_OR_PRODUCT_FACT_REQUIRED = 30
DISPOSITION_ACCOUNTING = 6106/6106
GAP_REGISTER_ROWS = 19
PROVIDER_CANDIDATE_ROWS = 15
WORDSTAT_PROVIDER_CANDIDATES = 4
SEARCH_PROVIDER_CANDIDATES = 11
BRIDGE_CAPABILITY_HOLD_ROWS = 9
M3_QUERIES_ACCOUNTED = 15/15
M3_OVERLAP_REUSE = 15
M3_TEMPORAL_REUSE_FROM_M4Q_R2 = 15
M3_REGION_PROVIDER_CANDIDATES = 2
M3_FULL_SERP_CAPABILITY_HOLDS = 6
M3_DEVICE_CAPABILITY_HOLDS = 3
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
OPEN_CRITICAL_DEFECTS = 0

## Reconciliation decisions

The 6106 primary rows derive exclusively from 5973 M4C grouped candidates and 133 targeted delta rows. The 1123 M2R, 15542 M4Q and 1000 M5 rows are cross-source evidence, never extra primary rows. Every source group and overlay ID is unique, fixed-width and terminal. Source status OUT_OF_SCOPE and AMBIGUOUS is preserved; M4Q content wording has no inherent query authority. An exact-safe M2R match with accepted seller fit is reused. No morphology or semantic near-duplicate shares a query.

Four source-observed seller-report phrases address three task-level gaps absent from all M2R raw phrases. GetTop is a phrase-containing popular-query and association measurement; a valid empty response is bounded no returned phrases at selected depth/interval, never zero global demand or proof no market. All four literal titles are preserved; no operator-exact-form semantics are asserted. A positive GetTop response is still a validation observation, not M7 page ownership. Four demand candidates, two XML region candidates, six HTML capability holds and three device capability holds are plans only.

The M3 historical top20 and current top100 are separate timestamps; all 15 current snapshots satisfy the temporal-repeat acquisition purpose without causal inference. M4A provides 105/105 Top10 pair comparisons. R08 historical competitor identity comparison remains HOLD_COMPARABILITY and sibling-host ambiguity remains outside this task. Selected regional, HTML and device questions address separate feature/intent dimensions; HTML and userAgent cannot be executed by current Bridge.

Open program dependencies: owner/product fact verification; held source identity; M1 live/measurement baseline required before M6 final closure/M7; optional M3 feature/device capability holds. These are recorded holds, not defects in this complete pre-acquisition reconciliation. No provider command was emitted.

## Serialization and mechanical checks

UTF-8 TSV physical lines have the documented header width. Embedded source newlines/carriage returns are escaped; quotes remain literal. Return JSON hashes six non-self outputs only; it omits its own SHA256 to avoid an impossible self-containing hash. ZIP will contain exactly seven root files.
