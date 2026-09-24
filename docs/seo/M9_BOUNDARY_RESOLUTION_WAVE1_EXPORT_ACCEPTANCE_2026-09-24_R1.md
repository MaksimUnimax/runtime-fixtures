# Octoport SEO — M9 boundary-resolution Wave-1 export acceptance — 2026-09-24 R1

Status: **PASS_COMPLETE_EXPORT / CURRENT RU225 TOP100 EVIDENCE ACCEPTED**
Branch: `seo/wordstat-batch-01-2026-09-16`

Source attachment:
`search-octoport-m9br-wave1-20260924-r1-r125-0-24.json`

## 1. Exact source identity

```text
BYTES = 8768838
SHA256 = 71a33e74c41bfeb73bdcae5d3676df052a9c20bc93a6593bc2aec6821650a841

SCHEMA = YMB_SEARCH_ASYNC_EXPORT_PAGE_V1
JOB_ID = octoport-m9br-wave1-20260924-r1
REVISION = 125
TOTAL_ITEMS = 25
AFTER = -1
```

## 2. Frozen Search context

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

This is the same exact context released by the accepted Wave-1 provider plan.

## 3. Export page contract

```text
ITEM_COUNT = 25/25
RESULT_ROW_COUNT = 2500/2500
ITEMS_WITH_RAW = 25/25
ITEMS_WITH_NORMALIZED = 25/25
STATES.SUCCEEDED = 25/25
NEXT_AFTER = 24
HAS_MORE = false
ALL_JOB_ITEMS_IN_THIS_FILE = true
```

Job summary in the export:

```text
PENDING = 0
WAITING = 0
COLLECTING = 0
RESULT_SAVED = 0
SUCCEEDED = 25
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
CANCELLED = 0
REQUESTS_STARTED = 25
OPERATIONS_ACCEPTED = 25
POLLS_STARTED = 25
ALL_SUCCESSFUL = true
UNRESOLVED = 0
BUSY = false
REVISION = 125
```

## 4. Full-volume item validation

Main Chat parsed all 25 items and all 2,500 normalized rows from the complete attachment.

```text
INDEX_SET = 0..24
INDEX_UNIQUE = 25/25
OPERATION_ID_UNIQUE = 25/25
STATE_SUCCEEDED = 25/25
POLL_COUNT = 1 FOR 25/25
PARSE_ERROR_NULL = 25/25

RAW_TEXT_PRESENT = 25/25
RAW_TEXT_JSON_PARSE = 25/25
RAW_OPERATION_ID_MATCH = 25/25
RAW_DONE_TRUE = 25/25
RAW_RESPONSE_RAWDATA_PRESENT = 25/25

NORMALIZED_PRESENT = 25/25
RESPONSE_FORMAT_XML = 25/25
RESULT_COUNT = 100 FOR 25/25
NORMALIZED_ROWS = 2500/2500
RANK_SEQUENCE = 1..100 FOR 25/25
UNIQUE_URLS_PER_QUERY = 100/100 FOR 25/25
```

No row reconstruction, sampling, truncation or silent repair was used.

## 5. XML guard / URL-comparison gate

Every query returned:

```text
validation.schema = YMB_ASYNC_XML_GUARD_V1
document_count = 100
empty_proven = false
xml_error_code = null
usable_for_url_comparison = true
missing_url_ranks = []
unsafe_url_ranks = []
```

Therefore:

```text
URL_COMPARISON_ELIGIBLE = 25/25
INVALID_SERP_SNAPSHOT = 0
MISSING_URL_RANKS = 0
UNSAFE_URL_RANKS = 0
```

Unique-domain counts per query range from 54 to 83; exact URLs remain the primary overlap field and domains are secondary, matching frozen M9 methodology.

## 6. Query identity

The 25 exported query strings were compared in order to the accepted:

`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/M9BR_WAVE1_QUERY_MANIFEST.tsv`

```text
QUERY_COUNT_MATCH = 25/25
QUERY_ORDER_MATCH = 25/25
EXACT_QUERY_TEXT_MATCH = 25/25
QUERY_REPHRASE = 0
DUPLICATE_EXPORTED_QUERY = 0
```

## 7. Semantic-use boundary

This export is accepted as **current exact-query RU225 Top100 Search evidence** for the 25 Wave-1 semantic identities.

It may:
- create 25 new current Search anchors;
- change Search comparability from ONE/NO current SERP to bilateral/current;
- change exact URL/domain overlap metrics;
- change pair decisions where accepted M9 rules permit;
- change cluster retention after the complete 5,356-pair rerun.

It does **not**:
- create Wordstat demand;
- create Alice/GenSearch evidence;
- infer page type for identities without frozen page-type authority;
- create page ownership;
- create URL/H1/Title/IA decisions.

## 8. Required next step

```text
ACCEPT WAVE1 SEARCH EVIDENCE
-> BUILD 47-ANCHOR CURRENT SEARCH MAP
-> RERUN COMPLETE 5356-PAIR M9 UNIVERSE
-> RERUN COMPLETE-LINK CLUSTERS
-> RERUN ADVERSARIAL QA
-> MAIN CHAT ACCEPT / HOLD / REWORK
```

No partial pair patch is allowed.
M10A remains blocked until the rerun is accepted.
