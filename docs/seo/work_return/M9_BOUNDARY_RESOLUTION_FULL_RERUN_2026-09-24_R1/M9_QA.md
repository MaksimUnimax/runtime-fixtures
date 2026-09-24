# M9 Search authority full rerun QA

WORK_ID = OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1
VERDICT = PASS_WITH_HOLD_BOUNDARIES
START_HEAD = 6f6d22168ffd2e065264df5716fcb0ef6a7310ac
END_OBSERVED_HEAD = 6f6d22168ffd2e065264df5716fcb0ef6a7310ac
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED

LEVEL1_READ = PASS (7/7 full files)
LEVEL2_READ = PASS (4/4 full files)
ROADMAP_CURRENT_STATE_READ = PASS
FAILURE_HISTORY_READ = PASS
M9_R2_METHOD_AUTHORITY_UNCHANGED = PASS
M8_ACCEPTANCE = PASS
RERUN_PRE_HANDOFF_BLOB_MATCH = true
RERUN_INPUT_MANIFEST_BLOB_MATCH = true
BASE_R2_INPUT_MANIFEST_BLOB_MATCH = true
CURRENT_47_ANCHOR_MAP_BLOB_MATCH = true
NEW_TOP20_PROJECTION_BLOB_MATCH = true
ACCEPTED_R2_PAIRWISE_BLOB_MATCH = true
ALL_29_UNIQUE_DIRECT_FILE_BLOBS_MATCH = true
AUDIT_FALLBACK_READS = 0

M8_IDENTITY_ROWS_ACCOUNTED = 7913/7913
CLUSTER_ELIGIBLE = 104/104
CARRIED_REVIEW_HOLD = 5064/5064
EXCLUDED_NOT_CLUSTERED = 2737/2737
BRAND_DEFENSE_SEPARATE = 8/8
SEARCH_ANCHOR_MAP = 47/47
OLD_SEARCH_ANCHORS = 22/22
NEW_WAVE1_SEARCH_ANCHORS = 25/25
NO_CURRENT_EXACT_SERP = 57/57
SEARCH_ANCHOR_DUPLICATE_IDENTITIES = 0
SEARCH_ANCHOR_DUPLICATE_EXACT_QUERIES = 0
DECODED_TOP20_PROJECTION_ROWS = 500/500
DECODED_TOP20_PROJECTION_BYTES = 45666/45666
DECODED_TOP20_PROJECTION_SHA256_MATCH = true

PAIRWISE_ROWS = 5356/5356
PAIRWISE_DUPLICATES = 0
PAIRWISE_SELF_PAIRS = 0
BOTH_CURRENT_SERP = 1081/1081
ONE_CURRENT_SERP = 2679/2679
NO_CURRENT_SERP = 1596/1596
CHANGED_COMPARABILITY = 2275/2275
UNCHANGED_COMPARABILITY = 3081/3081
OLD_NEW_ONE_TO_BOTH = 550/550
NEW_NEW_NONE_TO_BOTH = 300/300
NEW_REMAINING_NONE_TO_ONE = 1425/1425
BILATERAL_NUMERIC_OVERLAP_ROWS = 1081/1081
ONE_OR_NO_SERP_NA_OVERLAP_ROWS = 4275/4275
OLD_OLD_OVERLAP_METRICS_UNCHANGED = 231/231
FROZEN_NON_SEARCH_PAIR_FIELD_DRIFT = 0

MERGE_SUPPORTED = 21
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1500
MATERIAL_HOLD = 1406
PAIR_DECISIONS_CHANGED_VS_R2 = 18
PAIR_REASON_CODES_CHANGED_VS_R2 = 290

CLUSTER_MASTER_ROWS = 104
RETAINED_CLUSTER = 0
RETAINED_SINGLETON = 0
HOLD_CLUSTER_BOUNDARY = 104
MEMBERSHIP_ROWS = 104/104
CLUSTER_MEMBERSHIPS_CHANGED_VS_R2 = 0
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

MISSING_SERP_AS_ZERO_OVERLAP = 0
AD_HOC_URL_RENORMALIZATION = 0
AD_HOC_DOMAIN_RENORMALIZATION = 0
CURRENT_HISTORICAL_SERP_MIX = 0
REGION_213_IN_RU225_OVERLAP = 0
AD_HOC_PAGE_TYPE_INFERENCE = 0
UNIVERSAL_OVERLAP_THRESHOLD_USED = 0
PARTIAL_PAIR_PATCH = 0
ALICE_INPUT_ROWS = 0
AI_SOURCE_USED_FOR_CLUSTER = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0
PROVIDER_CALLS = 0
BRIDGE_COMMANDS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES = 0
INDEPENDENT_CLUSTER_QA = PASS
ADVERSARIAL_DIAGNOSTIC_ROWS = 28
PAIRS_CHANGED_AFTER_QA = 6
CLUSTERS_CHANGED_AFTER_QA = 0
OPEN_CRITICAL_DEFECTS = 0

