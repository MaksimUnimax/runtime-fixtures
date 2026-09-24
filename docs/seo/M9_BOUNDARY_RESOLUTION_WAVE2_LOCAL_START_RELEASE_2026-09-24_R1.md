# Octoport SEO — M9 boundary-resolution Wave-2 local-start release — 2026-09-24 R1

Status: **LOCAL START RELEASED / PROVIDER SUBMISSION CLOSED**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

Binding exact query manifest:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_QUERY_MANIFEST_2026-09-24_R1.tsv`

Pre-acquisition authority:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_PREACQ_2026-09-24_R1.md`

## Frozen local job

```text
JOB_ID = octoport-m9br-wave2-20260924-r1
QUERY_COUNT = 18
MAX_REQUESTS = 18
MAX_COST_RUB = 0.549

SEARCH_TYPE = SEARCH_TYPE_RU
REGION = 225
PAGE = 0
GROUPS_ON_PAGE = 100
DOCS_IN_GROUP = 1
GROUP_MODE = GROUP_MODE_FLAT
FAMILY_MODE = FAMILY_MODE_MODERATE
FIX_TYPO_MODE = FIX_TYPO_MODE_OFF
SORT_MODE = SORT_MODE_BY_RELEVANCE
SORT_ORDER = SORT_ORDER_DESC
LOCALIZATION = LOCALIZATION_RU
MAX_PASSAGES = 4
```

The ordered exact query texts are the 18 rows of the binding TSV manifest. No rephrasing, omission, addition, reorder, or duplicate is authorized.

## Provider preflight

Fresh official Yandex documentation was checked immediately before this release.

```text
DAY_DEFERRED_UNIT_COST_RUB = 0.0305
WAVE2_MAX_PROVIDER_SUBMITS = 18
WAVE2_MAX_COST_RUB = 0.549

DEFERRED_QUOTA_PER_HOUR = 35000
DEFERRED_LIMIT_PER_SECOND = 10
RESULT_GET_LIMIT_PER_SECOND = 10
MAX_QUERY_CHARS = 400
MAX_QUERY_WORDS = 40
MIN_DEFERRED_PROCESSING = 5 minutes
MAX_DEFERRED_RESULT_RETENTION = 12 hours
```

Sources:
- https://aistudio.yandex.ru/ru/docs/search-api/pricing
- https://aistudio.yandex.ru/ru/docs/search-api/concepts/limits
- https://aistudio.yandex.ru/ru/docs/search-api/operations/web-search

## Bridge authority

```text
YMB_VERSION = 0.1.9
SOURCE_REPOSITORY = MaksimUnimax/Yandex_direct
SOURCE_COMMIT = b218afb0187bd26af1d7ada3590b02edc2d4a2de
PROTOCOL = SEARCH_ASYNC_BATCH_API_V1
MAX_ITEMS = 1500
MAX_SLICE = 25
MIN_FIRST_POLL_MS = 300000
```

Wave-1 completed successfully on this exact protocol surface.

## Allowed action boundary

This release allows creation of the local Wave-2 job with the frozen parameters and 18 exact manifest queries.

Expected local-start result:

```text
REQUEST_EXECUTED = false
PROVIDER_CALLS = 0
TOTAL = 18
PENDING = 18
REQUESTS_STARTED = 0
OPERATIONS_ACCEPTED = 0
POLLS_STARTED = 0
UNRESOLVED = 18
REVISION = 0
```

Paid provider submission is **closed**.

Any provider-backed submit requires:
1. a successful local-start receipt;
2. durable receipt/readback;
3. a new fresh official tariff check;
4. a separate paid-submit release.

No blind retry.
M10A remains blocked.
