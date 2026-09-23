# Octoport SEO — M6 provider progress

Date: 2026-09-23
Status: **ACTIVE CURRENT CURSOR**
Branch: `seo/wordstat-batch-01-2026-09-16`
Current HEAD before this progress write: `1fdfbb1380d806ddb49675cac6b5360afddbaf38`

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
  M6PC006 = SUBMITTED / WAITING
  M6PC008 = SUBMITTED / WAITING
  EXECUTION_DEPTH_CORRECTION = TOP20
  REGION = 213 MOSCOW
  LOCAL_JOB = octoport-m6-search-region-controls-r1-20260923
  LOCAL_START_READBACK = PASS
  SUBMIT_READBACK = PASS
  PENDING = 0
  WAITING = 2
  REQUESTS_STARTED = 2
  OPERATIONS_ACCEPTED = 2
  POLLS_STARTED = 0
  UNRESOLVED = 2
  UNKNOWN = 0
  REVISION = 4
  LAST_OPERATION_ID = spregqnga31l4fm29b3b
  FIRST_OPERATION_ID = NOT_SURFACED_IN_SUBMIT_ENVELOPE

CAPABILITY HOLDS:
  SEARCH_HTML = 6
  SEARCH_USERAGENT = 3

M1_PRE_M7 = OPEN
M7 = BLOCKED
```

## Current exact next action

Exactly one collection action is released:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m6-search-region-controls-r1-20260923","count":2}
```

Rules:
- same durable job only;
- no resubmit;
- if not due yet, `NO_DUE_OPERATIONS` is valid and should have `request_executed=false/provider_calls=0`;
- persist/readback every collect result before any later collect;
- UNKNOWN blocks replay;
- terminal target is SUCCEEDED=2 / WAITING=0 / unresolved=0;
- export only after terminal collection.

Authorities:
- `docs/seo/M6_SEARCH_REGION_CONTROL_SUBMIT_RELEASE_2026-09-23_R1.md`
- `docs/seo/M6_SEARCH_REGION_CONTROL_COLLECT_RELEASE_2026-09-23_R1.md`
- `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_SUBMIT.json`
