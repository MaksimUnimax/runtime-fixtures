# M4Q R2 export page 1 manifest

Date: 2026-09-23
Job: `octoport-m4q-r2-b001-20260923`
Source file: `search-octoport-m4q-r2-b001-20260923-r225-0-24.json`

## Exact file identity

```text
SIZE_BYTES = 9207000
SHA256 = 4e9890bfba1006e116523701d61d0edfc82f6305b68d412101eb5f4aaec4aeb7
SCHEMA = YMB_SEARCH_ASYNC_EXPORT_PAGE_V1
JOB_ID = octoport-m4q-r2-b001-20260923
REVISION = 225
TOTAL_ITEMS = 45
AFTER = -1
```

## Page truth

```text
ITEM_COUNT = 25
INDEX_FIRST = 0
INDEX_LAST = 24
INDICES_CONTIGUOUS = true
ALL_PAGE_ITEMS_SUCCEEDED = true

ITEMS_WITH_RAW = 25
ITEMS_WITH_NORMALIZED = 25
NORMALIZED_RESULT_ROWS = 2500
EACH_ITEM_NORMALIZED_ROWS = 100

NEXT_AFTER = 24
HAS_MORE = true
ALL_JOB_ITEMS_IN_THIS_FILE = false
```

## Cross-checks

```text
FROZEN_QUERY_ORDER_MATCH_0_24 = PASS
OPERATION_IDS_UNIQUE_25_OF_25 = PASS
RESULT_JOB_ID_MATCH = 25/25
RESULT_INDEX_MATCH = 25/25
RESULT_OPERATION_ID_MATCH = 25/25
RAW_PAYLOAD_PRESENT = 25/25
NORMALIZED_ROWS_MATCH_PAGE_SUMMARY = 2500/2500
```

## Job summary carried by export

```text
PENDING = 0
WAITING = 0
SUCCEEDED = 45
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
CANCELLED = 0
REQUESTS_STARTED = 45
OPERATIONS_ACCEPTED = 45
POLLS_STARTED = 45
ALL_SUCCESSFUL = true
UNRESOLVED = 0
REVISION = 225
```

## Continuation authority

The file itself reports:

```text
next_after = 24
has_more = true
```

Therefore the only valid continuation export cursor is `after=24` at revision `225`.

The 9.2 MB JSON payload remains owner-relayed attachment evidence. This manifest records its exact identity and verified structure; it does not replace or reserialize the source file.
