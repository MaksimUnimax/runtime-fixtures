# M4Q R2 raw evidence — early collect deviation

Date: 2026-09-23  
Job: `octoport-m4q-r2-b001-20260923`  
Observed action: `collectN`  
Expected prior released action: `submitN count=23`

## Exact received Bridge envelope

```text
SEARCH_ASYNC_BATCH_RESULT_V1 {"action":"collectN","job_id":"octoport-m4q-r2-b001-20260923","ok":true,"request_executed":true,"provider_calls":1,"processed":1,"normalized":1,"bounded_stop":false,"last":{"outcome":"received","code":null,"index":0,"operation_id":"spr5mar31fe2ahpk49u4"},"progress":{"job_id":"octoport-m4q-r2-b001-20260923","control":"RUNNING","total":45,"counts":{"PENDING":23,"SUBMITTING":0,"WAITING":21,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":1,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":22,"operations_accepted":22,"polls_started":1,"unresolved":44,"all_successful":false,"busy":false,"revision":47}}
```

## Reconciled truth

```text
OBSERVED_ACTION = collectN
REQUEST_EXECUTED = true
PROVIDER_CALLS_THIS_ACTION = 1
PROCESSED = 1
NORMALIZED = 1
BOUNDED_STOP = false

LAST_OUTCOME = received
LAST_INDEX = 0
LAST_OPERATION_ID = spr5mar31fe2ahpk49u4

TOTAL = 45
PENDING = 23
WAITING = 21
SUCCEEDED = 1
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 22
OPERATIONS_ACCEPTED = 22
POLLS_STARTED = 1
UNRESOLVED = 44
REVISION = 47
```

## Interpretation

This was an execution-order deviation from the released second submit slice. It is not a provider failure.

One already-submitted operation was successfully collected and normalized. No accepted submit was replayed. The 23 not-yet-submitted items remain PENDING. No FAILED or UNKNOWN state exists.

The durable job is therefore still safely continuable.

Current safe continuation:

```text
do not collect again now
do not resubmit any WAITING/SUCCEEDED item
submit only the 23 current PENDING items
```

No semantic interpretation of the collected SERP is authorized yet. Full evidence export remains later.
