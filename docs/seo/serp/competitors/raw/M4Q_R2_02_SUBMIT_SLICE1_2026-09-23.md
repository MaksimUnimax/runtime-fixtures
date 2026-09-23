# M4Q R2 raw evidence — async submit slice 1

Date: 2026-09-23  
Job: `octoport-m4q-r2-b001-20260923`  
Stage: `submitN count=25`  
Protocol: `SEARCH_ASYNC_BATCH_API_V1`

## Exact received Bridge envelope

```text
SEARCH_ASYNC_BATCH_RESULT_V1 {"action":"submitN","job_id":"octoport-m4q-r2-b001-20260923","ok":true,"request_executed":true,"provider_calls":22,"processed":22,"normalized":0,"bounded_stop":true,"last":{"outcome":"accepted","code":null,"index":21,"operation_id":"sprt1dealvkba7l5j85b"},"progress":{"job_id":"octoport-m4q-r2-b001-20260923","control":"RUNNING","total":45,"counts":{"PENDING":23,"SUBMITTING":0,"WAITING":22,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":0,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":22,"operations_accepted":22,"polls_started":0,"unresolved":45,"all_successful":false,"busy":false,"revision":44}}
```

## Reconciled execution truth

```text
SUBMIT_OK = true
REQUEST_EXECUTED = true
PROVIDER_CALLS_THIS_ACTION = 22
PROCESSED = 22
NORMALIZED = 0
BOUNDED_STOP = true
LAST_OUTCOME = accepted
LAST_INDEX = 21
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

Interpretation:

`bounded_stop=true` after 22 accepted operations is a resumable runtime-slice stop, not a provider failure. No blind replay of accepted items is permitted. The remaining submit work is exactly the current 23 PENDING items.

No collection or export is authorized by this raw-evidence artifact.
