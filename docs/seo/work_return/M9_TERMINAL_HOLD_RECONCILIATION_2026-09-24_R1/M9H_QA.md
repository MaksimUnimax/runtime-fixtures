# M9 terminal Search-only HOLD reconciliation QA

WORK_ID = OCTOPORT_SEO_M9_TERMINAL_HOLD_RECONCILIATION_2026-09-24_R1
START_HEAD = c20e333c04b42019589311c91095bb48911f35b5
END_OBSERVED_HEAD = c20e333c04b42019589311c91095bb48911f35b5
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED
VERDICT = PASS_TERMINAL_SEARCH_ONLY_RECONCILIATION

LEVEL1_READ = PASS
LEVEL2_READ = PASS
ROADMAP_CURRENT_STATE_READ = PASS
FAILURE_HISTORY_READ = PASS
PROMPT_BLOB_MATCH = true
INPUT_MANIFEST_BLOB_MATCH = true
PRE_HANDOFF_BLOB_MATCH = true
FROZEN_R2_INPUT_BLOBS_MATCH = true

MATERIAL_HOLD_ROWS = 1399/1399
MATERIAL_HOLD_EXACT_PAIR_SET_MATCH = true
ANCHOR_TO_ANCHOR = 477/477
ANCHOR_TO_NONANCHOR = 613/613
NONANCHOR_TO_NONANCHOR = 309/309
TERMINAL_CURRENT_SEARCH_CONFLICT = 477/477
HOLD_NO_SAFE_EXACT_QUERY_AUTHORITY = 922/922

NONANCHOR_IDENTITIES = 39/39
PAGE_TITLE_OR_SOURCE_PHRASE = 33/33
AMBIGUOUS_QUERY_FORM = 5/5
DEMAND_OR_TESTED_EXACT_QUERY = 1/1
NONANCHOR_POSITIVE_MATERIAL_HOLD_DEGREE = 38/38
NONANCHOR_ZERO_MATERIAL_HOLD_DEGREE = 1/1
PROVIDER_GAIN_LEDGER_ROWS = 39/39
AUTHORIZED_SEARCH_PROVIDER_CALLS = 0
QUERY_REPHRASE = 0
PAGE_TITLE_AS_QUERY = 0
AMBIGUOUS_QUERY_EXECUTION = 0
DUPLICATE_CURRENT_ANCHOR_QUERY = 0
ZERO_GAIN_QUERY_EXECUTION = 0

M10A_CARRY_ROWS = 104/104
CARRY_SEARCH_ONLY_HOLD_TO_M10A = 104/104
M10A_SEARCH_BASELINE_GATE_RECOMMENDATION = OPEN_WITH_EXPLICIT_HOLDS

PAIR_DECISION_DRIFT = 0
PAIR_REASON_DRIFT = 0
PAIR_RELATION_DRIFT = 0
SEARCH_OVERLAP_DRIFT = 0
CLUSTER_ID_DRIFT = 0
CLUSTER_STATE_DRIFT = 0
CLUSTER_MEMBERSHIP_DRIFT = 0

PROVIDER_CALLS = 0
BRIDGE_COMMANDS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES = 0
ALICE_INPUT_ROWS = 0
M10A_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0
INDEPENDENT_TERMINAL_QA = PASS
ADVERSARIAL_DIAGNOSTIC_ROWS = 16
OPEN_CRITICAL_DEFECTS = 0

## Independent full-volume checks

The accepted pair ledger has 5,356 rows (28 MERGE_SUPPORTED, 3,835 SPLIT_SUPPORTED, 1,493 HOLD_BOUNDARY). The material predicate was reapplied to every row independently of the accepted HOLD ledger. Its 1,399 pair IDs exactly equal the accepted HOLD ledger pair IDs, with no duplicate. Anchor endpoints were then recomputed from the separate accepted 65-row anchor map: 477 both anchored; 613 one anchored; 309 neither anchored. Those categories map to 477 current-Search conflicts and 922 boundaries without an authorized exact query.

The eligible identity set has 104 M8 Working identities. Subtracting all 65 unique current anchors yields precisely 39 identities. Their accepted pre-acquisition classes are 33 source/page titles, five ambiguous forms and one tested exact query. Recomputing material-HOLD degree from the 1,399-pair set yields 38 positive-degree and one zero-degree identity. All 104 current cluster IDs, member IDs, HOLD states, anchor query IDs and material-HOLD/support-merge degrees were cross-checked against accepted M9 R2 files; all 104 carry an explicit Search-only HOLD.

## Exact query and information gain

The sole safe exact-query non-anchor is `M8SID_aeb8b283519ced02`, exact accepted wording `ии для продаж на маркетплейсах`. Pre-acquisition authority classifies it `DEFER_SEARCH_CANDIDATE / DEMAND_OR_TESTED_EXACT_QUERY`, with M2R direct-result/tested-seed lineage and provider-limit PASS. Its material-HOLD degree is **0**. Therefore a new Search call cannot answer a named current material boundary, despite accepted query wording. This does not imply zero demand or irrelevance. Every one of the other 38 non-anchors with positive material-HOLD degree lacks a currently accepted safe exact query: 33 are source/title phrases and five are ambiguous. No wording was rewritten and none of the 65 existing anchors was queried again.

## Terminal status and reopen scope

`TERMINAL_CURRENT_SEARCH_CONFLICT` is bounded to the 477 pairs with two accepted exact current snapshots. A repeat in the same context supplies no proven incremental information; newly accepted authority or materially new evidence may reopen a pair. `HOLD_NO_SAFE_EXACT_QUERY_AUTHORITY` covers the 922 pairs with an unanchored page-title/source or ambiguous endpoint; accepted exact-query authority or another later causal source may reopen them. Current HOLD is retained for every pair and every cluster. Neither terminal class claims permanent impossibility, a split, a merge or a page owner.

## Downstream gate recommendation

All 1,399 material HOLDs, all 39 non-anchors and all 104 singleton HOLD clusters are accounted. Authorized Search calls = 0 and all accepted M9 pair/cluster blobs are unchanged. Accordingly this Work return **recommends** `M10A_SEARCH_BASELINE_GATE = OPEN_WITH_EXPLICIT_HOLDS`. It does not itself open M10A or assign owners. Main Chat must audit and accept the return before making that gate decision.

## Adversarial QA

Sixteen independent checks cover exact material pair-set identity, endpoint partition, eligibility, 33/5/1 query forms, degree reconstruction, 65-anchor no-duplicate gate, page-title and ambiguous query exclusion, the zero-gain exact query, immutable pair/cluster blobs, 104 carry rows, bounded terminal dispositions, Wave2 history and downstream gate order. No critical defect is open.
