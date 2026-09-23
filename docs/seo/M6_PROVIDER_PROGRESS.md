# Octoport SEO — M6 provider progress

Date: 2026-09-23
Status: **ACTIVE CURRENT CURSOR**
Branch: `seo/wordstat-batch-01-2026-09-16`
Current HEAD at this progress write: `96c13e3c4dbab581fc3b907b26c99d5608aea47f`

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
  M6PC006 = PREPARED / LOCAL START RELEASED / NOT EXECUTED
  M6PC008 = PREPARED / LOCAL START RELEASED / NOT EXECUTED
  EXECUTION_DEPTH_CORRECTION = TOP20
  REGION = 213 MOSCOW

CAPABILITY HOLDS:
  SEARCH_HTML = 6
  SEARCH_USERAGENT = 3

M1_PRE_M7 = OPEN
M7 = BLOCKED
```

## Current exact next action

Only this local no-provider action is released:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"start","jobId":"octoport-m6-search-region-controls-r1-20260923","queries":["аналитика маркетплейсов для селлеров","помощник селлера маркетплейсов"],"confirmBillable":true,"maxRequests":2,"maxCostRub":0.061,"searchType":"SEARCH_TYPE_RU","region":"213","page":0,"groupsOnPage":20,"docsInGroup":1,"groupMode":"GROUP_MODE_FLAT","familyMode":"FAMILY_MODE_MODERATE","fixTypoMode":"FIX_TYPO_MODE_OFF","sortMode":"SORT_MODE_BY_RELEVANCE","sortOrder":"SORT_ORDER_DESC"}
```

Expected:
```text
request_executed = false
provider_calls = 0
PENDING = 2
requests_started = 0
operations_accepted = 0
revision = 0
```

After actual start result:
`FULL RESULT -> GITHUB -> REMOTE READBACK -> FRESH TARIFF CHECK -> submitN release`.

Authorities:
- `docs/seo/M6_WORDSTAT_PROVIDER_RECONCILIATION_2026-09-23_R1.md`
- `docs/seo/M6_SEARCH_REGION_CONTROL_PRE_STEP_AND_START_RELEASE_2026-09-23_R1.md`
