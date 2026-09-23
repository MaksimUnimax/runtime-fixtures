# M4Q R2 raw evidence — async submit slice 2

Date: 2026-09-23  
Job: `octoport-m4q-r2-b001-20260923`  
Stage: `submitN count=23`  
Protocol: `SEARCH_ASYNC_BATCH_API_V1`

## Exact received Bridge envelope

```text
SEARCH_ASYNC_BATCH_RESULT_V1 {"action":"submitN","job_id":"octoport-m4q-r2-b001-20260923","ok":true,"request_executed":true,"provider_calls":22,"processed":22,"normalized":0,"bounded_stop":true,"last":{"outcome":"accepted","code":null,"index":43,"operation_id":"sprv2kfp3i1jhp2sqf9i"},"progress":{"job_id":"octoport-m4q-r2-b001-20260923","control":"RUNNING","total":45,"counts":{"PENDING":1,"SUBMITTING":0,"WAITING":43,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":1,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":44,"operations_accepted":44,"polls_started":1,"unresolved":44,"all_successful":false,"busy":false,"revision":91}}
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
LAST_INDEX = 43
LAST_OPERATION_ID = sprv2kfp3i1jhp2sqf9i

TOTAL = 45
PENDING = 1
WAITING = 43
SUCCEEDED = 1
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 1
UNRESOLVED = 44
REVISION = 91
```

Interpretation:

`bounded_stop=true` after 22 additional accepted operations is a resumable runtime-slice stop, not a provider failure.

Across the job:
- 44/45 submit operations are accepted;
- one already-submitted operation was previously collected successfully;
- exactly one item remains PENDING;
- no FAILED or UNKNOWN state exists.

No collection or export is authorized by this raw-evidence artifact.
