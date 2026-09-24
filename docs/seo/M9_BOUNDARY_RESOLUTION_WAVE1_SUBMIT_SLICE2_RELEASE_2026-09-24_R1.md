# Octoport SEO — M9 boundary-resolution Wave-1 submit slice-2 release — 2026-09-24 R1

Status: **RELEASED FOR ONE BOUNDED SUBMITN COUNT=6 / COLLECTION CLOSED**
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream:
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_SUBMIT_SLICE1_RECEIPT_2026-09-24_R1.md`

## 1. Current durable provider-admission state

```text
JOB_ID = octoport-m9br-wave1-20260924-r1
TOTAL = 25
WAITING = 19
PENDING = 6
UNKNOWN = 0
FAILED = 0
REQUESTS_STARTED = 19
OPERATIONS_ACCEPTED = 19
POLLS_STARTED = 0
REVISION = 38
```

The first 19 accepted rows are provider-admitted and MUST NOT be submitted again.

## 2. Fresh tariff check immediately before slice 2

Checked 2026-09-24 after slice-1 receipt readback and immediately before this release.

Official sources:
- https://aistudio.yandex.ru/ru/docs/search-api/pricing
- https://aistudio.yandex.ru/ru/docs/search-api/concepts/limits

Current time basis:
```text
USER_TIME = 2026-09-24 12:34 +05:00
YANDEX_TARIFF_TIME = 2026-09-24 10:34 UTC+3
ACTIVE_RATE = DAY_DEFERRED
```

Current official pricing:
```text
DAY_DEFERRED = 30.5 RUB / 1000 = 0.0305 RUB/request
NIGHT_DEFERRED = 25.41 RUB / 1000 = 0.02541 RUB/request
NIGHT_WINDOW = 00:00:00..07:59:59 UTC+3
```

Incremental slice-2 ceiling:
```text
REMAINING_PENDING = 6
UNIT_COST_CEILING_RUB = 0.0305
SLICE2_MAX_COST_RUB = 6 * 0.0305 = 0.183
WAVE1_TOTAL_MAX_COST_RUB = 0.7625
```

Official limits remain:
```text
DEFERRED_PER_HOUR = 35000
DEFERRED_PER_SECOND = 10
RESULT_GETS_PER_SECOND = 10
MAX_RESULTS = 250
MAX_QUERY_LENGTH = 400
MAX_QUERY_WORDS = 40
MIN_DEFERRED_PROCESSING = 5 minutes
MAX_RESULT_RETENTION = 12 hours
```

## 3. Exact authorized action

Only this command is authorized:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m9br-wave1-20260924-r1","count":6}
```

Expected safe terminal admission state if all six are accepted:

```text
PENDING = 0
WAITING = 25
UNKNOWN = 0
FAILED = 0
REQUESTS_STARTED = 25
OPERATIONS_ACCEPTED = 25
POLLS_STARTED = 0
```

A bounded early stop with fewer than six processed is allowed, but does not authorize another submit automatically.

Any UNKNOWN or FAILED state => stop and reconcile.

## 4. Collection fence

No `collectN` is authorized by this artifact.

After slice-2 return:
1. persist/read back the result;
2. confirm all submit outcomes;
3. enumerate/preserve accepted operation IDs from durable job state before any collection;
4. wait at least provider minimum processing time for due operations;
5. release bounded collection separately.

No blind retry.
M10A remains blocked.
