# Octoport SEO — M9 boundary-resolution Wave-1 paid submit release — 2026-09-24 R1

Status: **RELEASED FOR ONE BOUNDED SUBMITN / COLLECTION CLOSED**
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream:
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_PROVIDER_RELEASE_2026-09-24_R1.md`
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_START_RECEIPT_2026-09-24_R1.md`

## 1. Start gate

Accepted actual runtime state:

```text
JOB_ID = octoport-m9br-wave1-20260924-r1
CONTROL = RUNNING
TOTAL = 25
PENDING = 25
REQUEST_EXECUTED = false
PROVIDER_CALLS = 0
REQUESTS_STARTED = 0
OPERATIONS_ACCEPTED = 0
POLLS_STARTED = 0
UNRESOLVED = 25
REVISION = 0
START_RUNTIME_GATE = PASS
```

## 2. Fresh tariff check immediately before paid submit

Checked 2026-09-24 after the accepted start receipt and before this release.

Official source:
https://aistudio.yandex.ru/ru/docs/search-api/pricing

Current tariff facts:

```text
YANDEX_TARIFF_ZONE = UTC+3
CHECK_TIME_APPROX = 2026-09-24 10:31 UTC+3
ACTIVE_RATE = DAY_DEFERRED
DAY_DEFERRED = 30.5 RUB / 1000 = 0.0305 RUB/request
NIGHT_DEFERRED = 25.41 RUB / 1000 = 0.02541 RUB/request
NIGHT_WINDOW = 00:00:00..07:59:59 UTC+3
```

Cost ceiling for this release:

```text
MAX_PROVIDER_SUBMITS = 25
UNIT_COST_CEILING_RUB = 0.0305
MAX_COST_RUB = 25 * 0.0305 = 0.7625
```

Official limits rechecked:
https://aistudio.yandex.ru/ru/docs/search-api/concepts/limits

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

Only this Bridge action is authorized:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m9br-wave1-20260924-r1","count":25}
```

The current YMB 0.1.9 protocol bounds `submitN` to a maximum slice of 25 and may stop earlier because of its bounded execution window or a real stop condition.

Therefore:

```text
REQUESTED_COUNT = 25
PROCESSED MAY BE 1..25
PROVIDER_CALLS MUST EQUAL CONFIRMED EXECUTIONS
BOUNDED_STOP MAY BE true
UNKNOWN > 0 => STOP
FAILED > 0 => STOP AND RECONCILE
NO BLIND REPEAT OF SUBMITN
```

## 4. Required return/readback before any collection

Return full `SEARCH_ASYNC_BATCH_RESULT_V1`.

Main Chat must persist/read back:
- `request_executed`;
- `provider_calls`;
- `processed`;
- `bounded_stop`;
- last outcome/index/operation_id;
- complete progress counts;
- `requests_started`;
- `operations_accepted`;
- `polls_started`;
- `UNKNOWN`;
- revision.

Accepted Operation IDs must be preserved before any collect command.

No `collectN` is authorized by this artifact.

No second `submitN` is authorized unless the first returned state proves some rows remain PENDING and there is no UNKNOWN/failed ambiguity, followed by a separate readback/release decision.

## 5. Downstream fence

After all 25 provider submissions are safely reconciled:
- wait at least the provider minimum before collection;
- collect only accepted due operations;
- preserve raw result before normalization;
- export/read back complete evidence;
- rerun the complete 5,356-pair M9 universe.

M10A remains blocked.
