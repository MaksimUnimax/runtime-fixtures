# Octoport SEO — M4Q R2 current Yandex Marketing Bridge preflight R2

Date: 2026-09-23  
Status: **PASS_CURRENT_ASYNC_PACKAGE_CAPABILITY / R1 HISTORICAL-ARTIFACT HOLD SUPERSEDED**  
Upstream: `M4Q_R2_PASS_A2_MAIN_CHAT_ACCEPTANCE_2026-09-23.md`

## 0. Correction

This document supersedes the capability conclusion in:

`M4Q_R2_BRIDGE_PREFLIGHT_2026-09-23_R1.md`

R1 inspected the historical `blood_sand` Wordstat/Search overlay 1.1.6 and incorrectly treated that historical artifact as the current Yandex Marketing Bridge capability.

Owner then supplied the current package:

`Yandex-Marketing-Bridge-0.1.9.zip`

Owner-supplied package identity observed by Main Chat:

```text
PACKAGE_VERSION = 0.1.9
ZIP_BYTES = 232456
ZIP_SHA256 = de4425a47645d537ef7b69994ef2df0f66c3e9bd6741b0b47884426bdd954c4c
JS_FILES_SYNTAX_CHECKED = 62
JS_FILES_SYNTAX_PASS = 62/62
```

The earlier conclusion `DEFERRED_WEBSEARCH = NOT_IMPLEMENTED` is invalid for 0.1.9.

## 1. Deferred Search capability in 0.1.9

The package explicitly implements a Manual-only durable deferred Search protocol:

`SEARCH_ASYNC_BATCH_API_V1`

Provider submit endpoint:

`POST https://searchapi.api.cloud.yandex.net/v2/web/searchAsync`

Operation collection endpoint:

`GET https://operation.api.cloud.yandex.net/operations/{operation_id}`

Supported actions include:

- `start`
- `submit` / `submitN`
- `collect` / `collectN` / `collectReady`
- `status`
- `itemsPage`
- `pause`
- `resume`
- `cancelPending`
- `normalizeSaved`
- `exportPage`

No deferred Autorun, hidden polling, hidden retry, or automatic replay exists. Provider submit/collect are explicit Manual actions.

## 2. Exact M4Q R2 request-shape compatibility

The current 0.1.9 `SearchProtocol` supports:

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
responseFormat = FORMAT_XML
```

Main Chat executed the package protocol locally with a synthetic 45-query start command.

Verified generated provider request:

```text
QUERY_COUNT = 45
SUBMIT_URL = https://searchapi.api.cloud.yandex.net/v2/web/searchAsync
FIX_TYPO_MODE = FIX_TYPO_MODE_OFF
GROUPS_ON_PAGE = 100
DOCS_IN_GROUP = 1
GROUP_MODE = GROUP_MODE_FLAT
PAGE = 0
REGION = 225
SEARCH_TYPE = SEARCH_TYPE_RU
SORT_MODE = SORT_MODE_BY_RELEVANCE
SORT_ORDER = SORT_ORDER_DESC
```

Therefore the Pass A2 exact-query contract is directly representable by the current package.

## 3. Capacity / batching

Current 0.1.9 limits:

```text
ASYNC_MAX_JOB_ITEMS = 1500
M4Q_R2_QUERY_COUNT = 45
ASYNC_MAX_PROVIDER_SLICE = 25
MIN_FIRST_POLL_MS = 300000
```

45 queries fit in one durable async job.

Provider submits/collects are intentionally bounded slices. A `submitN` or `collectN` command accepts at most 25 requested operations and also has an internal ~10 second slice budget, so one command may process fewer than its requested count. Progress/status must drive subsequent explicit slices; no query is dropped.

## 4. Durable evidence / recovery

Deferred Search 0.1.9 uses credential/folder-scoped IndexedDB durable ownership.

Per-item lifecycle includes:

`PENDING -> SUBMITTING -> WAITING -> COLLECTING -> RESULT_SAVED -> SUCCEEDED`

plus explicit failure/unknown/cancel states.

Important safety properties independently observed:

- provider admission is persisted before fetch;
- one admitted invocation performs exactly one fetch;
- no automatic retry;
- interrupted submit becomes `UNKNOWN`, not silently replayed;
- interrupted collect returns to a collectible waiting state;
- provider raw operation response is stored before normalization;
- normalization failure preserves raw evidence;
- file export is paged and checksum-protected;
- large exports use artifact/file delivery rather than forcing the complete payload into chat;
- export never truncates a record to fit a page.

Current async transport budget:

```text
MAX_RESPONSE_BYTES = 8 MiB
NORMALIZER_MAX_RESULTS = 250
```

This supersedes the obsolete R1 concern based on the historical 1.1.6 synchronous bridge's 1.5 MiB response bound.

## 5. Provider permission

0.1.9 manifest contains both:

- `https://searchapi.api.cloud.yandex.net/*`
- `https://operation.api.cloud.yandex.net/*`

