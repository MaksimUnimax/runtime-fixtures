# Octoport SEO — M9 boundary-resolution Wave-2 information-gain pre-acquisition — 2026-09-24 R1

Status: **PASS_PREACQ / 18 SEARCH CANDIDATES / 1 ZERO-GAIN EXCLUSION**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream current authority:
- `docs/seo/M9_BOUNDARY_RESOLUTION_FULL_RERUN_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`
- `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_PAIRWISE_CLUSTER_EVIDENCE.tsv`
- `docs/seo/M9_BOUNDARY_RESOLUTION_SEARCH_ANCHOR_MAP_2026-09-24_R1.tsv`
- `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/M9BR_DEFERRED_OR_PERSISTENT_HOLD.tsv`

Exact Wave-2 query manifest:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_QUERY_MANIFEST_2026-09-24_R1.tsv`

## Current M9 state

```text
CLUSTER_ELIGIBLE = 104
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

## Candidate universe

Prior pre-acquisition authority left:
`DEFER_SEARCH_CANDIDATE = 19`.

Main Chat re-evaluated all 19 against the **current** full 5,356-pair rerun, not the old pre-Wave1 degree table.

Result:

```text
DEFERRED_CANDIDATES_RECHECKED = 19/19
POSITIVE_CURRENT_MATERIAL_HOLD_GAIN = 18
ZERO_CURRENT_MATERIAL_HOLD_GAIN = 1
CURRENT_ANCHOR_DUPLICATE_QUERY = 0
INTRA_WAVE2_DUPLICATE_QUERY = 0
MAX_QUERY_CHARS = 59
MAX_QUERY_WORDS = 9
```

All 18 released query texts remain exact frozen canonical query strings. No rephrasing is allowed.

## Zero-gain exclusion

Do **not** acquire:

```text
semantic_identity_id = M8SID_aeb8b283519ced02
query = ии для продаж на маркетплейсах
```

Current state:

```text
TASK_SIGNATURE = TASK_UNRESOLVED
CURRENT_MATERIAL_HOLD_DEGREE = 0
MATERIAL_HOLD_TO_CURRENT_ANCHOR_DEGREE = 0
SUPPORTED_MERGE_BLOCK_DEGREE = 0
```

It has many non-material `H_OTHER_BOUNDARY` relations with `user_task_relation=AMBIGUOUS`.

Because the M9 boundary-resolution Search pass freezes user-task/intent/product/scope authority, current Search acquisition alone cannot turn those ambiguous-task relations into material page-boundary authority.

Therefore:

`WAVE2_PROVIDER_INFORMATION_GAIN = NOT_PROVEN`

for this identity.

It remains terminally deferred from Search acquisition until a different accepted non-Search reopen trigger exists.

## Released Wave-2 information gain

18 exact queries are released for controlled Search lifecycle planning.

Across the current 1,406-material-HOLD universe:

```text
UNIQUE_MATERIAL_HOLDS_TOUCHED_BY_WAVE2 = 346
WAVE2_INTERNAL_MATERIAL_HOLDS = 41
WAVE2_TO_CURRENT_47_ANCHOR_MATERIAL_HOLDS = 106
WAVE2_TO_OTHER_NONANCHOR_MATERIAL_HOLDS = 199
```

The top two candidates materially intersect already-supported merge structures:

1. `программа аналитики маркетплейсов`
   - material HOLD = 24
   - to current anchors = 21
   - material HOLDs to supported-merge nodes = 15
   - merge components touched = 5
   - already has one supported merge edge

2. `аналитика маркетплейсов топ сервисов`
   - material HOLD = 21
   - to current anchors = 18
   - material HOLDs to supported-merge nodes = 14
   - merge components touched = 5

These are high-value boundary probes because their acquisition can turn many current ONE-SERP relations into bilateral current Search comparisons and can directly test external holds blocking existing positive components.

## Expected Search-comparability movement if all 18 become valid anchors

Current:
```text
ANCHORS = 47
NO_SERP = 57

BOTH = 1081
ONE = 2679
NO = 1596
```

After Wave-2:
```text
ANCHORS = 65
NO_SERP = 39

BOTH_CURRENT_SERP = 2080
ONE_CURRENT_SERP = 2535
NO_CURRENT_SERP = 741

ONE -> BOTH = 846
NO -> BOTH = 153
NO -> ONE = 702

CHANGED_COMPARABILITY = 1701
```

These are expectations only. They become authority only after terminal provider results, accepted export, and a complete 5,356-pair rerun.

## Exact Wave-2 order

```text
01 программа аналитики маркетплейсов
02 аналитика маркетплейсов топ сервисов
03 нейросеть для работы с маркетплейсами
04 ии для работы с маркетплейсами
05 ии агент для селлера
06 ии ассистент селлера
07 ии агенты маркетплейсы отчеты
08 где скачать отчет о выкупах маркетплейсов
09 как загрузить отчеты маркетплейса
10 Как читать финансовый отчёт Wildberries и Ozon
11 ии ассистент для озон
12 Как скачать отчёт о продажах на Wildberries
13 Как сверить финансовые отчеты Wildberries?
14 Как читать и анализировать финансовый отчёт Wildberries
15 Как правильно рассчитать ДРР на Wildberries?
16 Как анализировать отчет о продажах на Wildberries
17 Как читать и анализировать отчеты о продажах на Wildberries
18 Как построить воронку продаж на маркетплейсе
```

## Execution boundary

This document does not authorize a paid provider request.

Required lifecycle remains:

```text
DURABLE QUERY MANIFEST
-> PROVIDER/BRIDGE PREFLIGHT
-> LOCAL START RELEASE + READBACK
-> FRESH TARIFF CHECK
-> PAID SUBMIT RELEASE + READBACK
-> MINIMUM DEFERRED WAIT
-> COLLECT RELEASE(S)
-> TERMINAL ITEM READBACK
-> COMPLETE EXPORT
-> MAIN CHAT ACCEPTANCE
-> FULL 5356-PAIR RERUN
```

No blind retry.
No partial M9 patch.
M10A remains blocked.
