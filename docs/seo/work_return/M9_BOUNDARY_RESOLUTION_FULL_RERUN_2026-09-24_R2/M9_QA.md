# M9 Wave2 full-rerun QA

WORK_ID = OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2
VERDICT = PASS_WITH_HOLD_BOUNDARIES
START_HEAD = 776f703a4e4658e6e67d4e7addb12d8a501e1ae5
END_OBSERVED_HEAD = 776f703a4e4658e6e67d4e7addb12d8a501e1ae5
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED
LEVEL1_READ = PASS (7/7 full files)
LEVEL2_READ = PASS (4/4 full files)
ROADMAP_CURRENT_STATE_READ = PASS
FAILURE_HISTORY_READ = PASS
M9_R1_ACCEPTANCE = PASS_WITH_HOLD_BOUNDARIES
R2_WORK_PROMPT_BLOB_MATCH = true
R2_PRE_HANDOFF_BLOB_MATCH = true
R2_INPUT_MANIFEST_BLOB_MATCH = true
R1_ACCEPTED_PAIRWISE_BLOB_MATCH = true
CURRENT_65_ANCHOR_MAP_BLOB_MATCH = true
WAVE2_TOP20_PROJECTION_BLOB_MATCH = true
WAVE2_TOP20_DECODED_SHA256_MATCH = true
ALL_16_DIRECT_INPUT_BLOBS_MATCH = true
AUDIT_FALLBACK_READS = 0

M8_IDENTITY_ROWS_ACCOUNTED = 7913/7913
CLUSTER_ELIGIBLE = 104/104
CARRIED_REVIEW_HOLD = 5064/5064
EXCLUDED_NOT_CLUSTERED = 2737/2737
BRAND_DEFENSE_SEPARATE = 8/8
SEARCH_ANCHOR_MAP = 65/65
OLD_M4Q_SEARCH_ANCHORS = 22/22
WAVE1_SEARCH_ANCHORS = 25/25
WAVE2_SEARCH_ANCHORS = 18/18
NO_CURRENT_EXACT_SERP = 39/39
SEARCH_ANCHOR_DUPLICATE_IDENTITIES = 0
SEARCH_ANCHOR_DUPLICATE_EXACT_QUERIES = 0
WAVE2_PROJECTION_ROWS = 360/360
WAVE2_PROJECTION_BYTES = 32421/32421
WAVE2_TOP10_UNIQUE_URLS = 18/18
WAVE2_TOP20_UNIQUE_URLS = 18/18

PAIRWISE_ROWS = 5356/5356
PAIRWISE_DUPLICATES = 0
PAIRWISE_SELF_PAIRS = 0
BOTH_CURRENT_SERP = 2080/2080
ONE_CURRENT_SERP = 2535/2535
NO_CURRENT_SERP = 741/741
CHANGED_COMPARABILITY_VS_R1 = 1701/1701
UNCHANGED_COMPARABILITY_VS_R1 = 3655/3655
OLD47_NEW18_ONE_TO_BOTH = 846/846
NEW18_NEW18_NONE_TO_BOTH = 153/153
NEW18_REMAINING39_NONE_TO_ONE = 702/702
BILATERAL_NUMERIC_OVERLAP_ROWS = 2080/2080
ONE_OR_NO_SERP_NA_OVERLAP_ROWS = 3276/3276
R1_EXISTING_BILATERAL_OVERLAP_UNCHANGED = 1081/1081
FROZEN_NON_SEARCH_PAIR_FIELD_DRIFT = 0

MERGE_SUPPORTED = 28
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1493
MATERIAL_HOLD = 1399
PAIR_DECISIONS_CHANGED_VS_R1 = 7
PAIR_REASON_CODES_CHANGED_VS_R1 = 99

