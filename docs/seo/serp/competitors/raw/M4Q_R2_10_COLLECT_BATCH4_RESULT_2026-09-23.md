# M4Q R2 raw evidence — collect batch 4 result

Date: 2026-09-23
Job: `octoport-m4q-r2-b001-20260923`
Action: `collectN count=6`

## Exact received Bridge envelope

```text
SEARCH_ASYNC_BATCH_RESULT_V1 {"action":"collectN","job_id":"octoport-m4q-r2-b001-20260923","ok":true,"request_executed":true,"provider_calls":6,"processed":6,"normalized":6,"bounded_stop":false,"last":{"outcome":"received","code":null,"index":43,"operation_id":"sprv2kfp3i1jhp2sqf9i"},"progress":{"job_id":"octoport-m4q-r2-b001-20260923","control":"RUNNING","total":45,"counts":{"PENDING":1,"SUBMITTING":0,"WAITING":0,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":44,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":44,"operations_accepted":44,"polls_started":44,"unresolved":1,"all_successful":false,"busy":false,"revision":220}}
```

## Reconciled truth

```text
REQUEST_EXECUTED = true
PROVIDER_CALLS_THIS_ACTION = 6
PROCESSED = 6
NORMALIZED = 6
BOUNDED_STOP = false

LAST_OUTCOME = received
LAST_INDEX = 43
LAST_OPERATION_ID = sprv2kfp3i1jhp2sqf9i

TOTAL = 45
PENDING = 1
WAITING = 0
SUCCEEDED = 44
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 44
UNRESOLVED = 1
REVISION = 220
```

Interpretation:

All 44 already-submitted deferred Search operations have now been collected and normalized successfully.

Exactly one item remains PENDING and has never been submitted to the provider.

No further collect is needed before a separate decision/release for that final PENDING item.
