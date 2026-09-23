# Octoport SEO — M4Q R2 early collect acceptance and remaining submit release R1

Date: 2026-09-23  
Status: **EARLY COLLECT RECORDED / JOB HEALTHY / EXACTLY ONE submitN(count=23) RELEASED**  
Job: `octoport-m4q-r2-b001-20260923`

## 1. Execution-order deviation

The previously released action was:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m4q-r2-b001-20260923","count":23}
```

The observed action was instead an early:

```text
collectN
```

Raw authority:

`raw/M4Q_R2_03_EARLY_COLLECT_2026-09-23.md`

Remote readback:

```text
RAW_EARLY_COLLECT_GIT_BLOB = cf1168d187529be544a666fe49e7ebfbf448aced
REMOTE_READBACK = PASS
BRANCH_HEAD_AT_READBACK = 06732ff13e818b0d6f2fd8b206caf83009c30efb
```

## 2. Current durable job truth

Observed early collection:

```text
REQUEST_EXECUTED = true
PROVIDER_CALLS_THIS_ACTION = 1
PROCESSED = 1
NORMALIZED = 1
LAST_INDEX = 0
LAST_OPERATION_ID = spr5mar31fe2ahpk49u4

TOTAL = 45
PENDING = 23
WAITING = 21
SUCCEEDED = 1
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 22
OPERATIONS_ACCEPTED = 22
POLLS_STARTED = 1
UNRESOLVED = 44
REVISION = 47
```

Interpretation:

- one already accepted deferred operation was successfully collected;
- no accepted submit was replayed;
- the 23 not-yet-submitted items remain PENDING;
- no FAILED or UNKNOWN state exists;
- the job remains safely continuable.

This is an execution-order deviation only. It does not invalidate the async job.

## 3. Fresh provider tariff recheck

Official Yandex Search API pricing was rechecked immediately before this renewed paid-submit release.

Official authority:

`https://aistudio.yandex.ru/ru/docs/search-api/pricing`

Current RUB tariff:

```text
DAY_DEFERRED = 30.5 RUB / 1000
DAY_DEFERRED_PER_REQUEST = 0.0305 RUB
NIGHT_DEFERRED = 25.41 RUB / 1000
NIGHT_WINDOW = 00:00:00..07:59:59 UTC+3
```

Current release time is after 08:00 UTC+3, so day deferred pricing applies.

Accounting ceiling:

```text
ALREADY_ACCEPTED_SUBMITS = 22
REMAINING_PENDING = 23
REMAINING_SUBMIT_COST_CEILING_RUB = 0.7015
FULL_45_SUBMIT_CEILING_RUB = 1.3725
```

The early collect does not consume an additional Search submit budget slot.

## 4. Exactly one action released now

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m4q-r2-b001-20260923","count":23}
```

This continuation may act only on the current 23 PENDING items.

It must not replay:

- the 21 WAITING items;
- the 1 SUCCEEDED item.

If the runtime processes all 23, expected terminal submit-phase shape is:

```text
PENDING = 0
WAITING = 44
SUCCEEDED = 1
REQUESTS_STARTED = 45
OPERATIONS_ACCEPTED = 45
FAILED = 0
UNKNOWN = 0
```

The actual Bridge envelope remains authority. A bounded early stop with some PENDING remaining is resumable.

## 5. Hard stop rules

If:

`UNKNOWN > 0` -> STOP / no blind replay.

If:

`FAILED > 0` -> STOP / classify exact provider/runtime failure.

If:

`PENDING = 0` and `OPERATIONS_ACCEPTED = 45` -> submit phase is complete; no further submit is allowed.

## 6. Still forbidden

```text
collectN = FORBIDDEN until submit phase closure
collectReady = FORBIDDEN until submit phase closure
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
execute exactly one submitN count=23
-> receive full SEARCH_ASYNC_BATCH_RESULT_V1
-> persist exact envelope
-> remote readback
-> reconcile PENDING / WAITING / SUCCEEDED / FAILED / UNKNOWN / revision
-> only after submit phase closure release collection
```
