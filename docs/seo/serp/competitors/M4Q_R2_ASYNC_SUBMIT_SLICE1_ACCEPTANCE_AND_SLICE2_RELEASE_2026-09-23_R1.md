# Octoport SEO — M4Q R2 async submit slice 1 acceptance and slice 2 release R1

Date: 2026-09-23  
Status: **SLICE 1 PASS / EXACTLY ONE submitN(count=23) RELEASED**  
Job: `octoport-m4q-r2-b001-20260923`

## 1. Slice 1 accepted execution truth

Raw authority:

`raw/M4Q_R2_02_SUBMIT_SLICE1_2026-09-23.md`

Remote readback:

```text
RAW_SLICE1_GIT_BLOB = 2e7cfd5fca531a685a0d32aa855a38243472f39b
REMOTE_READBACK = PASS
BRANCH_HEAD_AT_READBACK = 173ffeee2f58623d4a676961471c95ac24cc9256
```

Observed:

```text
REQUEST_EXECUTED = true
PROVIDER_CALLS_THIS_ACTION = 22
PROCESSED = 22
BOUNDED_STOP = true
LAST_ACCEPTED_INDEX = 21
LAST_OPERATION_ID = sprt1dealvkba7l5j85b

TOTAL = 45
PENDING = 23
WAITING = 22
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 22
OPERATIONS_ACCEPTED = 22
POLLS_STARTED = 0
UNRESOLVED = 45
REVISION = 44
```

`bounded_stop=true` is accepted as the runtime slice budget stop already proven by the YMB 0.1.9 grouped async precedent. No provider failure is present and no accepted item may be resubmitted.

## 2. Fresh provider tariff recheck

Official Yandex Search API pricing was rechecked again immediately before this second paid submit release.

Official pricing authority:

`https://aistudio.yandex.ru/ru/docs/search-api/pricing`

Current RUB tariff remains:

```text
DAY_DEFERRED = 30.5 RUB / 1000
DAY_DEFERRED_PER_REQUEST = 0.0305 RUB
NIGHT_DEFERRED = 25.41 RUB / 1000
NIGHT_WINDOW = 00:00:00..07:59:59 UTC+3
```

At this release the current time is after 08:00 UTC+3, therefore day deferred pricing applies.

Accounting ceiling:

```text
ALREADY_ACCEPTED_PROVIDER_SUBMITS = 22
ALREADY_ACCEPTED_COST_CEILING_RUB = 0.671

REMAINING_PENDING_ITEMS = 23
REMAINING_COST_CEILING_RUB = 0.7015

FULL_JOB_SUBMIT_CEILING_RUB = 1.3725
```

The durable job budget remains `maxRequests=45 / maxCostRub=1.3725`.

## 3. Exactly one remaining-submit action released

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m4q-r2-b001-20260923","count":23}
```

This action targets only the current 23 PENDING items. It must not replay any of the 22 WAITING items.

Expected complete-success shape if the runtime slice can process all 23:

```text
provider_calls_this_action = 23
processed = 23
PENDING = 0
WAITING = 45
requests_started = 45
operations_accepted = 45
FAILED = 0
UNKNOWN = 0
revision = 90
```

The expected revision is informational only. The actual Bridge envelope is authority, and the runtime may bounded-stop earlier.

## 4. Stop/continuation rules

- If `bounded_stop=true` with PENDING remaining and FAILED/UNKNOWN still zero: persist/readback and release only the actual remainder.
- If `UNKNOWN > 0`: stop; no blind replay.
- If `FAILED > 0`: stop; classify exact failure.
- If all 45 become WAITING: submit phase is closed; no more submit actions.

## 5. Still not released

```text
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

## 6. Next gate

```text
execute exactly one submitN count=23
-> receive full SEARCH_ASYNC_BATCH_RESULT_V1
-> persist exact envelope
-> remote readback
-> reconcile final submit coverage
-> only after PENDING=0 may collection be released
```
