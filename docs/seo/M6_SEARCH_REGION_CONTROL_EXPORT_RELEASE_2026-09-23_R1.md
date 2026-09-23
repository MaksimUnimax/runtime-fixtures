# Octoport SEO — M6 regional Search export release R1

Date: 2026-09-23
Status: **TERMINAL COLLECTION PERSISTED / EXACTLY ONE LOCAL EXPORTPAGE RELEASED**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
START_HEAD: `baaeec63e6970de985674fb6b83f6f9acd75a925`

Parent evidence:
- `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_SUBMIT.json`
- `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_COLLECT_01_NO_DUE.json`
- `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_COLLECT_02_TERMINAL.json`
- `docs/seo/M6_SEARCH_REGION_CONTROL_COMPARISON_PLAN_2026-09-23_R1.md`

## 1. Terminal collect readback

Remote raw:
`docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_COLLECT_02_TERMINAL.json`

Verified terminal state:

```text
job_id = octoport-m6-search-region-controls-r1-20260923
request_executed = true
provider_calls = 2
processed = 2
normalized = 2
PENDING = 0
WAITING = 0
COLLECTING = 0
SUCCEEDED = 2
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
requests_started = 2
operations_accepted = 2
polls_started = 2
unresolved = 0
all_successful = true
busy = false
revision = 10
last.index = 1
last.operation_id = spregqnga31l4fm29b3b
```

Provider lifecycle is terminal for both accepted operations.

No further `submitN` or `collectN` is authorized.

## 2. Exact export contract

The accepted YMB async export protocol uses:

```text
SEARCH_ASYNC_BATCH_API_V1
{"action":"exportPage","jobId":"...","after":-1,"limit":N,"revision":REV}
```

This action is local extraction of already persisted provider results.

For this two-item terminal job:
- `after = -1`
- `limit = 2`
- `revision = 10`

Expected:
```text
request_executed = false
provider_calls = 0
export_page.schema = YMB_SEARCH_ASYNC_EXPORT_PAGE_V1
export_page.revision = 10
export_page.item_count = 2
export_page.items_with_raw = 2
export_page.items_with_normalized = 2
export_page.states.SUCCEEDED = 2
export_page.has_more = false
export_page.all_job_items_in_this_file = true
```

Exact row count is evidence-dependent and is not pre-guessed.

## 3. Exactly one released action

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"exportPage","jobId":"octoport-m6-search-region-controls-r1-20260923","after":-1,"limit":2,"revision":10}
```

## 4. Required return

The export receipt alone is not sufficient for M6 analysis.

Required return:
1. complete `SEARCH_ASYNC_BATCH_RESULT_V1` export receipt;
2. the actual generated JSON export file attached by Bridge.

The generated file must contain the two job items and preserved raw + normalized results, including both operation identities and query mapping.

## 5. Persistence after export

After return:

```text
EXPORT RECEIPT + GENERATED JSON FILE
-> persist complete export evidence in GitHub
-> remote readback
-> verify file identity / revision / item count / raw / normalized / operation IDs / query mapping / result row counts
-> compare region 213 Top20 vs accepted region 225 Top20 under frozen comparison plan
-> classify each control:
   NO_MATERIAL_CHANGE | ENRICH | REOPEN_TARGETED_GAP | HOLD
```

No M7 movement occurs from export alone.

## 6. Current cursor

```text
M6PC006_COLLECTION = SUCCEEDED
M6PC008_COLLECTION = SUCCEEDED
SEARCH_REGION_COLLECTION_TERMINAL = true
SEARCH_REGION_EXPORTPAGE = RELEASED
SEARCH_REGION_ANALYSIS = BLOCKED_PENDING_EXPORT
SEARCH_HTML_HOLDS = 6
SEARCH_USERAGENT_HOLDS = 3
M1_PRE_M7 = OPEN
M7 = BLOCKED
```
