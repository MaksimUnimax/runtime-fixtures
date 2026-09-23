# M4Q R2 raw evidence — collect batch 3 result

Date: 2026-09-23
Job: `octoport-m4q-r2-b001-20260923`
Action: `collectN count=18`

## Exact received Bridge envelope

```text
SEARCH_ASYNC_BATCH_RESULT_V1 {"action":"collectN","job_id":"octoport-m4q-r2-b001-20260923","ok":true,"request_executed":true,"provider_calls":12,"processed":12,"normalized":12,"bounded_stop":true,"last":{"outcome":"received","code":null,"index":37,"operation_id":"spr2po4vrhbi33jgqg8u"},"progress":{"job_id":"octoport-m4q-r2-b001-20260923","control":"RUNNING","total":45,"counts":{"PENDING":1,"SUBMITTING":0,"WAITING":6,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":38,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":44,"operations_accepted":44,"polls_started":38,"unresolved":7,"all_successful":false,"busy":false,"revision":202}}
```

## Reconciled truth

```text
REQUEST_EXECUTED = true
PROVIDER_CALLS_THIS_ACTION = 12
PROCESSED = 12
NORMALIZED = 12
BOUNDED_STOP = true

LAST_OUTCOME = received
LAST_INDEX = 37
LAST_OPERATION_ID = spr2po4vrhbi33jgqg8u

TOTAL = 45
PENDING = 1
WAITING = 6
SUCCEEDED = 38
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 38
UNRESOLVED = 7
REVISION = 202
```

Interpretation:

`bounded_stop=true` after 12 successful receives is a resumable runtime-slice stop, not a provider failure.

The 6 WAITING items are already-submitted operations. The one PENDING item remains intentionally unsubmitted under the current operator order.

No submit or export is authorized by this raw-evidence artifact.
