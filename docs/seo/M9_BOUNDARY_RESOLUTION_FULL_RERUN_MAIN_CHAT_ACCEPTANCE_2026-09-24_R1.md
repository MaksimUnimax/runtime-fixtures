# Octoport SEO — M9 boundary-resolution full rerun — Main Chat acceptance — 2026-09-24 R1

WORK_ID: `OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1`

Status: **PASS_WITH_HOLD_BOUNDARIES / ACCEPTED_BOUNDED_AUTHORITY**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

Work START_HEAD:
`6f6d22168ffd2e065264df5716fcb0ef6a7310ac`

Work END_OBSERVED_HEAD:
`6f6d22168ffd2e065264df5716fcb0ef6a7310ac`

Owner upload commit:
`7bdd6b294c2e53eb34f68a010c7041efa840958a`

Upload parent:
`6f6d22168ffd2e065264df5716fcb0ef6a7310ac`

Therefore the owner upload is a single forward commit on the exact frozen Work authority.

## Return surface

Staging:
`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/`

Exact file set:
```text
M9_SOURCE_MANIFEST.md
M9_IDENTITY_ELIGIBILITY_LEDGER.tsv
M9_PAIRWISE_CLUSTER_EVIDENCE.tsv
M9_CLUSTER_MASTER.tsv
M9_CLUSTER_MEMBERSHIP.tsv
M9_HOLD_BOUNDARY_LEDGER.tsv
M9_ADVERSARIAL_DIAGNOSTIC.tsv
M9_QA.md
M9_RETURN_MANIFEST.json
```

```text
RETURN_FILES = 9/9
MISSING_FILES = 0
EXTRA_FILES = 0
RETURN_MANIFEST_NON_SELF_HASH_MATCH = 8/8
RETURN_MANIFEST_NON_SELF_BYTE_MATCH = 8/8
RETURN_MANIFEST_NON_SELF_LINE_COUNT_MATCH = 8/8
```

The Work ZIP SHA reported in chat is not used as acceptance authority after unpacked owner upload; acceptance is based on the exact staged file bytes and their return-manifest hashes.

## Frozen authority verification

The binding R2 base manifest plus rerun overlays account 29 unique frozen direct files.

Main Chat independently checked current Git blob identities:

```text
FROZEN_INPUT_IDENTITIES = 29/29 PASS
FROZEN_INPUT_IDENTITY_MISMATCH = 0
AUTHORITY_DRIFT = NONE
```

No frozen input changed between Work start and owner upload.

## Eligibility audit

Main Chat independently joined the rerun eligibility ledger to the accepted M8 semantic master.

```text
M8_IDENTITY_ROWS = 7913/7913
M9_ELIGIBILITY_ROWS = 7913/7913
UNIQUE_SEMANTIC_IDS = 7913/7913
IDENTITY_SET_MATCH = PASS

WORKING -> CLUSTER_ELIGIBLE = 104/104
REVIEW_HOLD -> CARRIED_REVIEW_HOLD = 5064/5064
EXCLUDED -> EXCLUDED_NOT_CLUSTERED = 2737/2737
BRAND_DEFENSE -> BRAND_DEFENSE_SEPARATE = 8/8

M8_FROZEN_FIELD_MISMATCH = 0
```

Frozen canonical text/state/reason/task/intent/product/family fields match M8 authority.

## Current Search-anchor audit

```text
SEARCH_ANCHOR_ROWS = 47/47
UNIQUE_SEARCH_ANCHOR_IDENTITIES = 47/47
UNIQUE_EXACT_QUERIES = 47/47

OLD_M4Q_R2 = 22/22
NEW_M9BR_WAVE1 = 25/25

CURRENT_EXACT_SERP = 47
NO_CURRENT_EXACT_SERP = 57

ELIGIBILITY_TO_ANCHOR_QUERY_JOIN_MISMATCH = 0
```

Old M4Q physical TSV source was independently parsed using the frozen TSV contract:

```text
M4Q_SERP_ROWS = 4500/4500
M4Q_QUERY_COUNT = 45
ROWS_PER_M4Q_QUERY = 100/100
```

