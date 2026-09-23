# Octoport SEO — M4Q R2 final pending submit release R1

Date: 2026-09-23
Status: **FIRST 44 ITEMS CLOSED / EXACTLY ONE FINAL submitN(count=1) RELEASED**
Job: `octoport-m4q-r2-b001-20260923`

## 1. Accepted state before final submit

Latest raw authority:

`raw/M4Q_R2_10_COLLECT_BATCH4_RESULT_2026-09-23.md`

Remote readback:

```text
RAW_GIT_BLOB = 26de6ad98f536e2992a653517463d906cd8ff85c
REMOTE_READBACK = PASS
```

Current durable job truth:

```text
TOTAL = 45
REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 44

PENDING = 1
WAITING = 0
SUCCEEDED = 44
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

UNRESOLVED = 1
REVISION = 220
```

All 44 already-submitted Search operations are terminal-successful and normalized.

Exactly one item remains PENDING and has never been submitted.

## 2. Fresh official provider tariff check

Official Yandex Search API pricing rechecked immediately before this release:

`https://aistudio.yandex.ru/ru/docs/search-api/pricing`

Current RUB deferred tariff:

```text
DAY_DEFERRED = 30.5 RUB / 1000
DAY_DEFERRED_PER_REQUEST = 0.0305 RUB
NIGHT_DEFERRED = 25.41 RUB / 1000
NIGHT_WINDOW = 00:00:00..07:59:59 UTC+3
```

At release time it is after 08:00 UTC+3, therefore the day deferred price applies.

Final remaining submit ceiling:

```text
ONE_FINAL_SUBMIT = 0.0305 RUB
FULL_45_SUBMIT_CEILING_RUB = 1.3725
```

The durable job budget remains within the accepted ceiling.

## 3. Exactly one action released

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m4q-r2-b001-20260923","count":1}
```

This action may act only on the current single PENDING item.

It must not replay any of the 44 SUCCEEDED items.

Expected successful submit-phase closure:

```text
PENDING = 0
WAITING = 1
SUCCEEDED = 44
REQUESTS_STARTED = 45
OPERATIONS_ACCEPTED = 45
FAILED = 0
UNKNOWN = 0
```

The actual returned Bridge envelope is authority.

## 4. After successful final submit

Do not issue another submit.

Wait until the new operation is due under the Bridge's deferred timing guard (minimum first poll = 5 minutes).

Then release exactly one collection command for the remaining WAITING item.

## 5. Hard stop rules

```text
UNKNOWN > 0 -> STOP / NO BLIND REPLAY
FAILED > 0 -> STOP / CLASSIFY
PENDING = 0 and OPERATIONS_ACCEPTED = 45 -> SUBMIT PHASE CLOSED
```

## 6. Not released

```text
collectN = FORBIDDEN UNTIL FINAL SUBMIT RESULT IS PERSISTED/READ BACK AND DUE
exportPage = FORBIDDEN
synchronous Search = FORBIDDEN
Wordstat = FORBIDDEN
GenSearch = FORBIDDEN
Pass B = BLOCKED
M5 = PAUSED
M7 = BLOCKED
```

NEXT:
execute exactly one `submitN count=1` -> return complete Bridge result -> persist/readback -> wait until due -> collect final result -> terminal 45/45 -> export.
