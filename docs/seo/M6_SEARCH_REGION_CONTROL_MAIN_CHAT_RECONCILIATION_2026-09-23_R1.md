# Octoport SEO — M6 regional Search controls Main Chat reconciliation R1

Date: 2026-09-23
Status: **PROVIDER EXPORT ACCEPTED / R04 NO_MATERIAL_CHANGE / R06 ENRICH / NO FURTHER REGION SEARCH AUTHORIZED**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
START_HEAD: `4c8b32d741dd5d5b83f64889ddc76da28d070831`

Parent authorities:
- `docs/seo/M6_PRE_ACQUISITION_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`
- `docs/seo/M6_WORDSTAT_PROVIDER_RECONCILIATION_2026-09-23_R1.md`
- `docs/seo/M6_SEARCH_REGION_CONTROL_COMPARISON_PLAN_2026-09-23_R1.md`
- `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md`
- accepted M3/M4A region-225 baseline authority.

## 1. Full export identity / persistence QA

Owner-returned export file:

`search-octoport-m6-search-region-controls-r1-20260923-r10-0-1.json`

Durable GitHub path:

`docs/seo/work/M6_PENDING_PROVIDER_RAW/search-octoport-m6-search-region-controls-r1-20260923-r10-0-1.json`

Exact source identity:

```text
SOURCE_BYTES = 159213
SOURCE_SHA256 = c16b495be7033a3c6e5f6543f17e4f467a9e163d434d3bad717904803fc9483d
TERMINAL_NEWLINE = present
```

Remote readback after correcting the initially omitted trailing newline:

```text
GITHUB_BLOB_SHA = 55e98f4b46edbb8a74db846553f3f74dd97d068e
GITHUB_UTF8_BYTES = 159213
GITHUB_SHA256 = c16b495be7033a3c6e5f6543f17e4f467a9e163d434d3bad717904803fc9483d
BYTE_IDENTITY = PASS
```

The first write was one trailing newline short. It was corrected before semantic acceptance. The corrected remote bytes now match the uploaded source SHA-256 exactly.

## 2. Export structural QA

```text
schema = YMB_SEARCH_ASYNC_EXPORT_PAGE_V1
job_id = octoport-m6-search-region-controls-r1-20260923
revision = 10
total_items = 2

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

job.PENDING = 0
job.WAITING = 0
job.SUCCEEDED = 2
job.PARSE_FAILED = 0
job.FAILED = 0
job.UNKNOWN = 0
requests_started = 2
operations_accepted = 2
polls_started = 2
all_successful = true
unresolved = 0

page.item_count = 2
page.result_row_count = 40
page.items_with_raw = 2
page.items_with_normalized = 2
page.states.SUCCEEDED = 2
page.has_more = false
page.all_job_items_in_this_file = true
```

Both normalized result sets have:
- result_count = 20;
- document_count = 20;
- ranks 1..20;
- usable_for_url_comparison = true;
- missing_url_ranks = [];
- unsafe_url_ranks = [].

## 3. Query / operation mapping recovered

The submit envelope exposed only the second operation ID. The full export resolves the complete durable mapping:

```text
M6PC006 / R04
query = аналитика маркетплейсов для селлеров
operation_id = sprj11c022m8ikb58it2
state = SUCCEEDED
result_count = 20

M6PC008 / R06
query = помощник селлера маркетплейсов
operation_id = spregqnga31l4fm29b3b
state = SUCCEEDED
result_count = 20
```

No operation identity was guessed.

## 4. Export receipt boundary

The current owner message delivered the actual JSON attachment but did not include a separate inline `SEARCH_ASYNC_BATCH_RESULT_V1 action=exportPage` receipt.

Therefore:

```text
FULL_EXPORT_FILE = PRESENT / ACCEPTED
EXPORT_FILE_BYTE_IDENTITY = PASS
EXPORT_RECEIPT_INLINE = NOT_PRESENT_IN_CURRENT_MESSAGE
EXPORT_RECEIPT_REQUEST_EXECUTED_PROVIDER_CALL_FIELDS = NOT DIRECTLY OBSERVED HERE
```

This does not block semantic analysis because provider collection was already terminal and the self-contained export carries the exact job/revision/items/raw/normalized evidence. It does mean this artifact does not independently claim an observed export-receipt `provider_calls=0` field.

## 5. Frozen row-level classification authority

Main Chat classified all 40 region-213 rows under the vocabulary frozen before result analysis.

Durable rows:

`docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_CONTROL_ROWS_2026-09-23_R1.tsv`

