# M4Q R2 raw evidence — collect batch 2 result

Date: 2026-09-23
Job: `octoport-m4q-r2-b001-20260923`
Action: `collectN count=25`

## Exact received Bridge envelope

```text
SEARCH_ASYNC_BATCH_RESULT_V1 {"action":"collectN","job_id":"octoport-m4q-r2-b001-20260923","ok":true,"request_executed":true,"provider_calls":13,"processed":13,"normalized":13,"bounded_stop":true,"last":{"outcome":"received","code":null,"index":25,"operation_id":"sprsje73sbeqelrb8thm"},"progress":{"job_id":"octoport-m4q-r2-b001-20260923","control":"RUNNING","total":45,"counts":{"PENDING":1,"SUBMITTING":0,"WAITING":18,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":26,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":44,"operations_accepted":44,"polls_started":26,"unresolved":19,"all_successful":false,"busy":false,"revision":166}}
```

## Reconciled truth

```text
REQUEST_EXECUTED = true
PROVIDER_CALLS_THIS_ACTION = 13
PROCESSED = 13
NORMALIZED = 13
BOUNDED_STOP = true

LAST_OUTCOME = received
LAST_INDEX = 25
LAST_OPERATION_ID = sprsje73sbeqelrb8thm

TOTAL = 45
PENDING = 1
WAITING = 18
SUCCEEDED = 26
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 26
UNRESOLVED = 19
REVISION = 166
```

Interpretation:

`bounded_stop=true` after 13 successful receives is a resumable runtime-slice stop, not a provider failure.

The 18 WAITING items are already-submitted operations. The one PENDING item remains intentionally unsubmitted under the current operator order.

No submit or export is authorized by this raw-evidence artifact.
