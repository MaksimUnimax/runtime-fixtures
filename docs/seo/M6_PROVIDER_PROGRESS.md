# Octoport SEO — M6 provider progress

Date: 2026-09-23
Status: **ACTIVE CURRENT CURSOR**
Branch: `seo/wordstat-batch-01-2026-09-16`

## Current accepted chain

```text
M6_PRE_ACQUISITION = ACCEPTED

WORDSTAT:
  M6PC001 = VALID_EMPTY_LITERAL_TOP_RESPONSE
  M6PC002 = VALID_EMPTY_LITERAL_TOP_RESPONSE
  M6PC003 = VALID_EMPTY_LITERAL_TOP_RESPONSE
  M6PC004 = HOLD_PROVIDER_INVALID_QUERY
  RAW_PERSISTED_READBACK = 4/4
  OUTCOME_UNKNOWN = 0
  AUTOMATIC_RETRY = 0
  NEW_SEMANTIC_ROWS = 0

SEARCH REGION:
  M6PC006 = COLLECTION SUCCEEDED / EXPORT RELEASED
  M6PC008 = COLLECTION SUCCEEDED / EXPORT RELEASED
  EXECUTION_DEPTH_CORRECTION = TOP20
  REGION = 213 MOSCOW
  LOCAL_JOB = octoport-m6-search-region-controls-r1-20260923

  LOCAL_START_READBACK = PASS
  SUBMIT_READBACK = PASS
  FIRST_COLLECT_READBACK = PASS / NO_DUE_OPERATIONS / provider_calls=0
  SECOND_COLLECT_READBACK = PASS / TERMINAL

  PENDING = 0
  WAITING = 0
  SUCCEEDED = 2
  PARSE_FAILED = 0
  FAILED = 0
  UNKNOWN = 0
  REQUESTS_STARTED = 2
  OPERATIONS_ACCEPTED = 2
  POLLS_STARTED = 2
  UNRESOLVED = 0
  ALL_SUCCESSFUL = true
  REVISION = 10

  LAST_OPERATION_ID = spregqnga31l4fm29b3b
  FIRST_OPERATION_ID = MUST_BE_RECOVERED_FROM_EXPORT
  FROZEN_COMPARISON_PLAN = docs/seo/M6_SEARCH_REGION_CONTROL_COMPARISON_PLAN_2026-09-23_R1.md

CAPABILITY HOLDS:
  SEARCH_HTML = 6
  SEARCH_USERAGENT = 3

M1_PRE_M7 = OPEN
M7 = BLOCKED
```

## Current exact next action

Exactly one local, zero-provider export action is released:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"exportPage","jobId":"octoport-m6-search-region-controls-r1-20260923","after":-1,"limit":2,"revision":10}
```

Expected:
```text
request_executed = false
provider_calls = 0
revision = 10
item_count = 2
items_with_raw = 2
items_with_normalized = 2
states.SUCCEEDED = 2
has_more = false
all_job_items_in_this_file = true
```

Return must include both:
- complete export receipt;
- actual generated JSON file.

After export:
`FILE -> GitHub -> remote readback -> operation/query mapping QA -> full Top20 regional comparison`.

No further submit/collect is authorized.

Authorities:
- `docs/seo/M6_SEARCH_REGION_CONTROL_COLLECT_RELEASE_2026-09-23_R2.md`
- `docs/seo/M6_SEARCH_REGION_CONTROL_COMPARISON_PLAN_2026-09-23_R1.md`
- `docs/seo/M6_SEARCH_REGION_CONTROL_EXPORT_RELEASE_2026-09-23_R1.md`
- `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_COLLECT_02_TERMINAL.json`
