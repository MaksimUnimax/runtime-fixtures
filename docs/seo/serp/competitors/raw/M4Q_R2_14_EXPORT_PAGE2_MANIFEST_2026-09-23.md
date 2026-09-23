# M4Q R2 export page 2 manifest

Date: 2026-09-23
Job: `octoport-m4q-r2-b001-20260923`
Source file: `search-octoport-m4q-r2-b001-20260923-r225-25-44.json`

## Exact file identity

```text
SIZE_BYTES = 7586040
SHA256 = d185d8a11cfbe70beb10418da7341000481d3faa7856a8ed62a1237cfe73e254
SCHEMA = YMB_SEARCH_ASYNC_EXPORT_PAGE_V1
JOB_ID = octoport-m4q-r2-b001-20260923
REVISION = 225
TOTAL_ITEMS = 45
AFTER = 24
```

## Page truth

```text
ITEM_COUNT = 20
INDEX_FIRST = 25
INDEX_LAST = 44
INDICES_CONTIGUOUS = true
ALL_PAGE_ITEMS_SUCCEEDED = true

ITEMS_WITH_RAW = 20
ITEMS_WITH_NORMALIZED = 20
NORMALIZED_RESULT_ROWS = 2000
EACH_ITEM_NORMALIZED_ROWS = 100

NEXT_AFTER = 44
HAS_MORE = false
ALL_JOB_ITEMS_IN_THIS_FILE = false
```

## Cross-checks

```text
FROZEN_QUERY_ORDER_MATCH_25_44 = PASS
OPERATION_IDS_UNIQUE_20_OF_20 = PASS
RESULT_JOB_ID_MATCH = 20/20
RESULT_INDEX_MATCH = 20/20
RESULT_OPERATION_ID_MATCH = 20/20
RAW_PAYLOAD_PRESENT = 20/20
NORMALIZED_ROWS_MATCH_PAGE_SUMMARY = 2000/2000
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

## Final cursor

The file reports:

```text
next_after = 44
has_more = false
```

Therefore paged export is terminal. No further `exportPage` is required.

The 7.586 MB JSON payload remains owner-relayed attachment evidence. This manifest records its exact identity and verified structure; it does not replace or reserialize the source file.