CLUSTER_MASTER_ROWS = 104
RETAINED_CLUSTER = 0
RETAINED_SINGLETON = 0
HOLD_CLUSTER_BOUNDARY = 104
MEMBERSHIP_ROWS = 104/104
CLUSTER_MEMBERSHIPS_CHANGED_VS_R1 = 0
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
ADVERSARIAL_DIAGNOSTIC_ROWS = 31
PAIRS_CHANGED_AFTER_QA = 7
CLUSTERS_CHANGED_AFTER_QA = 0
OPEN_CRITICAL_DEFECTS = 0

## Full-volume accepted R1 versus R2 delta

All 7,913 eligibility rows and all 5,356 pairs were revisited. The twelve frozen non-Search pair fields, including accepted page-type relations, are byte-identical to R1. The old 1,081 bilateral pairs preserve all nine overlap metrics and their pair decision/reason; the new 999 bilateral pairs use only accepted Wave2 windows combined with old22/Wave1 as appropriate.

### Search comparability

| State | Accepted R1 | Current R2 |
|---|---:|---:|
| BOTH_CURRENT_SERP | 1081 | 2080 |
| NO_CURRENT_SERP | 1596 | 741 |
| ONE_CURRENT_SERP | 2679 | 2535 |


Transitions: ONE→BOTH = 846, NO→BOTH = 153, NO→ONE = 702; unchanged = 3,655. Bilateral source pairs: M4Q↔M4Q = 231; M4Q↔Wave1 = 550; Wave1↔Wave1 = 300; M4Q↔Wave2 = 396; Wave1↔Wave2 = 450; Wave2↔Wave2 = 153. Missing-Search metrics all `NA_NOT_COMPARABLE`.

### Decisions and evidence grades

| State | Accepted R1 | Current R2 |
|---|---:|---:|
| HOLD_BOUNDARY | 1500 | 1493 |
| MERGE_SUPPORTED | 21 | 28 |
| SPLIT_SUPPORTED | 3835 | 3835 |


Complete off-diagonal decision matrix: HOLD_BOUNDARY→MERGE_SUPPORTED = 7; every other old→new off-diagonal cell = 0. Diagonal: MERGE_SUPPORTED→MERGE_SUPPORTED = 21; SPLIT_SUPPORTED→SPLIT_SUPPORTED = 3,835; HOLD_BOUNDARY→HOLD_BOUNDARY = 1,493. Decisions changed = 7; reasons changed = 99. Every changed decision gained a new Wave2 exact Search anchor. For 3,655 pairs with unchanged comparability, decision and reason remain unchanged.

| State | Accepted R1 | Current R2 |
|---|---:|---:|
| A_CURRENT_SERP_BILATERAL | 743 | 1601 |
| B_CURRENT_SERP_UNILATERAL | 1 | 0 |
| C_NON_SERP_TASK_SPLIT | 3112 | 2262 |
| H_INSUFFICIENT_BOUNDARY | 1500 | 1493 |


### HOLD reasons and material HOLD

| State | Accepted R1 | Current R2 |
|---|---:|---:|
| H_GENERIC_SPECIFIC_UNRESOLVED | 154 | 169 |
| H_MIXED_INTENT_BOUNDARY | 668 | 668 |
| H_NO_BILATERAL_SERP_SAME_TASK | 246 | 194 |
| H_ONE_SERP_INSUFFICIENT | 112 | 89 |
| H_OTHER_BOUNDARY | 200 | 213 |
| H_SEARCH_EVIDENCE_CONFLICT | 120 | 160 |


Material HOLD predicate: HOLD pair, SAME/COMPATIBLE task, SAME/COMPATIBLE/AMBIGUOUS intent, marketplace scope != DIFFERENT, product answer != DIFFERENT. R1 = 1406; R2 = 1399; the HOLD ledger contains exactly 1399 distinct material pair IDs. This count is derived from the final new pair decisions.

### Cluster states and every membership delta

| State | Accepted R1 | Current R2 |
|---|---:|---:|
| HOLD_CLUSTER_BOUNDARY | 104 | 104 |


Cluster sizes before/after: 104 singleton HOLD groups each. Retained cluster count/member count: 0/0 before and after. Retained singleton count: 0 before and after. Changed cluster memberships, cluster IDs and cluster states: 0; the complete changed-membership set is empty. All 28 supported pair edges remain outside a retained cluster because material external HOLDs persist. The complete-link and external-HOLD gates were rebuilt from scratch.

