# M9 R2 Search-only clustering QA

WORK_ID = OCTOPORT_SEO_M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2  
START_HEAD = 50dbbc8edd9c466b7a441b524b545c146201e931  
END_OBSERVED_HEAD = 50dbbc8edd9c466b7a441b524b545c146201e931  
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED  
VERDICT = PASS_WITH_HOLD_BOUNDARIES

LEVEL1_READ = PASS  
LEVEL2_READ = PASS  
ROADMAP_CURRENT_STATE_READ = PASS  
FAILURE_HISTORY_READ = PASS  
FRESH_METHOD_RESEARCH_AUTHORITY_READ = PASS

M9_STEP_PREPARATION_R2_BLOB_MATCH = true  
M9_PRE_HANDOFF_R2_BLOB_MATCH = true  
M9_DIRECT_INPUT_MANIFEST_R2_BLOB_MATCH = true  
M9_SEARCH_ANCHOR_MAP_R2_BLOB_MATCH = true  
M8_ACCEPTANCE = PASS  
M8_IDENTITY_ROWS_ACCOUNTED = 7913/7913

ELIGIBILITY_ROWS = 7913/7913  
CLUSTER_ELIGIBLE = 104/104  
CARRIED_REVIEW_HOLD = 5064/5064  
EXCLUDED_NOT_CLUSTERED = 2737/2737  
BRAND_DEFENSE_SEPARATE = 8/8

SEARCH_ANCHOR_MAP = 22/22  
SEARCH_ANCHOR_DUPLICATE_QUERY_IDS = 0  
SEARCH_ANCHOR_MULTI_QUERY_IDENTITIES = 0

PAIRWISE_ROWS = 5356/5356  
PAIRWISE_DUPLICATES = 0  
PAIRWISE_SELF_PAIRS = 0  
BOTH_CURRENT_SERP = 231/231  
ONE_CURRENT_SERP = 1804/1804  
NO_CURRENT_SERP = 3321/3321

MISSING_SERP_AS_ZERO_OVERLAP = 0  
AD_HOC_URL_RENORMALIZATION = 0  
CURRENT_HISTORICAL_SERP_MIX = 0  
REGION_213_IN_RU225_OVERLAP = 0  
AD_HOC_PAGE_TYPE_INFERENCE = 0  
UNIVERSAL_OVERLAP_THRESHOLD_USED = 0

MEMBERSHIP_ROWS = 104/104  
IDENTITY_MULTI_CLUSTER_MEMBERSHIP = 0  
ELIGIBLE_IDENTITIES_WITHOUT_CLUSTER_STATE = 0  
RETAINED_CLUSTER_INTERNAL_SPLIT_PAIR = 0  
RETAINED_CLUSTER_INTERNAL_HOLD_PAIR = 0  
RETAINED_CLUSTER_EXTERNAL_MATERIAL_HOLD = 0  
RETAINED_MULTIMEMBER_CLUSTER_WITHOUT_SEARCH_ANCHOR = 0  
NO_SERP_TO_NO_SERP_MERGE = 0

M8_REVIEW_HOLD_CLUSTERED = 0  
M8_EXCLUDED_CLUSTERED = 0  
M8_BRAND_DEFENSE_ORDINARY_CLUSTERED = 0

ALICE_INPUT_ROWS = 0  
M5_HYPOTHESIS_USED = 0  
AI_SOURCE_USED_FOR_CLUSTER = 0  
FINAL_PAGE_OWNERSHIP_DECISIONS = 0  
FINAL_URL_H1_TITLE_IA_DECISIONS = 0

INDEPENDENT_CLUSTER_QA = PASS  
OPEN_CRITICAL_DEFECTS = 0  
PROVIDER_CALLS = 0  
WEB_ACQUISITION = 0  
GITHUB_WRITES = 0

### Pair decisions

| Value | Count |
|---|---:|
| `SPLIT_SUPPORTED` | 3835 |
| `HOLD_BOUNDARY` | 1518 |
| `MERGE_SUPPORTED` | 3 |

### Evidence grades

| Value | Count |
|---|---:|
| `C_NON_SERP_TASK_SPLIT` | 3654 |
| `H_INSUFFICIENT_BOUNDARY` | 1518 |
| `A_CURRENT_SERP_BILATERAL` | 183 |
| `B_CURRENT_SERP_UNILATERAL` | 1 |

### Pair reason distribution

| Value | Count |
|---|---:|
| `S_TASK_DIFFERENT` | 3608 |
| `H_MIXED_INTENT_BOUNDARY` | 668 |
| `H_NO_BILATERAL_SERP_SAME_TASK` | 445 |
| `H_ONE_SERP_INSUFFICIENT` | 150 |
| `S_INTENT_DIFFERENT` | 147 |
| `H_GENERIC_SPECIFIC_UNRESOLVED` | 145 |
| `H_OTHER_BOUNDARY` | 96 |
| `S_MARKETPLACE_ANSWER_DIFFERENT` | 64 |
| `H_SEARCH_EVIDENCE_CONFLICT` | 14 |
| `S_PRODUCT_ANSWER_DIFFERENT` | 13 |
| `S_PAGE_TYPE_DIFFERENT` | 3 |
| `M_SERP_URL_CONVERGENCE` | 2 |
| `M_ONE_SERP_TASK_COMPATIBLE` | 1 |

