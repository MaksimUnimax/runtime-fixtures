# Octoport SEO — M4Q R2 complete deferred Search export acceptance R1

Date: 2026-09-23
Status: **ACCEPTED / COMPLETE 45-QUERY TOP-100 CORPUS / PROVIDER+EXPORT PHASE CLOSED**
Job: `octoport-m4q-r2-b001-20260923`

## 1. Terminal provider authority

Provider lifecycle terminal state was previously persisted and remote-read back:

```text
TOTAL = 45
PENDING = 0
WAITING = 0
SUCCEEDED = 45
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
UNRESOLVED = 0
ALL_SUCCESSFUL = true
REQUESTS_STARTED = 45
OPERATIONS_ACCEPTED = 45
POLLS_STARTED = 45
REVISION = 225
```

No further Yandex Search provider call is required or authorized.

## 2. Export page 1

```text
FILE = search-octoport-m4q-r2-b001-20260923-r225-0-24.json
SIZE_BYTES = 9207000
SHA256 = 4e9890bfba1006e116523701d61d0edfc82f6305b68d412101eb5f4aaec4aeb7
SCHEMA = YMB_SEARCH_ASYNC_EXPORT_PAGE_V1
REVISION = 225
AFTER = -1
ITEM_COUNT = 25
INDICES = 0..24
ITEMS_WITH_RAW = 25
ITEMS_WITH_NORMALIZED = 25
NORMALIZED_RESULT_ROWS = 2500
NEXT_AFTER = 24
HAS_MORE = true
```

Durable manifest:
`raw/M4Q_R2_13_EXPORT_PAGE1_MANIFEST_2026-09-23.md`

## 3. Export page 2

```text
FILE = search-octoport-m4q-r2-b001-20260923-r225-25-44.json
SIZE_BYTES = 7586040
SHA256 = d185d8a11cfbe70beb10418da7341000481d3faa7856a8ed62a1237cfe73e254
SCHEMA = YMB_SEARCH_ASYNC_EXPORT_PAGE_V1
REVISION = 225
AFTER = 24
ITEM_COUNT = 20
INDICES = 25..44
ITEMS_WITH_RAW = 20
ITEMS_WITH_NORMALIZED = 20
NORMALIZED_RESULT_ROWS = 2000
NEXT_AFTER = 44
HAS_MORE = false
```

Durable manifest:
`raw/M4Q_R2_14_EXPORT_PAGE2_MANIFEST_2026-09-23.md`

## 4. Cross-page completeness QA

Both owner-relayed export files were parsed in full, not sampled.

```text
COMBINED_ITEM_COUNT = 45
COMBINED_UNIQUE_INDICES = 45
COMBINED_INDEX_RANGE = 0..44
INDEX_GAPS = 0
INDEX_OVERLAPS = 0

FROZEN_QUERY_ORDER_MATCH = 45/45 PASS

COMBINED_ITEMS_WITH_RAW = 45/45
COMBINED_ITEMS_WITH_NORMALIZED = 45/45
COMBINED_NORMALIZED_RESULT_ROWS = 4500
EXPECTED_TOP100_ROWS = 4500
EACH_QUERY_NORMALIZED_ROWS = 100

ALL_ITEMS_SUCCEEDED = 45/45
OPERATION_IDS_UNIQUE = 45/45
RESULT_JOB_ID_MATCH = 45/45
RESULT_INDEX_MATCH = 45/45
RESULT_OPERATION_ID_MATCH = 45/45

SAME_JOB_ID_ACROSS_PAGES = true
SAME_REVISION_ACROSS_PAGES = true
SAME_SEARCH_PARAMETERS_ACROSS_PAGES = true
SAME_TERMINAL_JOB_SUMMARY_ACROSS_PAGES = true

FINAL_NEXT_AFTER = 44
FINAL_HAS_MORE = false
```

Search parameters remained the accepted frozen contract:

```text
searchType = SEARCH_TYPE_RU
region = 225
page = 0
groupsOnPage = 100
docsInGroup = 1
groupMode = GROUP_MODE_FLAT
familyMode = FAMILY_MODE_MODERATE
fixTypoMode = FIX_TYPO_MODE_OFF
sortMode = SORT_MODE_BY_RELEVANCE
sortOrder = SORT_ORDER_DESC
l10n = LOCALIZATION_RU
maxPassages = 4
```

## 5. Acceptance

```text
M4Q_R2_PROVIDER_ACQUISITION = PASS
M4Q_R2_EXPORT_COMPLETENESS = PASS
M4Q_R2_QUERY_IDENTITY = PASS
M4Q_R2_TOP100_ROW_COVERAGE = 4500/4500
M4Q_R2_COMPLETE_SERP_CORPUS = ACCEPTED
```

The two JSON files are the full owner-relayed evidence corpus. Their exact SHA256 identities are binding for downstream Work.

No additional Search acquisition or export is authorized for this job.

## 6. Next architecture gate

The pre-existing M4Q R2 authority requires a second large-data Work pass after provider acquisition.

Pass B must process the complete accepted corpus and build:

`exact query × authorized competitor × ranking URL × rank`

visibility evidence, then reconcile the findings against M4Q/M4C/M6 without converting Search visibility into Wordstat demand.

```text
MAIN_CHAT_FULL_VOLUME_MATRIX_BUILD = FORBIDDEN
PASS_B_WORK_TRIGGER = MET
M5 = PAUSED
M6 = NOT_STARTED
M7 = BLOCKED
```

Pass B must use both exact export files and all required frozen project authorities. No sampling, FIRST_N, provider calls, or new web acquisition.