### All 21 previously supported edges, including original three

| R1 pair ID | Exact identity texts | R2 decision | R2 reason | Current exact overlap |
|---|---|---|---|---|
| `M9PAIR_02cd1039fc0d9603` | плагин аналитики маркетплейсов ↔ расширение для аналитики маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 5; Top20 9 |
| `M9PAIR_89a68df2c5fc99a8` | плагин аналитики маркетплейсов ↔ плагин аналитика маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 5; Top20 12 |
| `M9PAIR_0c8046b6a5d93f5b` | плагин аналитики маркетплейсов ↔ расширение аналитика маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 4; Top20 12 |
| `M9PAIR_9e9fbf4667b178a8` | расширение для аналитики маркетплейсов ↔ плагин аналитика маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 4; Top20 11 |
| `M9PAIR_f38707954e1c5c1b` | расширение для аналитики маркетплейсов ↔ расширение аналитика маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 7; Top20 13 |
| `M9PAIR_f94cb0b0b3b4fa98` | ии для аналитики маркетплейсов ↔ ии аналитика маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 6; Top20 9 |
| `M9PAIR_5e27d2066dd6132b` | ии для аналитики маркетплейсов ↔ аналитика маркетплейсов с ии | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 6; Top20 10 |
| `M9PAIR_e7f782f1ba0f20a0` | сервисы аналитики маркетплейсов топ ↔ аналитика маркетплейсов сервисы анализа | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 4; Top20 10 |
| `M9PAIR_3aa9996ea4928075` | сервисы аналитики маркетплейсов топ ↔ аналитика маркетплейсов лучшие сервисы | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 7; Top20 17 |
| `M9PAIR_e7883f7c11fba27c` | сервисы аналитики маркетплейсов топ ↔ лучшие сервисы аналитики маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 7; Top20 17 |
| `M9PAIR_ac1f1bd0e24fd860` | сервис аналитика продаж на маркетплейсах ↔ сервис для аналитики продаж на маркетплейсах | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 4; Top20 9 |
| `M9PAIR_c146e07e6f13e778` | бесплатный сервис аналитики маркетплейсов ↔ сервис аналитика маркетплейсов бесплатно | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 7; Top20 14 |
| `M9PAIR_63bc080d35f91592` | отчеты продаж маркетплейсов ↔ отчеты маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 6; Top20 12 |
| `M9PAIR_f04b18a3a65537ed` | аналитика маркетплейсов сервисы анализа ↔ аналитика маркетплейсов лучшие сервисы | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 5; Top20 12 |
| `M9PAIR_296ac30ee8b6f00b` | аналитика маркетплейсов сервисы анализа ↔ лучшие сервисы аналитики маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 5; Top20 11 |
| `M9PAIR_d8d09565d02e3ba1` | программа аналитики маркетплейсов ↔ сервис аналитики маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 4; Top20 7 |
| `M9PAIR_8d092437fefbf78a` | плагин аналитика маркетплейсов ↔ расширение аналитика маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 4; Top20 12 |
| `M9PAIR_716f412c856d8db5` | подключить chatgpt к маркетплейсу ↔ chatgpt для маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 6; Top20 10 |
| `M9PAIR_05de1b08b2e7e6eb` | ии аналитика маркетплейсов ↔ аналитика маркетплейсов с ии | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 8; Top20 15 |
| `M9PAIR_43ad57b57894522c` | отчет для селлеров ↔ отчеты для селлеров | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 7; Top20 16 |
| `M9PAIR_6dd0747d5d6ba587` | аналитика маркетплейсов лучшие сервисы ↔ лучшие сервисы аналитики маркетплейсов | MERGE_SUPPORTED | M_SERP_URL_CONVERGENCE | BOTH_CURRENT_SERP; Top10 9; Top20 18 |