### Cluster state distribution

| Value | Count |
|---|---:|
| `HOLD_CLUSTER_BOUNDARY` | 104 |

### Cluster size distribution

| Value | Count |
|---|---:|
| `1` | 104 |

### Exact Search anchor count per retained cluster

| Value | Count |
|---|---:|

### Material HOLD reason distribution

| Value | Count |
|---|---:|
| `H_MIXED_INTENT_BOUNDARY` | 668 |
| `H_NO_BILATERAL_SERP_SAME_TASK` | 445 |
| `H_ONE_SERP_INSUFFICIENT` | 150 |
| `H_GENERIC_SPECIFIC_UNRESOLVED` | 140 |
| `H_SEARCH_EVIDENCE_CONFLICT` | 14 |
| `H_OTHER_BOUNDARY` | 7 |

### Independent diagnostic classes

| Value | Count |
|---|---:|
| `UNMATERIALIZED_SUPPORTED_MERGE` | 3 |
| `CHAIN_TRANSITIVE_OVERMERGE` | 1 |
| `GIANT_F3_ANALYTICS_CLUSTER` | 1 |
| `SERP_MERGE_METRICS` | 1 |
| `SAME_URL_DIFFERENT_TASK_INTENT` | 1 |
| `ZERO_OVERLAP_SPLIT_SEMANTIC` | 1 |
| `NO_SERP_MERGE` | 1 |
| `GENERIC_OZON_WB_SCOPE` | 1 |
| `SERVICE_COMPARE_REPORT_HELP` | 1 |
| `F1_AGENT_VS_F2_CONNECT` | 1 |
| `REPORT_VS_AD_PERFORMANCE` | 1 |
| `RETAINED_EXTERNAL_MATERIAL_HOLD` | 1 |
| `RETAINED_SINGLETON_MISSING_SERP` | 1 |
| `M8_NONWORKING_ADMISSION` | 1 |
| `DUPLICATE_MEMBERSHIP` | 1 |

## What the HOLD result means

Three pairs have positive Search/task merge evidence (two bilateral exact URL convergence, one one-sided exact Search anchor). Across the 104 eligible identities, 1,424 pair boundaries meet the R2 external-material-HOLD predicate. Each supported edge has unresolved plausible outside neighbors; retaining its pair as a multi-member cluster would violate the frozen rule. The three positive edges remain visible in the pair ledger.

All 104 memberships are singleton `HOLD_CLUSTER_BOUNDARY` and there are zero retained clusters or retained singletons. This is explicit uncertainty, not 104 finalized distinct pages. M10A cannot infer final page owners from these HOLD memberships. Main Chat decides whether to accept M9 as a bounded analytical return, target additional Search collection under a separate release, or revise the method upstream. Work did not call a provider.

## Independent adversarial QA

ADVERSARIAL_DIAGNOSTIC_ROWS = 17  
PAIRS_CHANGED_AFTER_QA = 0  
CLUSTERS_CHANGED_AFTER_QA = 0  
ROOT_CAUSE_OF_MECHANISM_REWORK = NONE_AFTER_FINAL_FULL_UNIVERSE_QA  
SIBLING_CHANGE_REPORT = 0 pair changes and 0 membership/cluster changes after independent QA.

A second parser recomputed all 231 comparable pairs from the frozen current M4Q RU225 `result_url_normalized`/`result_domain` sets and rank windows; 231/231 count, union and six-decimal Jaccard tuples matched. It separately enumerated all 5,356 unordered pairs and the 1,424 material HOLD edges, checked all three positive edges, verified no-snapshot NA fields, validated accepted page-type mapping, and tested 14 named adversarial classes across the full universe.

### Failure regressions

| Failure mode | Violations | Independent check |
|---|---:|---|
| Transitive/chain overmerge | 0 | Every possible positive chain checked against third edge; no unlicensed group. |
| Giant F3 analytics cluster | 0 | All F3 pairs scanned; no preliminary family became a cluster. |
| Weak or contradictory exact-SERP merge | 0 | Three positive pairs rechecked against URL/task/intent/product/scope. |
| Shared URLs with different task/intent merged | 0 | All comparable shared-URL pairs examined. |
| Zero-overlap split without semantic distinction | 0 | All comparable zero-URL splits require task, intent, scope, product or accepted page-type basis. |
| No-SERP pair merge | 0 | All 3,321 no/no pairs inspected. |
| Generic/Ozon/WB forced merge | 0 | Scope relation and all marketplace crossing pairs checked. |
| Service comparison/report help or F1/F2/advertising false merge | 0 | Relevant full pair classes checked. |
| Retained cluster with external material HOLD | 0 | 1,424 material pairs joined to 104 cluster memberships. |
| Retained singleton solely due to missing Search | 0 | None retained. |
| M8 nonworking admission or duplicate membership | 0 | 7,913 eligibility rows and 104 unique membership IDs reconciled. |

No current Search result was recast as Wordstat demand. Historical M4A profiles provide only seven authorized page-type annotations; M6 region-213 control results provide no RU225 URL overlap values.

## Downstream boundary

M9 pair/cluster HOLD is a valid explicit output. This return does not create query-to-page assignments or Page/URL/H1/Title/IA states. M10A remains blocked pending Main Chat readback and acceptance, with the unresolved cluster boundaries plainly surfaced.

