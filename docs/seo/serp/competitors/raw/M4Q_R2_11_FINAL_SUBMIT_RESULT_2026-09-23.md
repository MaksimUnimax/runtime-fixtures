# M4Q R2 raw evidence — final submit result

Date: 2026-09-23
Job: `octoport-m4q-r2-b001-20260923`
Action: `submitN count=1`

## Exact received Bridge envelope

```text
SEARCH_ASYNC_BATCH_RESULT_V1 {"action":"submitN","job_id":"octoport-m4q-r2-b001-20260923","ok":true,"request_executed":true,"provider_calls":1,"processed":1,"normalized":0,"bounded_stop":false,"last":{"outcome":"accepted","code":null,"index":44,"operation_id":"sprg7lkstbo8aa72re2l"},"progress":{"job_id":"octoport-m4q-r2-b001-20260923","control":"RUNNING","total":45,"counts":{"PENDING":0,"SUBMITTING":0,"WAITING":1,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":44,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":45,"operations_accepted":45,"polls_started":44,"unresolved":1,"all_successful":false,"busy":false,"revision":222}}
```

## Reconciled truth

```text
REQUEST_EXECUTED = true
PROVIDER_CALLS_THIS_ACTION = 1
PROCESSED = 1
NORMALIZED = 0
BOUNDED_STOP = false

LAST_OUTCOME = accepted
LAST_INDEX = 44
LAST_OPERATION_ID = sprg7lkstbo8aa72re2l

TOTAL = 45
PENDING = 0
WAITING = 1
SUCCEEDED = 44
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 45
OPERATIONS_ACCEPTED = 45
POLLS_STARTED = 44
UNRESOLVED = 1
REVISION = 222
```

Interpretation:

All 45 planned Search queries have now been submitted exactly once.

Submit phase is closed.

The only unresolved item is index 44, operation `sprg7lkstbo8aa72re2l`, currently WAITING.

No further submit is authorized.

The next provider action may only be a collection of this final WAITING operation after the Bridge deferred timing guard becomes due.
