# Octoport SEO — M4Q R2 deferred Search acquisition start release R1

Date: 2026-09-23  
Status: **RELEASED — EXACTLY ONE LOCAL ASYNC START / ZERO PROVIDER CALLS**  
Repository: `MaksimUnimax/runtime-fixtures`  
Branch: `seo/wordstat-batch-01-2026-09-16`

## 1. Purpose

Create the durable local Yandex Search async job for the already accepted M4Q R2 Pass A2 execution set.

This release authorizes only local job creation.

It does **not** authorize provider submit, collection, export, retry, synchronous Search, Wordstat, GenSearch or Alice.

## 2. Authorities

Current accepted query authority:

- `M4Q_R2_PASS_A2_MAIN_CHAT_ACCEPTANCE_2026-09-23.md`
- `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/M4Q_R2_SEARCH_EXECUTION_MANIFEST_R2.tsv`
- execution manifest Git blob: `d82fef9ec9bc3d757dc85b771f6c114b92c0cd1a`

Current Bridge authority:

- Yandex Marketing Bridge production version: `0.1.9`
- production branch: `hotfix/ymb-file-delivery-p0-2026-09-14`
- production commit: `b218afb0187bd26af1d7ada3590b02edc2d4a2de`
- owner-supplied ZIP SHA-256: `de4425a47645d537ef7b69994ef2df0f66c3e9bd6741b0b47884426bdd954c4c`
- current package protocol: `SEARCH_ASYNC_BATCH_API_V1`

Current historical execution precedent:

- Octoport M3 accepted deferred lifecycle: `start -> submitN -> collectN -> exportPage`
- KW-002 Step06 grouped queue precedent: one 20-item durable async job under YMB 0.1.9, all 20 submitted, all 20 collected, final exact export persisted.

The earlier historical 1.1.6 Search-overlay capability conclusion is superseded and is not execution authority.

## 3. Query-level release contract

Pass A2 independently accepted exactly 45 execution rows.

Every execution query has exact M3 and/or M2R query authority and its own:

- exact query text;
- source authority/provenance;
- information-gain question;
- downstream decision;
- why existing evidence is insufficient;
- stop interpretation;
- provider-limit PASS;
- batch identity.

Therefore this grouped local start does not replace query-level admission. It materializes the already accepted 45 individual query contracts as 45 independently persisted async items.

```text
EXECUTION_QUERIES = 45
M3_ONLY = 8
M2R_ONLY = 30
M3_AND_M2R = 7
PURE_M4C_ONLY = 0
SYNTHETIC = 0
EXACT_DUPLICATES = 0
```

## 4. Frozen execution unit

```text
BATCH_ID = M4Q-R2-B001
JOB_ID = octoport-m4q-r2-b001-20260923
QUERY_COUNT = 45
TRANSPORT = SEARCH_ASYNC_BATCH_API_V1
MAX_REQUESTS = 45
CONFIRM_BILLABLE = true
```

Queries remain in accepted manifest order:

01. `chatgpt для ozon`
02. `chatgpt для wildberries`
03. `анализ ниш wildberries для продавца`
04. `аналитика маркетплейсов для селлеров`
05. `аналитика рекламы маркетплейсов`
06. `ии агент для wildberries`
07. `ии агент для озон`
08. `ии агенты для маркетплейсов`
09. `как заполнить карточку товара wildberries`
10. `как работать в кабинете wildberries продавцу`
11. `какой ии выбрать для маркетплейсов`
12. `отчеты для селлеров маркетплейсов`
13. `подключить chatgpt к маркетплейсу`
14. `поисковые запросы wildberries для продавца`
15. `помощник селлера маркетплейсов`
16. `chatgpt для маркетплейсов`
17. `аналитика запросов маркетплейсов`
18. `аналитика карточек маркетплейсов`
19. `аналитика маркетплейсов`
20. `аналитика продаж на маркетплейсах`
21. `аналитика рекламы wildberries`
22. `внутренняя аналитика маркетплейсов`
23. `дрр ozon`
24. `дрр wildberries`
25. `загрузка отчетов с маркетплейсов`
26. `ии ассистент для маркетплейсов`
27. `ии для аналитики маркетплейсов`
28. `ии помощник селлера`
29. `как работать в кабинете wildberries`
30. `лучшие сервисы аналитики маркетплейсов`
31. `маржинальность на маркетплейсах`
32. `отчет маркетплейса вайлдберриз`
33. `отчет маркетплейса озон`
34. `отчет о списаниях маркетплейс`
35. `отчеты маркетплейсов`
36. `отчеты продаж маркетплейсов`
37. `подключить ии к маркетплейсу`
38. `поисковые запросы wildberries`
39. `прибыль на маркетплейсах`
40. `расчет прибыли на маркетплейсе`
41. `расширение для аналитики маркетплейсов`
42. `сервис аналитики маркетплейсов`
43. `финансовая аналитика маркетплейсов`
44. `чистая прибыль на маркетплейсе`
45. `юнит экономика маркетплейсов`

## 5. Search parameters

