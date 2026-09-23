# Octoport SEO — M4Q R2 deferred collection batch 1 release R1

Date: 2026-09-23
Status: **EXACTLY ONE collectN(count=25) RELEASED**
Job: `octoport-m4q-r2-b001-20260923`

## Current durable state

Latest accepted Bridge truth:

```text
TOTAL = 45
REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 3

PENDING = 1
WAITING = 41
SUCCEEDED = 3
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0

UNRESOLVED = 42
REVISION = 97
```

Latest raw evidence:
- `raw/M4Q_R2_05_COLLECT_INDEX1_2026-09-23.md`
- `raw/M4Q_R2_06_COLLECT_INDEX2_2026-09-23.md`

Remote readback = PASS.

## Execution rule for this phase

The current operator decision is:

```text
DO NOT SUBMIT THE LAST PENDING ITEM YET.
FIRST COLLECT THE ALREADY-SUBMITTED OPERATIONS.
```

Therefore:

```text
submitN = FORBIDDEN
submit = FORBIDDEN
```

The current 41 WAITING items already have accepted Yandex Operation identities.
Collection must operate only on those existing operations.

## Exactly one action released

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m4q-r2-b001-20260923","count":25}
```

This is a bounded collection sweep over already-submitted WAITING operations.

The actual returned `SEARCH_ASYNC_BATCH_RESULT_V1` is authority.

Possible valid outcomes include:
- multiple items received and normalized;
- fewer than 25 processed because the runtime slice budget expires;
- fewer than 25 processed because only part of WAITING is currently due;
- local no-due stop with zero provider polling.

Any `FAILED`, `PARSE_FAILED` or `UNKNOWN` state requires stop and reconciliation.

## Not released

```text
last PENDING submit = FORBIDDEN
additional collectN after this command = FORBIDDEN UNTIL RESULT RECONCILIATION
exportPage = FORBIDDEN
Pass B = BLOCKED
M5 = PAUSED
M7 = BLOCKED
```

NEXT:
execute exactly one `collectN count=25` -> return the complete result -> persist/readback -> decide next collection sweep from actual state.
