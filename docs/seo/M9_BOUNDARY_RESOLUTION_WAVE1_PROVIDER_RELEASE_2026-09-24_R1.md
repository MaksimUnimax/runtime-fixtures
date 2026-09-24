# Octoport SEO — M9 boundary-resolution Wave-1 provider release — 2026-09-24 R1

Status: **RELEASED FOR LOCAL START ONLY / PROVIDER SUBMIT STILL CLOSED**
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream accepted authority:
- `docs/seo/M9_BOUNDARY_RESOLUTION_PREACQ_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`
- `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/M9BR_WAVE1_QUERY_MANIFEST.tsv`
- `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/M9BR_PROVIDER_RELEASE_PLAN.tsv`

## 1. Exact release unit

```text
JOB_ID = octoport-m9br-wave1-20260924-r1
QUERY_COUNT = 25
MAX_REQUESTS = 25
MAX_COST_RUB = 0.7625
MODE = DEFERRED_ASYNC
PROVIDER = Yandex Search API
BRIDGE_PROTOCOL = SEARCH_ASYNC_BATCH_API_V1
FIRST_AUTHORIZED_ACTION = start
START_PROVIDER_CALLS_EXPECTED = 0
SUBMITN = CLOSED UNTIL START RESULT PERSISTED + READ BACK
```

The 25-query ceiling is not a target invented here. Pre-acquisition accepted 44 releasable exact candidates; deterministic ranking selected the first 25 and deferred 19.

## 2. Fresh official provider check

Checked 2026-09-24 immediately before release:

- pricing: https://aistudio.yandex.ru/ru/docs/search-api/pricing
- quotas/limits: https://aistudio.yandex.ru/ru/docs/search-api/concepts/limits
- deferred text-search operation: https://aistudio.yandex.ru/ru/docs/search-api/operations/web-search

Current provider facts used by this release:

```text
DAY_DEFERRED = 30.5 RUB / 1000 = 0.0305 RUB/request
NIGHT_DEFERRED = 25.41 RUB / 1000 = 0.02541 RUB/request
NIGHT_WINDOW = 00:00:00..07:59:59 UTC+3

RELEASE_COST_CEILING =
25 * 0.0305 = 0.7625 RUB

DEFERRED_REQUESTS_PER_HOUR = 35000
DEFERRED_REQUESTS_PER_SECOND = 10
DEFERRED_RESULT_GETS_PER_SECOND = 10

MAX_RESULTS = 250
MAX_QUERY_LENGTH = 400 characters
MAX_QUERY_WORDS = 40
MIN_DEFERRED_PROCESSING = 5 minutes
MAX_DEFERRED_RESULT_RETENTION = 12 hours
```

The higher daytime unit price is used as the release ceiling even if execution later occurs in the night window.

## 3. Current Bridge capability check

Owner-designated current package remains Yandex Marketing Bridge 0.1.9.

Exact source identity re-read for this release:

```text
REPOSITORY = MaksimUnimax/Yandex_direct
COMMIT = b218afb0187bd26af1d7ada3590b02edc2d4a2de
MANIFEST_VERSION = 0.1.9
PRODUCT_VERSION = 0.1.9
```

Revalidated source facts:
- `SEARCH_ASYNC_BATCH_API_V1` is present;
- deferred submit endpoint = `POST https://searchapi.api.cloud.yandex.net/v2/web/searchAsync`;
- collection endpoint = `GET https://operation.api.cloud.yandex.net/operations/{operation_id}`;
- `MAX_ITEMS = 1500`;
- `MAX_SLICE = 25`;
- `MIN_FIRST_POLL_MS = 5 minutes`;
- no deferred Autorun path;
- no background polling;
- no automatic replay/retry;
- unknown request outcome fails closed;
- raw result is persisted before normalization;
- export is paged;
- normalizer maximum results = 250;
- provider transport is enabled from manifest Operation API permission;
- manifest 0.1.9 contains both Search API and Operation API host permissions.

The browser connector was not connected during this source preflight, so no separate live browser introspection claim is made. The already owner-designated current 0.1.9 package/source is the capability authority. The first authorized `start` is local-only; its returned result must prove the actual runtime accepted this protocol with `provider_calls=0` before any paid `submitN`.

## 4. Frozen request context

