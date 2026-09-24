# Octoport SEO — M9 boundary-resolution Wave-1 collect slice-1 release — 2026-09-24 R1

Status: **RELEASED FOR ONE BOUNDED COLLECTN COUNT=25**
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream:
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_OPERATION_ID_READBACK_2026-09-24_R1.md`
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_PRECOLLECT_TIME_GATE_2026-09-24_R1.md`

## 1. Collection admission state

```text
JOB_ID = octoport-m9br-wave1-20260924-r1
TOTAL = 25
WAITING = 25
PENDING = 0
UNKNOWN = 0
FAILED = 0
OPERATION_ID_UNIQUE = 25/25
POLL_COUNT_ZERO = 25/25
```

All accepted operation IDs were preserved before collection.

## 2. Time gate

Current YMB 0.1.9 contract:
`MIN_FIRST_POLL_MS = 5 minutes`.

Conservative last-admission receipt:
`2026-09-24T12:36:34+05:00`.

Earliest safe collection:
`2026-09-24T12:41:34+05:00`.

The safe time has been reached.

```text
PRE_COLLECTION_TIME_GATE = PASS
```

## 3. Fresh official provider contract check

Official Yandex Search API documentation rechecked immediately before release:
- deferred mode returns an Operation ID and later uses Operation GET for status/result;
- processing may take from five minutes to hours;
- result-check quota = 10 requests/second;
- deferred-result retention = up to 12 hours.

Sources:
- https://aistudio.yandex.ru/ru/docs/search-api/operations/web-search
- https://aistudio.yandex.ru/ru/docs/search-api/concepts/limits

No new Search submit is authorized by this release.

## 4. Exact authorized action

Only this command is authorized:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m9br-wave1-20260924-r1","count":25}
```

YMB 0.1.9 bounds a collection command by both:
- `count <= 25`;
- an internal approximately 10-second slice budget.

Therefore a legitimate return may process fewer than 25.

For each processed operation:
- `received` -> raw provider Operation response must be durably saved before normalization;
- successful local normalization may advance the item to `SUCCEEDED`;
- `waiting` -> item remains WAITING and its next poll is deferred by another five minutes;
- provider error / technical unknown / persistence failure -> stop and reconcile; no automatic retry.

## 5. Required return gate

Return the full `SEARCH_ASYNC_BATCH_RESULT_V1`.

Main Chat must record:
- `request_executed`;
- `provider_calls`;
- `processed`;
- `normalized`;
- `bounded_stop`;
- last outcome/code/index/operation_id;
- full progress state counts;
- `requests_started`;
- `operations_accepted`;
- `polls_started`;
- `UNKNOWN`;
- revision.

No second collect slice is automatic.
No submit action is authorized.
No M10A action is authorized.

After this receipt, Main Chat will determine from durable states whether:
- collection is complete;
- another due collect slice is warranted;
- or a five-minute waiting interval is required before another poll.
