# Octoport SEO — M9 boundary-resolution Wave-2 paid-submit release — 2026-09-24 R1

Status: **PAID SUBMIT RELEASED / ONE BOUNDED SUBMITN COUNT=18**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream:
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_START_RECEIPT_2026-09-24_R1.md`
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_QUERY_MANIFEST_2026-09-24_R1.tsv`

## Start gate

```text
JOB_ID = octoport-m9br-wave2-20260924-r1
TOTAL = 18
PENDING = 18
REQUEST_EXECUTED = false
PROVIDER_CALLS = 0
REQUESTS_STARTED = 0
OPERATIONS_ACCEPTED = 0
POLLS_STARTED = 0
UNRESOLVED = 18
REVISION = 0
LOCAL_START_GATE = PASS
```

## Fresh official tariff check

Rechecked immediately before this paid release.

Observed user-local time:
`2026-09-24T14:11:54+05:00`.

Equivalent Yandex tariff time:
`2026-09-24T12:11:54+03:00`.

This is daytime, not the 00:00:00..07:59:59 UTC+3 night window.

Official Yandex Search API pricing currently states:

```text
DAY_DEFERRED = 30.5 RUB / 1000
DAY_DEFERRED_UNIT = 0.0305 RUB / request
NIGHT_DEFERRED = 25.41 RUB / 1000
```

For this exact Wave-2 universe:

```text
MAX_PROVIDER_SUBMITS = 18
MAX_INCREMENTAL_COST_RUB = 18 * 0.0305 = 0.549
```

Official limits rechecked:
- deferred requests/hour = 35,000;
- deferred requests/second = 10;
- deferred result GET/second = 10;
- max query length = 400 chars;
- max query words = 40;
- minimum deferred processing = 5 minutes;
- max result retention = 12 hours.

Official sources:
- https://aistudio.yandex.ru/ru/docs/search-api/pricing
- https://aistudio.yandex.ru/ru/docs/search-api/concepts/limits
- https://aistudio.yandex.ru/ru/docs/search-api/operations/web-search

All 18 exact queries remain within provider limits.

## Exact authorized action

Only one bounded provider-submission slice is authorized:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m9br-wave2-20260924-r1","count":18}
```

Because YMB 0.1.9 also has an internal approximately 10-second slice bound, a legitimate return may process fewer than 18 and return `bounded_stop=true`.

Accepted outcomes:
- `accepted` rows become WAITING and must never be resubmitted;
- a bounded stop with remaining PENDING rows requires exact receipt/reconciliation before another submit;
- UNKNOWN or FAILED stops the lifecycle for reconciliation.

## Expected ideal result

```text
PROVIDER_CALLS = 18
PROCESSED = 18
PENDING = 0
WAITING = 18
REQUESTS_STARTED = 18
OPERATIONS_ACCEPTED = 18
POLLS_STARTED = 0
UNKNOWN = 0
FAILED = 0
UNRESOLVED = 18
```

No second submit is automatic.
No collect is authorized by this release.
M10A remains blocked.
