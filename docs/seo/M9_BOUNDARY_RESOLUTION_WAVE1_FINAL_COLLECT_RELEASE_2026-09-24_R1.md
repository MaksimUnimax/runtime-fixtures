# Octoport SEO — M9 boundary-resolution Wave-1 final collect release — 2026-09-24 R1

Status: **RELEASED FOR ONE FINAL COLLECTN COUNT=1**
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream:
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_COLLECT_SLICE2_RECEIPT_2026-09-24_R1.md`
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_OPERATION_ID_READBACK_2026-09-24_R1.md`

## Current durable state

```text
JOB_ID = octoport-m9br-wave1-20260924-r1
TOTAL = 25
SUCCEEDED = 24
WAITING = 1
PENDING = 0
RESULT_SAVED = 0
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
POLLS_STARTED = 24
UNRESOLVED = 1
REVISION = 122
```

The sole remaining row is:

```text
INDEX = 24
OPERATION_ID = sprababvmok5spakfra2
STATE = WAITING
POLL_COUNT_BEFORE_FINAL_COLLECT = 0
```

Its original first-poll due time already passed. No renewed five-minute wait is required.

## Exact authorized action

Only this command is authorized:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m9br-wave1-20260924-r1","count":1}
```

Expected ideal completion:

```text
SUCCEEDED = 25
WAITING = 0
RESULT_SAVED = 0
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
POLLS_STARTED = 25
UNRESOLVED = 0
ALL_SUCCESSFUL = true
```

If the provider returns `waiting` for index 24:
- keep it WAITING;
- do not treat it as failure;
- wait another five minutes before any subsequent poll;
- no blind immediate retry.

If terminal result is received and normalization succeeds:
- collection phase is complete;
- next action is local state/readback + complete export, not another provider call.

No Search submit is authorized.
M10A remains blocked.
