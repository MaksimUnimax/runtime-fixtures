# Octoport SEO — M6 Wordstat ABC batch start release R1

Date: 2026-09-23
Status: **EXACTLY ONE LOCAL WORDSTAT BATCH START RELEASED**
Parent acceptance:
`docs/seo/M6_PRE_ACQUISITION_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`

Job ID:
`octoport-m6-wordstat-abc-r1-20260923`

## Frozen provider candidates

```text
M6PC001
phrase = ABC-анализ товаров на OZON
method = WORDSTAT_GET_TOP
region = 225
devices = DEVICE_ALL
numPhrases = 200

M6PC002
phrase = Как сделать ABC-анализ на Wildberries
method = WORDSTAT_GET_TOP
region = 225
devices = DEVICE_ALL
numPhrases = 200
```

## Current official tariff

Verified immediately before release:

```text
GET_TOP = 20 RUB / 1000
UNIT_COST_RUB = 0.02
MAX_REQUESTS = 2
MAX_COST_RUB = 0.04
```

Current YMB default Wordstat policy cost also equals 0.02 RUB/getTop.

## Exactly one released action

```text
WORDSTAT_BATCH_API_V1 {"action":"start","jobId":"octoport-m6-wordstat-abc-r1-20260923","phrases":["ABC-анализ товаров на OZON","Как сделать ABC-анализ на Wildberries"],"numPhrases":200,"regions":["225"],"devices":["DEVICE_ALL"],"maxRequests":2,"maxCostRub":0.04}
```

Expected semantics:

```text
START = LOCAL JOB CREATION ONLY
PROVIDER_CALLS = 0
REQUEST_EXECUTED = false
ITEMS = 2 PENDING
```

No `next` is released until the exact start result is persisted and remote-read back.

No search action is released by this file.
