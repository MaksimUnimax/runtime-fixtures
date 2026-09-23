# Octoport SEO — M6 regional Search controls pre-step and local-start release R1

Date: 2026-09-23
Status: **PRE-STEP PASS / EXACTLY ONE LOCAL ASYNC SEARCH BATCH START RELEASED**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
START_HEAD: `395058e75a5d858e00de0f7b144c952dd070f3e8`

Parent authorities:
- `docs/seo/M6_PRE_ACQUISITION_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`
- `docs/seo/M6_WORDSTAT_PROVIDER_RECONCILIATION_2026-09-23_R1.md`
- `docs/seo/LEVEL1/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md`
- `docs/seo/EXECUTION_RULES.md`

## 1. Live preparation

```text
LEVEL1_READ = PASS
LEVEL2_INDEX_READ = PASS
M6_LEVEL2_READ = PASS
CURRENT_M6_WORK_RETURN_READ = PASS
FAILURE_LEDGER_READ = PASS
WORDSTAT_RECONCILIATION_READ = PASS
LIVE_HEAD_VERIFIED = 395058e75a5d858e00de0f7b144c952dd070f3e8
```

The current failure ledger rule is preserved: local batch creation is not provider execution, but the local start still requires a durable per-control release before use.

## 2. Fresh provider / method verification

Official Yandex Search API documentation was rechecked on 2026-09-23.

Verified:
- text search supports deferred/asynchronous execution;
- deferred submit returns an Operation identity and later result collection uses that same operation;
- Russian search supports a region parameter;
- region `213` is Moscow;
- XML supports bounded grouped results and is the current Bridge-supported format for this lane;
- current Search API technical limit is up to 250 returned results;
- deferred result retention is bounded;
- current daytime deferred tariff for Yandex.Cloud LLC is 30.5 RUB / 1000 requests = 0.0305 RUB per submit.

Sources:
- https://aistudio.yandex.ru/ru/docs/search-api/operations/web-search
- https://aistudio.yandex.ru/ru/docs/search-api/concepts/web-search
- https://aistudio.yandex.ru/ru/docs/search-api/reference/regions
- https://aistudio.yandex.ru/ru/docs/search-api/concepts/limits
- https://aistudio.yandex.ru/en/docs/search-api/pricing

Bridge contract evidence was also rechecked from the accepted YMB 0.1.9 project history:
- prefix: `SEARCH_ASYNC_BATCH_API_V1`;
- `start` creates local durable job with zero provider calls;
- `submitN` submits bounded provider requests;
- `collectN` collects the same accepted operations;
- no blind resubmit after accepted operation;
- full export is required after terminal collection.

## 3. Frozen information-gain controls

### M6PC006 / R04

Query:
`аналитика маркетплейсов для селлеров`

Question:
does Moscow region 213 materially change the seller-product/service versus human/local-service composition relative to the accepted Russia-225 M3 Top20 enough to reopen the intent interpretation?

Frozen execution:
```text
searchType = SEARCH_TYPE_RU
region = 213
page = 0
groupsOnPage = 20
docsInGroup = 1
groupMode = GROUP_MODE_FLAT
familyMode = FAMILY_MODE_MODERATE
fixTypoMode = FIX_TYPO_MODE_OFF
sortMode = SORT_MODE_BY_RELEVANCE
sortOrder = SORT_ORDER_DESC
response = current YMB XML lane
```

Persistence target after export:
`docs/seo/work/M6_PENDING_PROVIDER_RAW/M6PC006.json`
plus exact lifecycle envelopes required to reproduce operation identity.

### M6PC008 / R06

Query:
`помощник селлера маркетплейсов`

Question:
does Moscow region 213 materially change software/AI seller-helper versus human/local-service composition relative to the accepted Russia-225 M3 Top20 enough to reopen the intent interpretation?

Execution parameters are identical to M6PC006 except query text.

Persistence target after export:
`docs/seo/work/M6_PENDING_PROVIDER_RAW/M6PC008.json`
plus exact lifecycle envelopes required to reproduce operation identity.

## 4. Depth correction applied

The Work-return numeric `requested_depth=100` conflicts with the same rows' explicit semantic contract referencing regional Top20 and with the M3 baseline under test.

Execution authority for this run is therefore:
```text
M6PC006_GROUPS_ON_PAGE = 20
M6PC008_GROUPS_ON_PAGE = 20
```

The queries, region and decision questions are unchanged.
This correction is already documented in:
`docs/seo/M6_WORDSTAT_PROVIDER_RECONCILIATION_2026-09-23_R1.md`.

## 5. Cost / request bound

Current daytime deferred submit ceiling:

```text
UNIT_SUBMIT_COST_RUB = 0.0305
MAX_PROVIDER_SUBMITS = 2
MAX_SUBMIT_COST_RUB = 0.061
```

A later `collectN` is a separate provider interaction in lifecycle/accounting terms but must collect already accepted operation IDs and must never create replacement Search operations.

Tariff must be freshly rechecked immediately before the billable `submitN`; the local `start` below makes zero provider calls.

## 6. Exact local job

Job ID:
`octoport-m6-search-region-controls-r1-20260923`

Frozen queries in order:
1. `аналитика маркетплейсов для селлеров` = M6PC006 / R04
2. `помощник селлера маркетплейсов` = M6PC008 / R06

## 7. Exactly one released action

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"start","jobId":"octoport-m6-search-region-controls-r1-20260923","queries":["аналитика маркетплейсов для селлеров","помощник селлера маркетплейсов"],"confirmBillable":true,"maxRequests":2,"maxCostRub":0.061,"searchType":"SEARCH_TYPE_RU","region":"213","page":0,"groupsOnPage":20,"docsInGroup":1,"groupMode":"GROUP_MODE_FLAT","familyMode":"FAMILY_MODE_MODERATE","fixTypoMode":"FIX_TYPO_MODE_OFF","sortMode":"SORT_MODE_BY_RELEVANCE","sortOrder":"SORT_ORDER_DESC"}
```

Expected start semantics:
```text
REQUEST_EXECUTED = false
PROVIDER_CALLS = 0
PENDING = 2
REQUESTS_STARTED = 0
OPERATIONS_ACCEPTED = 0
REVISION = 0
```

## 8. Stop / next rule

After the actual `SEARCH_ASYNC_BATCH_RESULT_V1` start envelope:
1. persist the complete start envelope in GitHub;
2. remote-readback and verify exact job/queries/parameters/state;
3. fresh tariff check;
4. only then release one bounded `submitN count=2`.

No `submitN`, `collectN`, export or replacement job is released by this file.

Capability-HOLD rows M6PC005/007/009/010/011/012/013/014/015 remain untouched.

## 9. Cursor

```text
M6_WORDSTAT = RECONCILED
M6_SEARCH_REGION_PRESTEP = PASS
M6_SEARCH_REGION_LOCAL_START = RELEASED
M6_SEARCH_REGION_PROVIDER_SUBMIT = NOT_EXECUTED
M6_SEARCH_HTML_HOLDS = 6
M6_SEARCH_USERAGENT_HOLDS = 3
M1_PRE_M7 = OPEN
M7 = BLOCKED
```