Every query in this release uses:

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
responseFormat = FORMAT_XML  [Bridge-enforced]
```

`l10n=LOCALIZATION_RU`, `maxPassages=4`, and XML output are explicit/default transport details from the current 0.1.9 SearchProtocol; they do not change the accepted query wording or create new semantic logic.

## 5. Exact Wave-1 queries

| # | boundary_query_id | semantic_identity_id | exact query | class | material HOLD degree | anchor HOLD degree |
|---:|---|---|---|---|---:|---:|
| 1 | `M9BRQ_001_f326261dec0f180d` | `M8SID_f326261dec0f180d` | аналитика показателей продавца | `NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND` | 60 | 9 |
| 2 | `M9BRQ_002_78187c521b37867e` | `M8SID_78187c521b37867e` | отчеты маркетплейсов примеры | `DEMAND_OR_TESTED_EXACT_QUERY` | 46 | 9 |
| 3 | `M9BRQ_003_8850a7f387c57a62` | `M8SID_8850a7f387c57a62` | отчет для селлеров | `DEMAND_OR_TESTED_EXACT_QUERY` | 46 | 9 |
| 4 | `M9BRQ_004_e10faa73a1384257` | `M8SID_e10faa73a1384257` | отчеты для селлеров | `DEMAND_OR_TESTED_EXACT_QUERY` | 46 | 9 |
| 5 | `M9BRQ_005_8332eb45850054b1` | `M8SID_8332eb45850054b1` | ии аналитика маркетплейсов | `DEMAND_OR_TESTED_EXACT_QUERY` | 41 | 9 |
| 6 | `M9BRQ_006_c4d7f4ca514dc5fd` | `M8SID_c4d7f4ca514dc5fd` | ии анализ продаж маркетплейсов | `DEMAND_OR_TESTED_EXACT_QUERY` | 41 | 9 |
| 7 | `M9BRQ_007_e008cf0c1b28b363` | `M8SID_e008cf0c1b28b363` | аналитика маркетплейсов с ии | `DEMAND_OR_TESTED_EXACT_QUERY` | 41 | 9 |
| 8 | `M9BRQ_008_171a63d986f4ed26` | `M8SID_171a63d986f4ed26` | финансовые отчеты маркетплейсов | `DEMAND_OR_TESTED_EXACT_QUERY` | 30 | 6 |
| 9 | `M9BRQ_009_3bf57790dda15865` | `M8SID_3bf57790dda15865` | Сверка отчетов с Wildberries | `NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND` | 36 | 5 |
| 10 | `M9BRQ_010_7c23963a6f4bc9db` | `M8SID_7c23963a6f4bc9db` | Сверка отчетов с Ozon | `NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND` | 19 | 5 |
| 11 | `M9BRQ_011_15cbb2efd88933f0` | `M8SID_15cbb2efd88933f0` | плагин аналитики маркетплейсов | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 12 | `M9BRQ_012_17638a451bed5dec` | `M8SID_17638a451bed5dec` | сервис внутренней аналитики маркетплейсов | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 13 | `M9BRQ_013_3b92dfcc2a1d077e` | `M8SID_3b92dfcc2a1d077e` | сервис аналитика продаж на маркетплейсах | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 14 | `M9BRQ_014_3e26a6dc912542f5` | `M8SID_3e26a6dc912542f5` | бесплатный сервис аналитики маркетплейсов | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 15 | `M9BRQ_015_4d97378705ba844a` | `M8SID_4d97378705ba844a` | плагин аналитика маркетплейсов | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 16 | `M9BRQ_016_4ffce42718223241` | `M8SID_4ffce42718223241` | расширение аналитика маркетплейсов | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 17 | `M9BRQ_017_50ea99098ca3f75a` | `M8SID_50ea99098ca3f75a` | бесплатная аналитика маркетплейсов расширение | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 18 | `M9BRQ_018_6abd740c63a2528a` | `M8SID_6abd740c63a2528a` | аналитика маркетплейсов сервис | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 19 | `M9BRQ_019_6eb6592464294694` | `M8SID_6eb6592464294694` | сервис для аналитики продаж на маркетплейсах | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 20 | `M9BRQ_020_f1b688e71eecda16` | `M8SID_f1b688e71eecda16` | программы аналитика маркетплейсов | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 21 | `M9BRQ_021_f56a9426dbf7f0a2` | `M8SID_f56a9426dbf7f0a2` | сервис аналитика маркетплейсов бесплатно | `DEMAND_OR_TESTED_EXACT_QUERY` | 25 | 4 |
| 22 | `M9BRQ_022_3ac8d30877f874f9` | `M8SID_3ac8d30877f874f9` | сервисы аналитики маркетплейсов топ | `DEMAND_OR_TESTED_EXACT_QUERY` | 21 | 3 |
| 23 | `M9BRQ_023_41128f837d61e865` | `M8SID_41128f837d61e865` | аналитика маркетплейсов сервисы анализа | `DEMAND_OR_TESTED_EXACT_QUERY` | 21 | 3 |
| 24 | `M9BRQ_024_9ebe0f620e9744e6` | `M8SID_9ebe0f620e9744e6` | аналитика маркетплейсов лучшие сервисы | `DEMAND_OR_TESTED_EXACT_QUERY` | 21 | 3 |
| 25 | `M9BRQ_025_ad9d528ae20638a6` | `M8SID_ad9d528ae20638a6` | сервис аналитики на маркетплейсах отзывы | `DEMAND_OR_TESTED_EXACT_QUERY` | 21 | 3 |

Hard invariants:

```text
QUERY_COUNT = 25
QUERY_REPHRASE = 0
DUPLICATE_QUERY_TEXT = 0
EXISTING_CURRENT_SEARCH_DUPLICATE = 0
PROVIDER_LIMIT_VIOLATION = 0
PAGE_TITLE_OR_SOURCE_PHRASE_RELEASED = 0
AMBIGUOUS_QUERY_FORM_RELEASED = 0
```

## 6. Outcome contract

For each exact query:

SUCCESS_WITH_RESULTS:
- persist the exact RU225 Top100 snapshot;
- accept it only after durable export/readback;
- later rebuild the Search-anchor map;
- later rerun all 5,356 M9 pairs and clusters.

VALID_ZERO:
- means only no result in this exact request/context/snapshot;
- does not mean zero demand, irrelevance, exclusion, or split;
- stays HOLD by default unless another accepted evidence class resolves it.

TECHNICAL / UNKNOWN / INCOMPLETE:
- semantic effect = NONE;
- no replacement wording;
- no blind resubmit;
- preserve operation/error state and reconcile first.

## 7. Lifecycle fence

```text
release readback
-> start
-> require request_executed=false
-> require provider_calls=0
-> require 25/25 PENDING
-> persist/readback start result
-> fresh tariff check again immediately before paid submitN
-> bounded submitN
-> persist/readback accepted operation IDs
-> wait >= provider minimum
-> bounded collectN only for due accepted operations
-> persist raw operation evidence
-> normalize/export complete evidence
-> remote readback
-> rerun complete M9 universe
```

No `submitN`, `collectN`, retry, alternate wording, or M10A action is authorized by this release artifact yet.

## 8. Exact first command frozen by this release

`SEARCH_ASYNC_BATCH_API_V1 {"action":"start","jobId":"octoport-m9br-wave1-20260924-r1","queries":["аналитика показателей продавца","отчеты маркетплейсов примеры","отчет для селлеров","отчеты для селлеров","ии аналитика маркетплейсов","ии анализ продаж маркетплейсов","аналитика маркетплейсов с ии","финансовые отчеты маркетплейсов","Сверка отчетов с Wildberries","Сверка отчетов с Ozon","плагин аналитики маркетплейсов","сервис внутренней аналитики маркетплейсов","сервис аналитика продаж на маркетплейсах","бесплатный сервис аналитики маркетплейсов","плагин аналитика маркетплейсов","расширение аналитика маркетплейсов","бесплатная аналитика маркетплейсов расширение","аналитика маркетплейсов сервис","сервис для аналитики продаж на маркетплейсах","программы аналитика маркетплейсов","сервис аналитика маркетплейсов бесплатно","сервисы аналитики маркетплейсов топ","аналитика маркетплейсов сервисы анализа","аналитика маркетплейсов лучшие сервисы","сервис аналитики на маркетплейсах отзывы"],"confirmBillable":true,"maxRequests":25,"maxCostRub":0.7625,"searchType":"SEARCH_TYPE_RU","region":"225","page":0,"groupsOnPage":100,"docsInGroup":1,"groupMode":"GROUP_MODE_FLAT","familyMode":"FAMILY_MODE_MODERATE","fixTypoMode":"FIX_TYPO_MODE_OFF","sortMode":"SORT_MODE_BY_RELEVANCE","sortOrder":"SORT_ORDER_DESC","l10n":"LOCALIZATION_RU","maxPassages":4}`

Expected result:
- `action=start`;
- `ok=true`;
- `request_executed=false`;
- `provider_calls=0`;
- `total=25`;
- `PENDING=25`;
- `requests_started=0`;
- `operations_accepted=0`;
- `polls_started=0`;
- `unresolved=25`;
- `revision=0`.

Any mismatch => stop before provider submit.