Use exactly:

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
```

The current YMB 0.1.9 async path builds deferred provider requests through the accepted ordinary Search request builder and preserves one item per exact query.

## 6. Cost bound

Current deferred day tariff authority used by the accepted preflight:

```text
0.0305 RUB / Search submit
45 * 0.0305 = 1.3725 RUB
```

For the frozen local job:

```text
maxCostRub = 1.3725
```

This is a job ceiling, not permission to submit.

The official tariff must be freshly rechecked again immediately before the first paid `submitN`.

## 7. Exactly one released action

Released now:

```text
action = start
jobId = octoport-m4q-r2-b001-20260923
```

Expected accepted pattern, based on the same production protocol:

```text
request_executed = false
provider_calls = 0
progress.total = 45
progress.counts.PENDING = 45
requests_started = 0
operations_accepted = 0
polls_started = 0
revision = 0
```

These are expectations only. The actual returned `SEARCH_ASYNC_BATCH_RESULT_V1` is authority.

## 7A. Exact released command

The only executable Bridge command released by this authority is:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"start","jobId":"octoport-m4q-r2-b001-20260923","queries":["chatgpt для ozon","chatgpt для wildberries","анализ ниш wildberries для продавца","аналитика маркетплейсов для селлеров","аналитика рекламы маркетплейсов","ии агент для wildberries","ии агент для озон","ии агенты для маркетплейсов","как заполнить карточку товара wildberries","как работать в кабинете wildberries продавцу","какой ии выбрать для маркетплейсов","отчеты для селлеров маркетплейсов","подключить chatgpt к маркетплейсу","поисковые запросы wildberries для продавца","помощник селлера маркетплейсов","chatgpt для маркетплейсов","аналитика запросов маркетплейсов","аналитика карточек маркетплейсов","аналитика маркетплейсов","аналитика продаж на маркетплейсах","аналитика рекламы wildberries","внутренняя аналитика маркетплейсов","дрр ozon","дрр wildberries","загрузка отчетов с маркетплейсов","ии ассистент для маркетплейсов","ии для аналитики маркетплейсов","ии помощник селлера","как работать в кабинете wildberries","лучшие сервисы аналитики маркетплейсов","маржинальность на маркетплейсах","отчет маркетплейса вайлдберриз","отчет маркетплейса озон","отчет о списаниях маркетплейс","отчеты маркетплейсов","отчеты продаж маркетплейсов","подключить ии к маркетплейсу","поисковые запросы wildberries","прибыль на маркетплейсах","расчет прибыли на маркетплейсе","расширение для аналитики маркетплейсов","сервис аналитики маркетплейсов","финансовая аналитика маркетплейсов","чистая прибыль на маркетплейсе","юнит экономика маркетплейсов"],"confirmBillable":true,"maxRequests":45,"maxCostRub":1.3725,"searchType":"SEARCH_TYPE_RU","region":"225","page":0,"groupsOnPage":100,"docsInGroup":1,"groupMode":"GROUP_MODE_FLAT","familyMode":"FAMILY_MODE_MODERATE","fixTypoMode":"FIX_TYPO_MODE_OFF","sortMode":"SORT_MODE_BY_RELEVANCE","sortOrder":"SORT_ORDER_DESC"}
```

Do not alter query order, query text, job id, budget or Search parameters when executing this release.

## 8. Not released

```text
submitN = FORBIDDEN
submitOne = FORBIDDEN
collectN = FORBIDDEN
collectOne = FORBIDDEN
collectReady = FORBIDDEN
exportPage = FORBIDDEN
normalizeSaved = FORBIDDEN unless separately required by later recovery authority
synchronous SEARCH_API_V1 search = FORBIDDEN
Wordstat = FORBIDDEN
GenSearch = FORBIDDEN
retry / second start = FORBIDDEN
Pass B = BLOCKED
M5 = PAUSED
M7 = BLOCKED
```

## 9. Post-start gate

After the owner executes the released local start through the installed YMB `Яндекс` action:

```text
receive complete SEARCH_ASYNC_BATCH_RESULT_V1
-> persist exact start envelope
-> remote readback
-> reconcile job_id / total / PENDING / revision / provider_calls
-> verify all 45 exact queries are represented by the durable job
-> fresh-check official deferred tariff
-> only then publish a separate bounded submitN release
```

If the actual start result differs materially, preserve exact truth and stop. Do not recreate the job or infer success.

## 10. Current cursor

```text
M4Q_R2_PASS_A2 = ACCEPTED
M4Q_R2_ASYNC_START_RELEASE_R1 = RELEASED
DURABLE_ASYNC_JOB_VERIFIED = false

LOCAL_STARTS_ALLOWED_NOW = 1
PROVIDER_SUBMITS_ALLOWED_NOW = 0
PROVIDER_COLLECTIONS_ALLOWED_NOW = 0
LOCAL_EXPORTS_ALLOWED_NOW = 0

NEXT = EXECUTE EXACTLY ONE LOCAL start -> RETURN ACTUAL SEARCH_ASYNC_BATCH_RESULT_V1
```
