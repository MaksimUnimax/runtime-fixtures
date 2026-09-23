# M4Q R2 raw evidence — final collect result

Date: 2026-09-23  
Job: `octoport-m4q-r2-b001-20260923`  
Action: `collectN count=1`

## Exact received Bridge envelope

```text
SEARCH_ASYNC_BATCH_RESULT_V1 {"action":"collectN","job_id":"octoport-m4q-r2-b001-20260923","ok":true,"request_executed":true,"provider_calls":1,"processed":1,"normalized":1,"bounded_stop":false,"last":{"outcome":"received","code":null,"index":44,"operation_id":"sprg7lkstbo8aa72re2l"},"progress":{"job_id":"octoport-m4q-r2-b001-20260923","control":"RUNNING","total":45,"counts":{"PENDING":0,"SUBMITTING":0,"WAITING":0,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":45,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":45,"operations_accepted":45,"polls_started":45,"unresolved":0,"all_successful":true,"busy":false,"revision":225}}
```

## Reconciled terminal truth

```text
REQUEST_EXECUTED = true
PROVIDER_CALLS_THIS_ACTION = 1
PROCESSED = 1
NORMALIZED = 1
BOUNDED_STOP = false

LAST_OUTCOME = received
LAST_INDEX = 44
LAST_OPERATION_ID = sprg7lkstbo8aa72re2l

TOTAL = 45
PENDING = 0
WAITING = 0
SUCCEEDED = 45
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 45
OPERATIONS_ACCEPTED = 45
POLLS_STARTED = 45
UNRESOLVED = 0
ALL_SUCCESSFUL = true
REVISION = 225
```

Interpretation:

All 45 planned Yandex deferred Search operations were submitted exactly once, collected, and normalized successfully.

Provider acquisition is terminal.

No further Search submit or collect action is authorized.

The only remaining Bridge work is local paged export from the persisted async job at revision 225.