```text
CURRENT_REGION_ROWS = 40/40
R04_ROWS = 20/20
R06_ROWS = 20/20
SAMPLING = 0
SILENT_SKIP = 0
```

Each row retains:
- rank;
- URL/domain;
- title/snippet;
- frozen class;
- exact URL overlap with accepted region-225 baseline;
- baseline rank when exact URL matches;
- whether the domain existed in baseline;
- operation ID.

## 6. R04 / M6PC006 comparison

Query:
`аналитика маркетплейсов для селлеров`

### Accepted region-225 baseline re-coded to the frozen comparison vocabulary

```text
SELLER_ANALYTICS_PRODUCT_OR_SOFTWARE = 17/20
MARKETPLACE_NATIVE_OR_HELP = 2/20
EDITORIAL_OR_EDUCATION = 1/20
SELLER_ANALYTICS_SERVICE_OR_AGENCY = 0
HUMAN_ROLE_OR_HIRING = 0
OTHER_RELEVANT = 0
AMBIGUOUS_HOLD = 0

TOP10:
PRODUCT_OR_SOFTWARE = 9/10
NATIVE_OR_HELP = 1/10
```

### Region-213 control

```text
SELLER_ANALYTICS_PRODUCT_OR_SOFTWARE = 18/20
MARKETPLACE_NATIVE_OR_HELP = 1/20
EDITORIAL_OR_EDUCATION = 1/20
SELLER_ANALYTICS_SERVICE_OR_AGENCY = 0
HUMAN_ROLE_OR_HIRING = 0
OTHER_RELEVANT = 0
AMBIGUOUS_HOLD = 0

TOP10:
PRODUCT_OR_SOFTWARE = 9/10
EDITORIAL_OR_EDUCATION = 1/10
```

### URL/domain continuity

```text
EXACT_URL_OVERLAP = 12/20
SHARED_DOMAINS = 14
BASELINE_UNIQUE_DOMAINS = 18
CURRENT_UNIQUE_DOMAINS = 20
TOP10_SHARED_DOMAINS = 4
```

Baseline-only domains:
`tbank.ru, mpfact.ru, yoolip.ai, sberbank.ru`

Current-only domains:
`insales.ru, metriclab.ru, sellermoon.ru, mpsurf.ru, mpfinassist.io, soykasoft.ru`

Rank movement is substantial for some shared URLs, but the semantic composition is not.

### R04 decision

The named regional question was whether Moscow would materially change seller-analytics product intent into human/local-service composition.

It did not:
- human-role/hiring remains 0/20;
- service/agency remains 0/20;
- 19/20 rows remain direct product/software or native/help surfaces, with one editorial result;
- the Top10 remains 9/10 product/software.

```text
M6PC006_OUTCOME = NO_MATERIAL_CHANGE
R04_REGIONAL_CONTROL = CLOSED
R04_INTENT_BOUNDARY_REOPEN = false
R04_MORE_REGION_SEARCH = NO
```

Claim boundary:
rank/domain churn is observed, but no causal claim that region alone produced any individual movement is made.

## 7. R06 / M6PC008 comparison

Query:
`помощник селлера маркетплейсов`

### Accepted region-225 baseline re-coded to frozen vocabulary

```text
SOFTWARE_OR_AI_HELPER = 15/20
SERVICE_OR_AGENCY_HELP = 2/20
HUMAN_ASSISTANT_OR_VACANCY = 1/20
EDITORIAL_OR_EDUCATION = 1/20
OTHER_RELEVANT = 1/20
MARKETPLACE_NATIVE_OR_HELP = 0
AMBIGUOUS_HOLD = 0

HUMAN_PLUS_SERVICE = 3/20 = 15%

TOP10:
SOFTWARE_OR_AI_HELPER = 7/10
SERVICE_OR_AGENCY_HELP = 2/10
OTHER_RELEVANT = 1/10
HUMAN_ASSISTANT_OR_VACANCY = 0/10

TOP3:
SOFTWARE_OR_AI_HELPER = 3/3
```

### Region-213 control

```text
SOFTWARE_OR_AI_HELPER = 14/20
SERVICE_OR_AGENCY_HELP = 3/20
HUMAN_ASSISTANT_OR_VACANCY = 3/20
EDITORIAL_OR_EDUCATION = 0
OTHER_RELEVANT = 0
MARKETPLACE_NATIVE_OR_HELP = 0
AMBIGUOUS_HOLD = 0

HUMAN_PLUS_SERVICE = 6/20 = 30%

TOP10:
SOFTWARE_OR_AI_HELPER = 6/10
SERVICE_OR_AGENCY_HELP = 2/10
HUMAN_ASSISTANT_OR_VACANCY = 2/10

TOP3:
SOFTWARE_OR_AI_HELPER = 2/3
SERVICE_OR_AGENCY_HELP = 1/3
```