## Full baseline deltas

The frozen M8 eligibility, 12 non-Search pair fields and accepted R2 page-type relations remained identical for every identity/pair. The old 231 current bilateral pairs retained their nine exact overlap metrics, pair decisions and reason codes. All 5,356 pairs were nevertheless recomputed.

### Search comparability

| Measure | Before R2 | After rerun |
|---|---:|---:|
| BOTH_CURRENT_SERP | 231 | 1081 |
| NO_CURRENT_SERP | 3321 | 1596 |
| ONE_CURRENT_SERP | 1804 | 2679 |


Transitions: ONE → BOTH = 550; NO → BOTH = 300; NO → ONE = 1,425; unchanged = 3,081. Bilateral Top10/Top20 URL and Top10 domain intersection/union/Jaccard were independently recalculated for all 1,081 bilateral pairs from literal source strings. The other 4,275 pairs carry `NA_NOT_COMPARABLE` in all nine overlap fields.

### Pair decisions and evidence grades

| Measure | Before R2 | After rerun |
|---|---:|---:|
| HOLD_BOUNDARY | 1518 | 1500 |
| MERGE_SUPPORTED | 3 | 21 |
| SPLIT_SUPPORTED | 3835 | 3835 |


Changed-decision matrix: `HOLD_BOUNDARY → MERGE_SUPPORTED = 18`; all other off-diagonal cells = 0. Total decision changes = 18. Total reason changes = 290. The 18 changed decisions have a new accepted Wave1 anchor; no decision/reason changes occurred among 3,081 unchanged-comparability pairs.

| Measure | Before R2 | After rerun |
|---|---:|---:|
| A_CURRENT_SERP_BILATERAL | 183 | 743 |
| B_CURRENT_SERP_UNILATERAL | 1 | 1 |
| C_NON_SERP_TASK_SPLIT | 3654 | 3112 |
| H_INSUFFICIENT_BOUNDARY | 1518 | 1500 |


### HOLD reasons and material HOLD

| Measure | Before R2 | After rerun |
|---|---:|---:|
| H_GENERIC_SPECIFIC_UNRESOLVED | 145 | 154 |
| H_MIXED_INTENT_BOUNDARY | 668 | 668 |
| H_NO_BILATERAL_SERP_SAME_TASK | 445 | 246 |
| H_ONE_SERP_INSUFFICIENT | 150 | 112 |
| H_OTHER_BOUNDARY | 96 | 200 |
| H_SEARCH_EVIDENCE_CONFLICT | 14 | 120 |


Material HOLD predicate: HOLD decision, SAME/COMPATIBLE task, SAME/COMPATIBLE/AMBIGUOUS intent, and neither scope nor product relation DIFFERENT. Old material HOLD = 1424; recomputed current material HOLD = 1406. The material HOLD ledger contains exactly 1406 distinct pair IDs. Missing Search and zero URL overlap never themselves imply a split.

### Cluster states and membership

| Measure | Before R2 | After rerun |
|---|---:|---:|
| HOLD_CLUSTER_BOUNDARY | 104 | 104 |


Old and new cluster-size distribution: 104 one-member HOLD groups. Retained clusters = 0, retained members = 0, retained singletons = 0. Changed cluster memberships = 0; changed cluster IDs = 0; changed cluster states = 0. All 21 supported merge edges remain unmaterialized because external material HOLDs remain. Complete-link and external-HOLD gates were rebuilt from the new pair ledger rather than copied from R2. M10A remains blocked.

### Three previously accepted merge edges

| Pair ID | Exact accepted identity texts | New decision | New reason | Current Search |
|---|---|---|---|---|
| `M9PAIR_63bc080d35f91592` | отчеты продаж маркетплейсов ↔ отчеты маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10=6, Top20=12 |
| `M9PAIR_d8d09565d02e3ba1` | программа аналитики маркетплейсов ↔ сервис аналитики маркетплейсов | MERGE_SUPPORTED | M_ONE_SERP_TASK_COMPATIBLE | ONE_CURRENT_SERP; Top10=NA_NOT_COMPARABLE, Top20=NA_NOT_COMPARABLE |
| `M9PAIR_716f412c856d8db5` | подключить chatgpt к маркетплейсу ↔ chatgpt для маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10=6, Top20=10 |

