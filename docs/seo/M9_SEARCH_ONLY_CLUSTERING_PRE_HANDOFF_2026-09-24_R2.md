# M9 Search-only clustering — PRE-HANDOFF R2

WORK_ID: `OCTOPORT_SEO_M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2`
ROADMAP_STAGE: `M9 / W2`
Status: **READY FOR WORK PROMPT AFTER REMOTE READBACK**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
CURRENT_REMOTE_HEAD: `3487ac7301e0974cfc547ea2243b572fc7e253b1`

## Current authority

Step preparation:
`docs/seo/M9_STEP_PREPARATION_2026-09-24_R2.md`
blob `7ad9740eecf8433f678860c122971bd9c6a73de1`.

Direct-input manifest:
`docs/seo/M9_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-24_R2.json`
blob `424f2e61c54388c90fb5cc91495f7f5c8f81898b`.

Search-anchor map:
`docs/seo/M9_SEARCH_ANCHOR_MAP_2026-09-24_R2.tsv`
blob `61a6d6c5befbc20f75fadddfd035b7affc6fe14c`.

M8 acceptance:
`docs/seo/M8_R3_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-24_R1.md`.

R1 M9 preparation/pre-handoff/prompt:
`SUPERSEDED / DO NOT EXECUTE`.

## Why Work

```text
M8_IDENTITIES = 7913
CLUSTER_ELIGIBLE = 104
PAIRWISE = 5356
SEARCH_ANCHORED_WORKING = 22
NO_EXACT_SERP_WORKING = 82
DIRECT_CONTEXT_INPUTS = 19
```

Full pairwise evidence, Search joins, cluster construction and adversarial QA require Work.
Sampling/first-N/truncation are forbidden.

## Allowed inputs

Exactly the 19 R2 manifest files.

Audit fallback outside manifest:
only for named provenance discrepancy, disclosed in source manifest.

## Prohibited

- M5/Alice/GenSearch semantic input;
- new provider/web acquisition;
- REVIEW_HOLD/EXCLUDED/BRAND identities as ordinary cluster members;
- lexical/preliminary-family similarity as sufficient cluster proof;
- ad-hoc URL re-normalization;
- mixing historical M4A rows into current M4Q URL overlap;
- mixing M6 region-213 rows into RU225 overlap;
- ad-hoc page-type classification from raw M4Q titles/snippets;
- universal numeric SERP-overlap threshold.

## Eligibility

```text
CLUSTER_ELIGIBLE = 104
CARRIED_REVIEW_HOLD = 5064
EXCLUDED_NOT_CLUSTERED = 2737
BRAND_DEFENSE_SEPARATE = 8
```

Eligibility ledger must account all 7,913 identities.

## Search anchors

Exactly 22/104 eligible identities map 1:1 to 22 unique M4Q RU225 Top100 query IDs.

Overlap source:
`M4Q_R2_SERP_RESULT_LEDGER.tsv`.

Exact URL field:
`result_url_normalized`.

Domain field:
`result_domain`.

Rank cuts:
Top10 = rank <= 10; Top20 = rank <= 20.

Use unique sets.
No further URL normalization.

M4A is historical/supporting context only.
M6 region-213 is sensitivity context only.

## Page type

Use M4A `dominant_top10_page_type` only for anchors explicitly mapped to accepted M4A query authority in the R2 Search-anchor map.

Otherwise:
`NA_NOT_AUTHORIZED`.

No new page-type inference.

## Pairwise universe

Exactly:
`5356` unordered pairs.

```text
BOTH_CURRENT_SERP = 231
ONE_CURRENT_SERP = 1804
NO_CURRENT_SERP = 3321
```

For one/no current SERP:
overlap metrics = `NA_NOT_COMPARABLE`, not zero.

Pair decisions:
```text
MERGE_SUPPORTED
SPLIT_SUPPORTED
HOLD_BOUNDARY
```

Evidence grades:
```text
A_CURRENT_SERP_BILATERAL
B_CURRENT_SERP_UNILATERAL
C_NON_SERP_TASK_SPLIT
H_INSUFFICIENT_BOUNDARY
```

A no-current-SERP/no-current-SERP pair may not be MERGE_SUPPORTED.

## Pair reason codes

MERGE:
- `M_SERP_URL_CONVERGENCE`
- `M_ONE_SERP_TASK_COMPATIBLE`

SPLIT:
- `S_TASK_DIFFERENT`
- `S_INTENT_DIFFERENT`
- `S_MARKETPLACE_ANSWER_DIFFERENT`
- `S_PRODUCT_ANSWER_DIFFERENT`
- `S_PAGE_TYPE_DIFFERENT`
- `S_SERP_DIVERGENCE_WITH_SEMANTIC_SPLIT`

