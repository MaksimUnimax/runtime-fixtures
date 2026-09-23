# Octoport SEO — M6 regional Search submit release R1

Date: 2026-09-23
Status: **EXACTLY ONE BOUNDED DEFERRED SEARCH SUBMITN RELEASED**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
START_HEAD: `9669d5feb60178a1f04d0262929a60162c6eeb8f`

Parent authorities:
- `docs/seo/M6_SEARCH_REGION_CONTROL_PRE_STEP_AND_START_RELEASE_2026-09-23_R1.md`
- `docs/seo/M6_WORDSTAT_PROVIDER_RECONCILIATION_2026-09-23_R1.md`
- `docs/seo/M6_PROVIDER_PROGRESS.md`
- `docs/seo/LEVEL1/README.md`
- `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md`
- `docs/seo/EXECUTION_RULES.md`

## 1. Local start readback

Raw start envelope:
`docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_START.json`

Remote blob SHA:
`30562139ee3b8383c00f0e2d54358b2207ac1fb8`

Verified:
```text
job_id = octoport-m6-search-region-controls-r1-20260923
control = RUNNING
total = 2
PENDING = 2
SUBMITTING = 0
WAITING = 0
SUCCEEDED = 0
FAILED = 0
UNKNOWN = 0
requests_started = 0
operations_accepted = 0
polls_started = 0
unresolved = 2
busy = false
revision = 0
request_executed = false
provider_calls = 0
```

The local job exists durably and no provider Search request has yet been submitted.

## 2. Fresh official tariff verification

Official Yandex Search API pricing rechecked immediately before this release on 2026-09-23.

Source:
https://aistudio.yandex.ru/en/docs/search-api/pricing

For Yandex.Cloud LLC RUB pricing:
```text
DAYTIME_DEFERRED_SEARCH = 30.5 RUB / 1000 requests
UNIT_SUBMIT_COST_RUB = 0.0305
TWO_SUBMIT_CEILING_RUB = 0.061
```

Yandex documentation defines reduced night rates only for 00:00:00–07:59:59 UTC+3. The current acquisition occurs outside that night window, so the daytime ceiling remains the conservative current release bound.

## 3. Frozen provider submissions

Job order is already frozen by the accepted local start:

1. M6PC006 / R04
   `аналитика маркетплейсов для селлеров`
2. M6PC008 / R06
   `помощник селлера маркетплейсов`

Shared frozen parameters:
```text
searchType = SEARCH_TYPE_RU
region = 213
page = 0
groupsOnPage = 20
docsInGroup = 1
groupMode = GROUP_MODE_FLAT
familyMode = FAMILY_MODE_MODERATE
fixTypoMode = FIX_TYPO_MODE_OFF
sortMode = SORT_MODE_BY_RELEVANCE
sortOrder = SORT_ORDER_DESC
```

No query, region or execution parameter is changed by this release.

## 4. Exactly one released provider action

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m6-search-region-controls-r1-20260923","count":2}
```

Expected semantics if accepted:
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

Actual operation IDs must come from the returned result and must be persisted exactly.

## 5. Persistence / no-resubmit rule

Immediately after the actual submit result:
```text
FULL SEARCH_ASYNC_BATCH_RESULT_V1
-> GitHub raw lifecycle evidence
-> remote readback
-> verify operation identities and state
-> ONLY THEN collect planning
```

Once an operation is accepted:
- no replacement start;
- no replacement submit;
- no blind resubmit;
- collect only the same accepted operation identities.

A returned UNKNOWN remains unresolved and blocks automatic replay.

## 6. Collection timing

Official Yandex Search API limits currently state:
- deferred processing minimum = 5 minutes;
- deferred result retention maximum = 12 hours.

Source:
https://aistudio.yandex.ru/en/docs/search-api/concepts/limits

Therefore a too-early `collectN` may validly return no due operation and must not cause resubmission.

No `collectN` or export is released by this file.

## 7. Current cursor

```text
M6_SEARCH_REGION_LOCAL_START = PERSISTED_READBACK_PASS
M6_SEARCH_REGION_SUBMITN_COUNT_2 = RELEASED
M6_SEARCH_REGION_COLLECT = NOT_RELEASED
M6_SEARCH_REGION_EXPORT = NOT_RELEASED
SEARCH_HTML_HOLDS = 6
SEARCH_USERAGENT_HOLDS = 3
M1_PRE_M7 = OPEN
M7 = BLOCKED
```