All three remain positive pair edges and none forms a retained group while material outside boundaries remain. The second edge has only one current exact Search snapshot; no overlap metric is inferred for it.

### All changed pair decisions

| Pair ID | Accepted identity texts | Old → new reason |
|---|---|---|
| `M9PAIR_02cd1039fc0d9603` | плагин аналитики маркетплейсов ↔ расширение для аналитики маркетплейсов | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_89a68df2c5fc99a8` | плагин аналитики маркетплейсов ↔ плагин аналитика маркетплейсов | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_0c8046b6a5d93f5b` | плагин аналитики маркетплейсов ↔ расширение аналитика маркетплейсов | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_9e9fbf4667b178a8` | расширение для аналитики маркетплейсов ↔ плагин аналитика маркетплейсов | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_f38707954e1c5c1b` | расширение для аналитики маркетплейсов ↔ расширение аналитика маркетплейсов | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_f94cb0b0b3b4fa98` | ии для аналитики маркетплейсов ↔ ии аналитика маркетплейсов | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_5e27d2066dd6132b` | ии для аналитики маркетплейсов ↔ аналитика маркетплейсов с ии | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_e7f782f1ba0f20a0` | сервисы аналитики маркетплейсов топ ↔ аналитика маркетплейсов сервисы анализа | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_3aa9996ea4928075` | сервисы аналитики маркетплейсов топ ↔ аналитика маркетплейсов лучшие сервисы | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_e7883f7c11fba27c` | сервисы аналитики маркетплейсов топ ↔ лучшие сервисы аналитики маркетплейсов | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_ac1f1bd0e24fd860` | сервис аналитика продаж на маркетплейсах ↔ сервис для аналитики продаж на маркетплейсах | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_c146e07e6f13e778` | бесплатный сервис аналитики маркетплейсов ↔ сервис аналитика маркетплейсов бесплатно | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_f04b18a3a65537ed` | аналитика маркетплейсов сервисы анализа ↔ аналитика маркетплейсов лучшие сервисы | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_296ac30ee8b6f00b` | аналитика маркетплейсов сервисы анализа ↔ лучшие сервисы аналитики маркетплейсов | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_8d092437fefbf78a` | плагин аналитика маркетплейсов ↔ расширение аналитика маркетплейсов | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_05de1b08b2e7e6eb` | ии аналитика маркетплейсов ↔ аналитика маркетплейсов с ии | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_43ad57b57894522c` | отчет для селлеров ↔ отчеты для селлеров | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_6dd0747d5d6ba587` | аналитика маркетплейсов лучшие сервисы ↔ лучшие сервисы аналитики маркетплейсов | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |

## Independent adversarial testing and mechanism review

The 28 diagnostic rows independently enumerate C(104,2), reconstruct all current URL/domain sets and all 1,081 bilateral nine-field overlap tuples, verify 231 old-old unchanged pairs, examine 680 zero-overlap splits for independently accepted task/product/intent/page-type separation, inspect high-overlap different-task cases, test F3 giant-family, F1-versus-F2, Ozon/WB, commercial comparison versus report, ad/DRR, missing Search, no-SERP merge, chain overmerge, retained external HOLD, non-WORKING admission, duplicate membership, all three old merge edges, full rerun, provider/AI/page boundary.

Mechanism defect discovered before publication: the first complete 5,356-pair run judged 15 positive edges, but three plugin/extension sibling edges and three analytics-service comparison sibling edges had inconsistent same-task/high-recurrence judgments. The complete affected 5,356-pair producer was reviewed and rerun with six additional individually checked sibling edges; positive edges then numbered 21. The entire 1,406-material-HOLD set, 104 clusters and 28 adversarial cases were rerun. Pair decisions changed after that QA review = 6; cluster memberships and states changed = 0. The six sibling IDs are recorded in the 18-pair changed-decision table and the `SIBLING_POSITIVE_CLIQUES` diagnostic. No one-row output patch was made.

## Search evidence and claim boundary

47 exact query anchors use SEARCH_TYPE_RU, region 225, depth 100, FLAT, docs/group 1, MODERATE family and typo correction OFF. M4Q supplies old 22 Top100 rank/URL/domain records; the accepted Wave1 Top20 projection supplies new 25 overlap records. Historical M4A dominant page types stay as frozen pair annotations; new result text does not produce a page-type class. No Wordstat demand inference, provider result-as-product claim, Alice input, page ownership or IA decision. This output is bounded M9 Search-only authority with 1,406 open material pair boundaries.
