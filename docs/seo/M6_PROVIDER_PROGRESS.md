# Octoport SEO — M6 provider progress

Date: 2026-09-23
Status: **ACTIVE CURRENT CURSOR**
Branch: `seo/wordstat-batch-01-2026-09-16`
Current HEAD before this progress write: `55b95017311ae7c4ab9a6d268bf5d66da8257e8e`

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
  M6PC006 = LOCAL START PERSISTED / PROVIDER SUBMIT RELEASED
  M6PC008 = LOCAL START PERSISTED / PROVIDER SUBMIT RELEASED
  EXECUTION_DEPTH_CORRECTION = TOP20
  REGION = 213 MOSCOW
  LOCAL_JOB = octoport-m6-search-region-controls-r1-20260923
  LOCAL_START_RAW = docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_START.json
  LOCAL_START_READBACK = PASS
  PENDING = 2
  REQUESTS_STARTED = 0
  OPERATIONS_ACCEPTED = 0
  REVISION = 0

CAPABILITY HOLDS:
  SEARCH_HTML = 6
  SEARCH_USERAGENT = 3

M1_PRE_M7 = OPEN
M7 = BLOCKED
```

## Current exact next action

Exactly one provider action is released:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m6-search-region-controls-r1-20260923","count":2}
```

Current verified daytime deferred-search submit tariff:
```text
30.5 RUB / 1000
0.0305 RUB / submit
2 submit ceiling = 0.061 RUB
```

Expected accepted-state shape:
```text
request_executed = true
provider_calls = 2
processed = 2
operations_accepted = 2
PENDING = 0
WAITING = 2
UNKNOWN = 0
requests_started = 2
revision = 4
```

Actual returned operation IDs are authoritative; no guessed IDs.

After the actual submit result:
`FULL RESULT -> GITHUB -> REMOTE READBACK -> verify operations -> only then collect planning`.

No `collectN` or export is currently released.

Authorities:
- `docs/seo/M6_WORDSTAT_PROVIDER_RECONCILIATION_2026-09-23_R1.md`
- `docs/seo/M6_SEARCH_REGION_CONTROL_PRE_STEP_AND_START_RELEASE_2026-09-23_R1.md`
- `docs/seo/M6_SEARCH_REGION_CONTROL_SUBMIT_RELEASE_2026-09-23_R1.md`