The async worker enables provider transport when the Operation API host permission is present.

Therefore for this package:

```text
ASYNC_PROVIDER_PERMISSION_BY_MANIFEST = true
```

## 6. Fresh official provider verification

Official Yandex Search API documentation rechecked 2026-09-23 confirms that text search supports deferred/asynchronous mode, using WebSearchAsync plus Operation status/result retrieval.

Official current RUB tariff:

```text
DAY_DEFERRED = 30.5 RUB / 1000 = 0.0305 RUB/request
NIGHT_DEFERRED = 25.41 RUB / 1000 = 0.02541 RUB/request
DAY_SYNC = 488 RUB / 1000 = 0.488 RUB/request
NIGHT_SYNC = 366 RUB / 1000 = 0.366 RUB/request
```

For 45 initiated Search requests:

```text
DAY_DEFERRED_ESTIMATE = 1.3725 RUB
NIGHT_DEFERRED_ESTIMATE = 1.14345 RUB
DAY_SYNC_ESTIMATE = 21.96 RUB
NIGHT_SYNC_ESTIMATE = 16.47 RUB
```

Deferred is the preferred provider mode for this bounded 45-query acquisition.

## 7. Corrected verdict

```text
M4Q_R2_PASS_A2 = ACCEPTED
R2_EXECUTION_QUERIES = 45

CURRENT_BRIDGE_PACKAGE = Yandex Marketing Bridge 0.1.9
ASYNC_PROTOCOL_PRESENT = true
ASYNC_PROVIDER_PERMISSION = true
A2_FIX_TYPO_OFF = supported
A2_TOP100_REQUEST_SHAPE = supported
DURABLE_ASYNC_JOB = supported
RAW_BEFORE_NORMALIZE = true
FILE_EXPORT = supported
PACKAGE_CAPABILITY_PREFLIGHT = PASS

M4Q_R2_BRIDGE_PREFLIGHT_R1_HOLD = SUPERSEDED_BY_R2
PREFERRED_PROVIDER_MODE = DEFERRED_ASYNC
```

## 8. Provider release boundary

This correction does not claim that a paid provider request has already been executed.

The safe sequence is:

1. create the 45-query durable async job with `start` — local/non-provider action;
2. read back job/status and confirm all 45 items are PENDING with the accepted parameters;
3. fresh-check the official tariff immediately before paid submission;
4. issue bounded explicit `submitN` slices until all 45 have accepted Operation IDs or a real stop condition occurs;
5. wait at least the documented/minimum deferred interval before collection;
6. issue explicit bounded `collectN` slices, preserving raw operation results before normalization;
7. reconcile all 45 terminal states;
8. export complete durable evidence pages;
9. only then release M4Q R2 Pass B visibility-matrix synthesis.

No synchronous Search acquisition is needed for this M4Q R2 batch unless deferred execution later encounters a separately documented blocker.
