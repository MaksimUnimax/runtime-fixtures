# M4Q R2 raw evidence — collect batch 1 result

Date: 2026-09-23
Job: `octoport-m4q-r2-b001-20260923`
Action: `collectN count=25`

## Exact received Bridge envelope

```text
SEARCH_ASYNC_BATCH_RESULT_V1 {"action":"collectN","job_id":"octoport-m4q-r2-b001-20260923","ok":true,"request_executed":true,"provider_calls":10,"processed":10,"normalized":10,"bounded_stop":true,"last":{"outcome":"received","code":null,"index":12,"operation_id":"spr7kejrv6fjo9rqiu3t"},"progress":{"job_id":"octoport-m4q-r2-b001-20260923","control":"RUNNING","total":45,"counts":{"PENDING":1,"SUBMITTING":0,"WAITING":31,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":13,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":44,"operations_accepted":44,"polls_started":13,"unresolved":32,"all_successful":false,"busy":false,"revision":127}}
```

## Reconciled truth

```text
REQUEST_EXECUTED = true
PROVIDER_CALLS_THIS_ACTION = 10
PROCESSED = 10
NORMALIZED = 10
BOUNDED_STOP = true

LAST_OUTCOME = received
LAST_INDEX = 12
LAST_OPERATION_ID = spr7kejrv6fjo9rqiu3t

TOTAL = 45
PENDING = 1
WAITING = 31
SUCCEEDED = 13
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 13
UNRESOLVED = 32
REVISION = 127
```

Interpretation:

`bounded_stop=true` after 10 successful receives is a resumable runtime-slice stop, not a provider failure.

The 31 WAITING items are already-submitted operations. The one PENDING item remains intentionally unsubmitted under the current operator order.

No submit or export is authorized by this raw-evidence artifact.