Original edge 1 (`отчеты продаж маркетплейсов` ↔ `отчеты маркетплейсов`) = MERGE_SUPPORTED; edge 2 (`программа аналитики маркетплейсов` ↔ `сервис аналитики маркетплейсов`) = MERGE_SUPPORTED; edge 3 (`подключить chatgpt к маркетплейсу` ↔ `chatgpt для маркетплейсов`) = MERGE_SUPPORTED. Prior R1 positives rechecked = 21/21.

### All changed decisions

| Pair ID | Exact identity texts | R1→R2 decision | R1→R2 reason |
|---|---|---|---|
| `M9PAIR_e9b024b2d0e2f11a` | Как анализировать отчет о продажах на Wildberries ↔ Как читать и анализировать отчеты о продажах на Wildberries | HOLD_BOUNDARY → MERGE_SUPPORTED | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_99a2d003e470a59d` | нейросеть для работы с маркетплейсами ↔ ии для работы с маркетплейсами | HOLD_BOUNDARY → MERGE_SUPPORTED | H_NO_BILATERAL_SERP_SAME_TASK → M_SERP_URL_CONVERGENCE |
| `M9PAIR_d72bdb85abc61fc1` | сервисы аналитики маркетплейсов топ ↔ аналитика маркетплейсов топ сервисов | HOLD_BOUNDARY → MERGE_SUPPORTED | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_81d45ae1bff72eff` | аналитика маркетплейсов сервисы анализа ↔ аналитика маркетплейсов топ сервисов | HOLD_BOUNDARY → MERGE_SUPPORTED | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_9cf0c0490d19aba6` | программа аналитики маркетплейсов ↔ программы аналитика маркетплейсов | HOLD_BOUNDARY → MERGE_SUPPORTED | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_1dc035d2a142140b` | аналитика маркетплейсов лучшие сервисы ↔ аналитика маркетплейсов топ сервисов | HOLD_BOUNDARY → MERGE_SUPPORTED | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |
| `M9PAIR_e75c1f5a3fa443fe` | лучшие сервисы аналитики маркетплейсов ↔ аналитика маркетплейсов топ сервисов | HOLD_BOUNDARY → MERGE_SUPPORTED | H_ONE_SERP_INSUFFICIENT → M_SERP_URL_CONVERGENCE |

## Independent adversarial QA and mechanism review

The 31 diagnostic rows re-enumerate the 5,356 pair IDs, reconstruct literal URL/domain sets from the three authorized sources, recompute all nine overlap metrics for 2,080 bilateral pairs, preserve 1,081 R1 bilateral overlap tuples, check all 1,701 transitions, keep all 3,276 missing-Search tuples NA, verify page-type freeze, check repeated Wave2 Top100 URLs below Top20, inspect 1,483 zero-overlap splits for independent accepted semantic separation, compare high-overlap different-task cases, all 21 R1 positive edges, original three edges, material external HOLD, complete-link, no-SERP singleton, non-WORKING admission, source-scope and duplicate membership.

Mechanism review: the initial full producer left seven new bilateral, same-answer sibling pairs on HOLD inconsistently with their frozen task/product/intent scope and accepted URL recurrence. Review identified four service-comparison clique edges, one singular/plural program edge, one WB sales-report reading/analysis edge and one generic marketplace-AI discovery edge. A proposed eighth program/service edge already had bilateral authority in accepted R1 and therefore remains HOLD; Wave2 adds no evidence to that pair. The producer was rerun over all 5,356 pairs after this evidence-locality correction. Sibling decision changes after QA: seven; cluster-state/membership changes: zero. No row-only patch or numeric overlap threshold was used.

The 18 Wave2 snapshots create Search comparability, not page-type authority, Wordstat demand, product capabilities, Alice evidence or page ownership. Historic M4A and M6 region-213 URLs do not enter current overlap sets. Accepted source export records three duplicate Top100 URLs below Top20; exact Top10/Top20 sets for all 18 are unique. M10A remains blocked pending independent Main Chat acceptance and resolution of material boundaries.