### URL/domain continuity

```text
EXACT_URL_OVERLAP = 9/20
SHARED_DOMAINS = 11
BASELINE_UNIQUE_DOMAINS = 18
CURRENT_UNIQUE_DOMAINS = 17
TOP10_SHARED_DOMAINS = 6
```

Baseline-only domains:
`saintpack.ru, sellergpt.ru, sellermate.io, mpboost.pro, otvetolog.ru, rask.pro, topseller.ru`

Current-only domains:
`e-zh.ru, add-one.ru, aibandai.ru, myexport.exportcenter.ru, sellermoon.ru, stpulse.ru`

Important observed change:
human/vacancy + service surfaces rise from 3/20 to 6/20, and from 2/10 to 4/10 in the Top10.

At the same time:
- software/AI remains the largest class at 14/20;
- software/AI remains the Top10 majority at 6/10;
- the #1 result remains the same explicit AI seller-helper surface, `sally-seller.ru`.

### R06 decision

The Moscow control materially enriches the boundary: human/service collision is stronger than in the Russia-225 baseline.

However it does not reverse the accepted primary intent:
software/AI helper surfaces remain the majority overall and in Top10.

```text
M6PC008_OUTCOME = ENRICH
R06_REGIONAL_CONTROL = CLOSED
R06_INTENT_BOUNDARY_REOPEN = false
R06_REGIONAL_NUANCE = STRONGER_HUMAN_SERVICE_COLLISION
R06_MORE_REGION_SEARCH = NO
```

Downstream implication:
later Search-only semantics/copy must not treat unqualified `помощник селлера` as pure AI/software language. Explicit qualifiers such as AI/ИИ, software/service type and marketplace context remain important.

## 8. M3 regional control outcome

```text
M3_REGION_PROVIDER_CANDIDATES = 2
EXECUTED = 2/2
SUCCEEDED = 2/2
OUTCOME_UNKNOWN = 0
PARSE_FAILED = 0
RAW_EXPORT_ROWS = 40/40

M6PC006 = NO_MATERIAL_CHANGE
M6PC008 = ENRICH

REOPEN_TARGETED_GAP = 0
MORE_REGION_PROVIDER_CALLS = 0
```

This closes the two executable regional controls named by M6.

## 9. Capability holds remain untouched

Current YMB 0.1.9 still cannot execute the selected controls requiring:
- full SERP HTML: 6 rows;
- explicit mobile/userAgent: 3 rows.

These remain explicit capability HOLDs. No fake command or substitute claim was introduced.

## 10. Current M6 provider state

```text
WORDSTAT:
  M6PC001 = VALID_EMPTY_LITERAL_TOP_RESPONSE
  M6PC002 = VALID_EMPTY_LITERAL_TOP_RESPONSE
  M6PC003 = VALID_EMPTY_LITERAL_TOP_RESPONSE
  M6PC004 = HOLD_PROVIDER_INVALID_QUERY

SEARCH_REGION:
  M6PC006 = NO_MATERIAL_CHANGE
  M6PC008 = ENRICH

SEARCH_HTML_CAPABILITY_HOLD = 6
SEARCH_USERAGENT_CAPABILITY_HOLD = 3

PROVIDER_OUTCOME_UNKNOWN = 0
UNAUTHORIZED_RETRY = 0
UNAUTHORIZED_EXPANSION = 0
```

Provider acquisition for the currently executable M6 candidates is complete.

M6 is **not yet final-closed**:
- M1 pre-M7 dependency remains OPEN/BLOCKING;
- owner/product-fact rows and remaining HOLD accounting still require non-provider reconciliation under existing M6 authority;
- M6PC004 remains explicit provider-invalid HOLD unless separately reopened by a new accepted information-gain release.

## 11. Next allowed work

No more Search/Wordstat provider action is released by this artifact.

Next Main Chat work:
1. reconcile the 30 `OWNER_OR_PRODUCT_FACT_REQUIRED` M6 rows against current Product Truth/owner authority;
2. classify whether any requires actual owner input versus existing durable fact;
3. reconcile remaining M6 HOLDs into blocking/non-blocking terminal states;
4. close M1 pre-M7 baseline separately;
5. only then assess M6 final closure / M7 release.

```text
M7 = BLOCKED
```