HOLD:
- `H_NO_BILATERAL_SERP_SAME_TASK`
- `H_ONE_SERP_INSUFFICIENT`
- `H_GENERIC_SPECIFIC_UNRESOLVED`
- `H_MIXED_INTENT_BOUNDARY`
- `H_PAGE_TYPE_AMBIGUOUS`
- `H_SEARCH_EVIDENCE_CONFLICT`
- `H_OTHER_BOUNDARY`

No ad-hoc codes.

## Cluster construction

Cluster ID:
`M9CL_<first16 sha256(sorted member semantic IDs joined with newline)>`.

States:
```text
RETAINED_CLUSTER
RETAINED_SINGLETON
HOLD_CLUSTER_BOUNDARY
```

Retained multi-member cluster requires:
- every intra pair = MERGE_SUPPORTED;
- no intra SPLIT/HOLD;
- >=1 current Search anchor.

No transitive chain overmerge.

External material HOLD:
if a retained candidate has a HOLD to an outside identity with compatible/same task+intent and product/scope not DIFFERENT, retained state is forbidden.

No-SERP:
- may join only anchored cluster and must merge with every member;
- no-SERP/no-SERP merge = forbidden;
- no-SERP singleton retained only if all plausible same-page neighbors are SPLIT_SUPPORTED;
- otherwise HOLD.

Unresolved identities are singleton `HOLD_CLUSTER_BOUNDARY`; pair ledger preserves unresolved alternatives.

## Outputs — exactly 9

1. `M9_SOURCE_MANIFEST.md`
2. `M9_IDENTITY_ELIGIBILITY_LEDGER.tsv`
3. `M9_PAIRWISE_CLUSTER_EVIDENCE.tsv`
4. `M9_CLUSTER_MASTER.tsv`
5. `M9_CLUSTER_MEMBERSHIP.tsv`
6. `M9_HOLD_BOUNDARY_LEDGER.tsv`
7. `M9_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M9_QA.md`
9. `M9_RETURN_MANIFEST.json`

## Required counts / hard gates

```text
ELIGIBILITY_ROWS = 7913
CLUSTER_ELIGIBLE = 104
PAIRWISE_ROWS = 5356
MEMBERSHIP_ROWS = 104

PAIRWISE_DUPLICATES = 0
PAIRWISE_SELF_PAIRS = 0
IDENTITY_MULTI_CLUSTER_MEMBERSHIP = 0

MISSING_SERP_AS_ZERO_OVERLAP = 0
AD_HOC_URL_RENORMALIZATION = 0
CURRENT_HISTORICAL_SERP_MIX = 0
REGION_213_IN_RU225_OVERLAP = 0
AD_HOC_PAGE_TYPE_INFERENCE = 0
UNIVERSAL_OVERLAP_THRESHOLD_USED = 0

RETAINED_CLUSTER_INTERNAL_SPLIT_PAIR = 0
RETAINED_CLUSTER_INTERNAL_HOLD_PAIR = 0
RETAINED_CLUSTER_EXTERNAL_MATERIAL_HOLD = 0
RETAINED_MULTIMEMBER_CLUSTER_WITHOUT_SEARCH_ANCHOR = 0
NO_SERP_TO_NO_SERP_MERGE = 0

M8_REVIEW_HOLD_CLUSTERED = 0
M8_EXCLUDED_CLUSTERED = 0
M8_BRAND_DEFENSE_ORDINARY_CLUSTERED = 0

ALICE_INPUT_ROWS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0

INDEPENDENT_CLUSTER_QA = PASS
OPEN_CRITICAL_DEFECTS = 0
```

## Stop

```text
HOLD_AUTHORITY_DRIFT
HOLD_INPUT_IDENTITY
HOLD_PAIRWISE_ACCOUNTING
HOLD_CLUSTER_CONTRACT_DEFECT
```

Cluster/pair HOLD is valid and expected.

## Publication

One ZIP with exactly 9 files.
Work does not write GitHub.

Staging:
`docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2/`

Upload:
`https://github.com/MaksimUnimax/runtime-fixtures/upload/seo/wordstat-batch-01-2026-09-16/docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2/`

## Handoff verdict

```text
WORK_ID = OCTOPORT_SEO_M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2
ROADMAP_STAGE = M9 / W2
STEP_PREPARATION_R2 = PASS / REMOTE READBACK REQUIRED
WHY_WORK_REQUIRED = FROZEN
ALLOWED_INPUT_FILES = FROZEN
PROHIBITED_INPUTS = FROZEN
SEARCH_ANCHOR_MAP = FROZEN
URL_DOMAIN_COMPARISON = FROZEN
PAGE_TYPE_AUTHORITY = FROZEN
PAIR_REASONS = FROZEN
CLUSTER_CONFLICT_RULES = FROZEN
REQUIRED_OUTPUT_FILES = 9
HARD_GATES = FROZEN
STOP_CONDITIONS = FROZEN
PUBLICATION_POLICY = FROZEN

WORK_PROMPT_ALLOWED_BEFORE_THIS_FILE_READBACK = false
```