Wave1 accepted projection independently decoded:

```text
ROWS = 500/500
INDICES = 0..24
RANKS_PER_INDEX = 1..20
TSV_SHA256 =
b01d9c0ccbbfb2c7cfcb5af33762c7d9a74c686c2102e5d1419e1bf97491bb95
```

## Full pair-universe audit

Main Chat independently enumerated C(104,2).

```text
PAIRWISE_ROWS = 5356/5356
UNIQUE_PAIR_IDS = 5356/5356
EXPECTED_PAIR_SET_MATCH = PASS
SELF_PAIRS = 0
PAIR_ID_HASH_MISMATCH = 0
```

Every pair was compared to accepted M9 R2 frozen non-Search dimensions:

```text
FROZEN_NON_SEARCH_PAIR_FIELD_DRIFT = 0
```

Fields checked include:
- pair identity/members;
- canonical texts;
- preliminary families;
- user-task relation;
- intent relation;
- marketplace-scope relation;
- product-fit relation;
- accepted result-page-type relation.

## Independent Search recomputation

Main Chat independently rebuilt current URL/domain sets from:
- old 22 exact M4Q snapshots;
- new 25 accepted Wave1 projection.

No URL/domain re-normalization was performed.

```text
BOTH_CURRENT_SERP = 1081/1081
ONE_CURRENT_SERP = 2679/2679
NO_CURRENT_SERP = 1596/1596

BILATERAL_OVERLAP_RECOMPUTATION_MISMATCH = 0
ONE_OR_NO_SERP_NA_OVERLAP_MISMATCH = 0
CURRENT_QUERY_ID_MISMATCH = 0
SEARCH_COMPARABILITY_MISMATCH = 0
```

All nine overlap fields for all 1,081 bilateral pairs were independently recomputed.

Comparability transition accounting:

```text
ONE -> BOTH = 550
NO -> BOTH = 300
NO -> ONE = 1425

CHANGED_COMPARABILITY = 2275/2275

ONE -> ONE = 1254
NO -> NO = 1596
BOTH -> BOTH = 231

UNCHANGED_COMPARABILITY = 3081/3081
```

## Pair-decision audit

Accepted R2 baseline:

```text
MERGE_SUPPORTED = 3
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1518
```

Accepted rerun:

```text
MERGE_SUPPORTED = 21
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1500
```

Delta:

```text
PAIR_DECISIONS_CHANGED = 18
HOLD_BOUNDARY -> MERGE_SUPPORTED = 18
ALL_OTHER_OFF_DIAGONAL_DECISION_TRANSITIONS = 0

PAIR_REASON_CODES_CHANGED = 290
UNCHANGED_COMPARABILITY_PAIR_STATE_OR_REASON_CHANGES = 0
```

Every MERGE was independently checked against the frozen semantic contract:

```text
MERGE_SEMANTIC_CONTRACT_MISMATCH = 0
MERGE_EVIDENCE_GRADE_MISMATCH = 0
NO_SERP_TO_NO_SERP_MERGE = 0
M_SERP_URL_CONVERGENCE_WITH_ZERO_TOP20_URL_OVERLAP = 0
```

For bilateral MERGE edges, observed exact-URL convergence is non-trivial:

```text
MIN_EXACT_URL_OVERLAP_TOP10 = 4
MIN_EXACT_URL_OVERLAP_TOP20 = 9
```

Therefore no new MERGE is justified only by lexical similarity or domain recurrence.

All 18 changed decisions have accepted new Wave1 Search authority.

The three pre-existing accepted merge edges remain:

```text
отчеты продаж маркетплейсов
↔ отчеты маркетплейсов
= MERGE_SUPPORTED
  BOTH_CURRENT_SERP
  exact URL overlap Top10=6 / Top20=12

программа аналитики маркетплейсов
↔ сервис аналитики маркетплейсов
= MERGE_SUPPORTED
  ONE_CURRENT_SERP
  M_ONE_SERP_TASK_COMPATIBLE

подключить chatgpt к маркетплейсу
↔ chatgpt для маркетплейсов
= MERGE_SUPPORTED
  BOTH_CURRENT_SERP
  exact URL overlap Top10=6 / Top20=10
```

