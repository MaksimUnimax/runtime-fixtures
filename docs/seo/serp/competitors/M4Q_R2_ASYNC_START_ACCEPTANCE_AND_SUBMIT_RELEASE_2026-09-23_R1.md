# Octoport SEO — M4Q R2 async start acceptance and first submit release R1

Date: 2026-09-23  
Status: **START PASS / EXACTLY ONE submitN(count=25) RELEASED**  
Job: `octoport-m4q-r2-b001-20260923`

## 1. Start result acceptance

Raw authority:

`raw/M4Q_R2_01_START_2026-09-23.md`

Remote readback:

```text
RAW_START_GIT_BLOB = ed87543a5c33d10f31a16b4cc232fc72a68c3a4b
REMOTE_READBACK = PASS
BRANCH_HEAD_AT_READBACK = fe16758eb5ba646f4fddceb9ef1ac8d88d52931a
```

Accepted observed start truth:

```text
START_OK = true
REQUEST_EXECUTED = false
PROVIDER_CALLS = 0
TOTAL = 45
PENDING = 45
WAITING = 0
SUCCEEDED = 0
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
REQUESTS_STARTED = 0
OPERATIONS_ACCEPTED = 0
POLLS_STARTED = 0
UNRESOLVED = 45
REVISION = 0
```

Therefore the exact 45-item durable async job exists and no paid Yandex provider request has executed yet.

## 2. Fresh provider tariff check

Official Yandex Search API pricing was refreshed immediately before this provider release on 2026-09-23.

Official authority:

- https://aistudio.yandex.ru/en/docs/search-api/pricing
- https://aistudio.yandex.ru/ru/docs/search-api/operations/web-search
- https://aistudio.yandex.ru/en/docs/search-api/concepts/limits

Observed current tariff:

```text
DAY_DEFERRED = 30.5 RUB / 1000 requests
DAY_DEFERRED_PER_REQUEST = 0.0305 RUB
NIGHT_DEFERRED = 25.41 RUB / 1000 requests
NIGHT_WINDOW = 00:00:00..07:59:59 UTC+3
```

Fresh clock check corresponded to approximately `08:13 UTC+3`, therefore the current applicable planning ceiling is the daytime deferred rate.

Full frozen-job provider-submit ceiling:

```text
45 * 0.0305 RUB = 1.3725 RUB
```

The already-created job has:

```text
maxRequests = 45
maxCostRub = 1.3725
```

This release does not alter that job budget.

## 3. Why first submit slice = 25

Current accepted YMB 0.1.9 async protocol caps one `submitN` command at 25 requested items.

The accepted KW-002 grouped async precedent establishes that:

- one durable job may contain many independently attributable items;
- `submitN` is a bounded orchestration loop, not one provider-side batch request;
- each processed item performs one deferred Search submit;
- bounded/time-slice early stop is resumable and is not a provider failure;
- UNKNOWN blocks blind replay.

Therefore for 45 items:

```text
FIRST_RELEASED_SLICE <= 25
SECOND_SLICE = NOT RELEASED YET
```

## 4. Exactly one provider action released now

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m4q-r2-b001-20260923","count":25}
```

Expected safe successful pattern if all 25 fit the runtime slice:

```text
request_executed = true
provider_calls = 25
processed = 25
WAITING = 25
PENDING = 20
requests_started = 25
operations_accepted = 25
polls_started = 0
FAILED = 0
UNKNOWN = 0
```

But the actual `SEARCH_ASYNC_BATCH_RESULT_V1` is authority. The runtime may stop earlier because of its bounded time slice.

## 5. Hard interpretation of possible result

If the result reports:

### accepted provider operations
Preserve exact operation identities and progress. Do not collect yet. Persist/read back first.

### bounded_stop = true with some accepted items
This is continuation state, not failure. Persist/read back; successor release determines the next submit slice from actual remaining PENDING count.

### UNKNOWN > 0
Stop. No automatic or blind resubmit of ambiguous items.

### FAILED > 0
Stop and classify exact provider/runtime failure before any continuation.

### provider_calls = 0 / request_executed = false
Do not infer provider failure without the exact returned code/state.

## 6. Not released

```text
SECOND submitN = FORBIDDEN
collectN = FORBIDDEN
collectReady = FORBIDDEN
exportPage = FORBIDDEN
synchronous Search = FORBIDDEN
Wordstat = FORBIDDEN
GenSearch = FORBIDDEN
Pass B = BLOCKED
M5 = PAUSED
M7 = BLOCKED
```

## 7. Next gate

```text
execute exactly one submitN count=25
-> receive full SEARCH_ASYNC_BATCH_RESULT_V1
-> persist exact envelope
-> remote readback
-> reconcile PENDING / WAITING / FAILED / UNKNOWN / revision / provider_calls
-> only then release any remaining submit slice
```
