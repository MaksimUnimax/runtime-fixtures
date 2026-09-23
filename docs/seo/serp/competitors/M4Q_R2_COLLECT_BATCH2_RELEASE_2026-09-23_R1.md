# Octoport SEO — M4Q R2 deferred collection batch 2 release R1

Date: 2026-09-23
Status: **EXACTLY ONE collectN(count=25) RELEASED**
Job: `octoport-m4q-r2-b001-20260923`

## Current durable state

Latest accepted Bridge truth:

```text
TOTAL = 45
REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 13

PENDING = 1
WAITING = 31
SUCCEEDED = 13
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

UNRESOLVED = 32
REVISION = 127
```

Latest raw evidence:

`raw/M4Q_R2_07_COLLECT_BATCH1_RESULT_2026-09-23.md`

Remote readback:

```text
RAW_GIT_BLOB = 9855ca71ff2224196cc408684c00462e78c248f8
REMOTE_READBACK = PASS
```

## Operator order remains frozen

```text
DO NOT SUBMIT THE LAST PENDING ITEM YET.
FIRST COLLECT THE ALREADY-SUBMITTED OPERATIONS.
```

Therefore the current one PENDING item remains untouched.

## Exactly one action released

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m4q-r2-b001-20260923","count":25}
```

This action may only collect already-submitted WAITING operations.

Valid outcomes include:
- multiple received/normalized items;
- bounded runtime stop before 25;
- fewer due operations than requested;
- local no-due stop with zero provider calls.

If any FAILED, PARSE_FAILED or UNKNOWN state appears, stop and reconcile before any further collection.

## Not released

```text
submitN = FORBIDDEN
submit = FORBIDDEN
additional collect after this command = FORBIDDEN UNTIL RESULT RECONCILIATION
exportPage = FORBIDDEN
Pass B = BLOCKED
M5 = PAUSED
M7 = BLOCKED
```

NEXT:
execute exactly one `collectN count=25` -> return complete result -> persist/readback -> decide next collection sweep from actual state.