## Material HOLD audit

Main Chat independently re-applied the frozen material-HOLD predicate to all 5,356 final pairs.

```text
MATERIAL_HOLD_RECOMPUTED = 1406
M9_HOLD_BOUNDARY_LEDGER_ROWS = 1406
UNIQUE_HOLD_PAIR_IDS = 1406
MISSING_MATERIAL_HOLD_LEDGER_ROWS = 0
EXTRA_HOLD_LEDGER_ROWS = 0
BLOCKING_FOR_M10A_YES = 1406/1406
```

## Cluster / complete-link audit

```text
CLUSTER_MASTER_ROWS = 104
MEMBERSHIP_ROWS = 104/104
UNIQUE_MEMBERSHIP_IDENTITIES = 104/104
MISSING_ELIGIBLE_MEMBERSHIP = 0
DUPLICATE_MEMBERSHIP = 0

RETAINED_CLUSTER = 0
RETAINED_SINGLETON = 0
HOLD_CLUSTER_BOUNDARY = 104
MEMBER_COUNT_1 = 104/104

CLUSTER_ID_HASH_MISMATCH = 0
CLUSTER_MASTER_MEMBERSHIP_MISMATCH = 0
EXTERNAL_HOLD_DEGREE_MISMATCH = 0
MERGE_DEGREE_MISMATCH = 0

CLUSTER_MEMBERSHIPS_CHANGED_VS_R2 = 0
```

The 21 supported MERGE edges form 9 connected merge components.

Independent complete-link check:

```text
MERGE_COMPONENTS = 9
NON_CLIQUE_MERGE_COMPONENTS = 0
```

Every merge component has external material HOLD exposure, so none may be retained.

One identity has zero material-HOLD degree:
`ии для продаж на маркетплейсах`.

This is not a retention defect:
- it has no current exact SERP;
- task signature is `TASK_UNRESOLVED`;
- it has multiple `H_OTHER_BOUNDARY` relations with `user_task_relation=AMBIGUOUS`;
- therefore the no-SERP singleton retention rule is not satisfied.

## Adversarial QA

```text
ADVERSARIAL_DIAGNOSTIC_ROWS = 28/28
UNIQUE_DIAGNOSTIC_IDS = 28/28
PAIRS_CHANGED_AFTER_MECHANISM_REVIEW = 6
CLUSTERS_CHANGED_AFTER_MECHANISM_REVIEW = 0
```

Diagnostic `M9DIAG_027 / SIBLING_POSITIVE_CLIQUES` records a systematic mechanism review, not an unresolved defect:
- six sibling edges were changed before publication;
- all 5,356 pairs were rerun;
- all 1,406 material HOLDs and 104 clusters were rerun;
- final machine invariants independently pass.

No one-row output patch was accepted.

## Main Chat verdict

```text
MAIN_CHAT_QA = PASS
OPEN_CRITICAL_DEFECTS = 0

VERDICT =
PASS_WITH_HOLD_BOUNDARIES /
ACCEPTED_BOUNDED_AUTHORITY

CURRENT_SEARCH_ANCHORS = 47
NO_CURRENT_EXACT_SERP = 57

MERGE_SUPPORTED = 21
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1500
MATERIAL_HOLD = 1406

RETAINED_CLUSTER = 0
RETAINED_SINGLETON = 0
HOLD_CLUSTER_BOUNDARY = 104
```

This rerun supersedes the prior M9 R2 pair/cluster outputs as current M9 Search authority.

## Downstream boundary

M10A is **not opened** by this acceptance because there is still no retained Search-only cluster/page baseline:

```text
HOLD_CLUSTER_BOUNDARY = 104/104
MATERIAL_HOLD = 1406
```

The next physical step is another bounded M9 boundary-resolution information-gain pass over the still-unresolved identities, starting from the 19 previously deferred exact-query candidates and recalculating their value against the new 1,406-material-HOLD universe.

No provider execution is authorized by this acceptance.
