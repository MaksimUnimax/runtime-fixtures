# Octoport SEO — M9 boundary-resolution full rerun after Wave-2 — Main Chat acceptance — 2026-09-24 R2

Status: **PASS_WITH_HOLD_BOUNDARIES / ACCEPTED_BOUNDED_AUTHORITY**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Accepted Work upload commit: `6b3fc513d12e9f20941c7c1841c5908422943cce`
Accepted Work return: `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/`

## Independent Main Chat acceptance

```text
RETURN_FILES = 9/9
RETURN_MANIFEST_HASH_MATCH = 8/8
RETURN_MANIFEST_BYTE_MATCH = 8/8
RETURN_MANIFEST_LINE_COUNT_MATCH = 8/8

WORK_START_HEAD = 776f703a4e4658e6e67d4e7addb12d8a501e1ae5
WORK_END_OBSERVED_HEAD = 776f703a4e4658e6e67d4e7addb12d8a501e1ae5
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED

ELIGIBILITY_ROWS = 7913/7913
CLUSTER_ELIGIBLE = 104/104
PAIRWISE_ROWS = 5356/5356
PAIRWISE_DUPLICATES = 0
PAIRWISE_SELF_PAIRS = 0

SEARCH_ANCHOR_MAP = 65/65
OLD_M4Q_SEARCH_ANCHORS = 22/22
WAVE1_SEARCH_ANCHORS = 25/25
WAVE2_SEARCH_ANCHORS = 18/18
NO_CURRENT_EXACT_SERP = 39/39

BOTH_CURRENT_SERP = 2080/2080
ONE_CURRENT_SERP = 2535/2535
NO_CURRENT_SERP = 741/741
CHANGED_COMPARABILITY_VS_R1 = 1701/1701
UNCHANGED_COMPARABILITY_VS_R1 = 3655/3655

R1_EXISTING_BILATERAL_OVERLAP_UNCHANGED = 1081/1081
BILATERAL_OVERLAP_RECOMPUTATION_MISMATCH = 0/2080
MISSING_SEARCH_NA_MISMATCH = 0/3276
CURRENT_QUERY_ID_MISMATCH = 0/5356
FROZEN_NON_SEARCH_PAIR_FIELD_DRIFT = 0

MERGE_SUPPORTED = 28
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1493
MATERIAL_HOLD = 1399

PAIR_DECISIONS_CHANGED_VS_R1 = 7
HOLD_TO_MERGE = 7
PAIR_REASON_CODES_CHANGED_VS_R1 = 99
UNCHANGED_COMPARABILITY_DECISION_OR_REASON_CHANGES = 0
ALL_CHANGED_DECISIONS_TOUCH_WAVE2 = true

MATERIAL_HOLD_LEDGER_ROWS = 1399/1399
MATERIAL_HOLD_LEDGER_EXACT_PAIR_SET = PASS

CLUSTER_MASTER_ROWS = 104/104
MEMBERSHIP_ROWS = 104/104
RETAINED_CLUSTER = 0
RETAINED_SINGLETON = 0
HOLD_CLUSTER_BOUNDARY = 104
CLUSTER_ID_OR_STATE_CHANGES_VS_R1 = 0
MEMBERSHIP_HOLD_DEGREE_MISMATCH = 0
MEMBERSHIP_MERGE_DEGREE_MISMATCH = 0
DETERMINISTIC_CLUSTER_ID_MISMATCH = 0

MERGE_EDGES = 28
MERGE_COMPONENTS = 11
ALL_MERGE_COMPONENTS_EXTERNALLY_BLOCKED_BY_MATERIAL_HOLD = true

PAIR_DECISION_CONTRACT_VIOLATIONS = 0
ELIGIBILITY_STRICT_NONSEARCH_DRIFT = 0
AD_HOC_PAGE_TYPE_INFERENCE = 0
MISSING_SERP_AS_ZERO_OVERLAP = 0
NO_SERP_TO_NO_SERP_MERGE = 0

PROVIDER_CALLS_BY_WORK = 0
BRIDGE_COMMANDS_BY_WORK = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
ALICE_INPUT_ROWS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0

OPEN_CRITICAL_DEFECTS = 0
MAIN_CHAT_QA = PASS
VERDICT = PASS_WITH_HOLD_BOUNDARIES / ACCEPTED_BOUNDED_AUTHORITY
```

## Eligibility delta explanation

All strict semantic/M8 eligibility fields are unchanged. The only data-state changes are the expected 18 Wave-2 identities moving from `NO_CURRENT_EXACT_SERP/NONE` to current Search anchors/query IDs. `eligibility_basis` changed only for the 104 cluster-eligible identities to identify the Wave-2 rerun, and `claim_boundary` changed uniformly for all 7,913 rows from Wave1-only wording to Wave1/Wave2 wording. This is not semantic authority drift.

## New decision review

All seven R1 HOLD -> R2 MERGE changes have frozen SAME task, SAME intent, SAME marketplace scope, COMPATIBLE product fit, no contrary frozen page-type authority, and bilateral current exact Search evidence. Their exact Top10/Top20 URL sets were independently reconstructed from the named accepted sources and match the R2 ledger exactly.

Comparable HOLD pairs with substantial overlap remain fail-closed where modifiers or answer-boundary uncertainty persists. No universal overlap threshold was introduced.

All 21 previously supported R1 merge edges remain `MERGE_SUPPORTED`; the original three edges are rechecked and preserved.

## Remaining Search-only material boundary

Current 1,399 material HOLD pairs split by Search-anchor availability:

```text
ANCHOR_TO_ANCHOR = 477
ANCHOR_TO_NONANCHOR = 613
NONANCHOR_TO_NONANCHOR = 309
TOTAL = 1399
```

Among the 39 remaining non-anchor identities:

```text
PERSISTENT_HOLD_NO_EXACT_QUERY_PROBE / PAGE_TITLE_OR_SOURCE_PHRASE = 33
QUERY_FORM_AMBIGUOUS_HOLD / AMBIGUOUS_QUERY_FORM = 5
DEFER_SEARCH_CANDIDATE / DEMAND_OR_TESTED_EXACT_QUERY = 1
```

The sole remaining exact-query candidate is `ии для продаж на маркетплейсах`; its current material-HOLD degree is 0, so another provider call has no proven boundary information gain. The other 38 non-anchor identities have positive material-HOLD degree but do not have accepted safe exact-query authority under the current frozen evidence.

Therefore this acceptance does **not** authorize another Search provider wave.

## Next cursor

Next physical step:
`M9 TERMINAL SEARCH-ONLY HOLD / INFORMATION-GAIN RECONCILIATION`.

Purpose:
- classify every remaining material HOLD as terminal Search-only HOLD versus legitimately reopenable evidence gap;
- prove whether any additional Search provider query is authorized under the information-gain rule;
- explicitly define the carry-forward HOLD contract for M10A;
- only after Main Chat accepts that closure may the M10A Search-only ownership/IA baseline gate be opened.

`M10A = BLOCKED_PENDING_TERMINAL_HOLD_RECONCILIATION`.
