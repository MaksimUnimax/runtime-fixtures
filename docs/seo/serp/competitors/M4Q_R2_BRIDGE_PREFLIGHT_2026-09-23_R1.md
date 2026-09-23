# Octoport SEO — M4Q R2 live Bridge capability / price preflight R1

Date: 2026-09-23  
Status: **HOLD_BRIDGE_CAPABILITY_CORRECTION_REQUIRED**  
Upstream acceptance: `M4Q_R2_PASS_A2_MAIN_CHAT_ACCEPTANCE_2026-09-23.md`

## 1. Scope

This is the mandatory read-only provider preflight after Pass A2 acceptance.

No Yandex Search provider request was executed.

```text
PASS_A2 = ACCEPTED
R2_PROVIDER_READY_EXACT_QUERIES = 45
PROVIDER_CALLS_AUTHORIZED = 0
PROVIDER_EXECUTION_ALLOWED = false
```

## 2. Current official Yandex Search API capability

Fresh official documentation checked 2026-09-23:

- REST WebSearch: https://aistudio.yandex.ru/ru/docs/search-api/api-ref/WebSearch/search
- Search query concepts: https://aistudio.yandex.ru/ru/docs/search-api/concepts/web-search
- Quotas/limits: https://aistudio.yandex.ru/ru/docs/search-api/concepts/limits
- Pricing: https://aistudio.yandex.ru/ru/docs/search-api/pricing

Current official contract confirms:

```text
SEARCH_TYPE_RU = supported
region 225 = supported
page >= 0 = supported
FIX_TYPO_MODE_OFF = supported
GROUP_MODE_FLAT = supported
groupsOnPage XML = 1..100
docsInGroup = 1..3
maximum returned results per query = 250
maximum query length = 400 chars
maximum query word count = 40
```

Therefore the Pass A2 exact-query target is supported by the provider itself.

## 3. Current official price snapshot

Fresh official pricing checked immediately during this preflight:

```text
DAY_SYNC = 488 RUB / 1000 requests = 0.488 RUB/request
DAY_DEFERRED = 30.5 RUB / 1000 requests = 0.0305 RUB/request
NIGHT_SYNC = 366 RUB / 1000 requests = 0.366 RUB/request
NIGHT_DEFERRED = 25.41 RUB / 1000 requests = 0.02541 RUB/request
NIGHT_WINDOW = 00:00:00..07:59:59 UTC+3
AUTH_OR_INTERNAL_SERVER_ERROR_BILLED = false
```

Nominal 45-query cost if one request per query:

```text
45 * DAY_SYNC = 21.96 RUB
45 * DAY_DEFERRED = 1.3725 RUB
45 * NIGHT_SYNC = 16.47 RUB
45 * NIGHT_DEFERRED = 1.14345 RUB
```

The tariff must still be rechecked immediately before any later paid provider action.

## 4. Located local Search overlay authority

Read-only filesystem inspection found the historical accepted source at:

`/root/blood_sand-product-control-plane-t2/tooling/llm-api-bridges/yandex-wordstat/r2-search-overlay/`

Historical overlay package/version authority:

```text
Wordstat base = 1.1.5
Search overlay extension build = 1.1.6
Search protocol version = 0.1.0
command prefix = YANDEX_SEARCH_API_V1
result prefix = YANDEX_SEARCH_RESULT_V1
webSearch endpoint = POST /v2/web/search
genSearch endpoint = POST /v2/gen/search
```

The historical acceptance explicitly says build/static accepted and live provider probe pending.

No later local source containing `FIX_TYPO_MODE_OFF` was found.

## 5. Capability mismatch 1 — exact-query typo mode

Pass A2 plans:

`FIX_TYPO_MODE_OFF`

Historical 1.1.6 XML WebSearch implementation hard-codes:

`FIX_TYPO_MODE_ON`

It does not expose an explicit typo-mode command parameter.

This is material because M4Q R2 executes exact observed M3/M2R wording. Provider-side autocorrection may alter the effective query and therefore cannot silently satisfy the accepted exact-query evidence contract.

Provider supports OFF; the local overlay does not currently expose it.

```text
FIX_TYPO_PROVIDER_CAPABILITY = PASS
FIX_TYPO_CURRENT_OVERLAY_CAPABILITY = FAIL_FOR_A2
```

## 6. Capability mismatch 2 — deferred mode

Pass A2 batch planning states:

`DEFERRED_PREFERRED_PENDING_CURRENT_BRIDGE_CAPABILITY_PREFLIGHT`

Historical 1.1.6 Search overlay supports synchronous:

`POST /v2/web/search`

and does not implement the deferred WebSearch lifecycle.

This does not make synchronous acquisition invalid, but it means deferred mode cannot be selected without a separate lifecycle implementation and acceptance.

Given only 45 queries, synchronous execution is economically bounded, but no mode is released by this preflight.

```text
SYNC_WEBSEARCH = AVAILABLE_IN_HISTORICAL_OVERLAY
DEFERRED_WEBSEARCH = NOT_IMPLEMENTED_IN_HISTORICAL_OVERLAY
PROVIDER_MODE_SELECTED = NONE
```

## 7. Capability mismatch 3 — Top-100 / raw evidence

Historical Search overlay acceptance was for a first-page / 10-group live probe target.

Pass A2 requires planned organic depth 100.

The historical base bridge has:

```text
MAX_RESPONSE_BYTES = 1,500,000
FETCH_TIMEOUT_MS = 30,000
one accepted command = one provider request
no automatic replay after unknown request outcome
manual operation/report persistence in chrome.storage.local
```

The provider allows XML `groupsOnPage=100`, but historical bridge evidence does not prove that a real Top-100 response plus Base64 `rawData` remains safely below the current bridge bound or can be durably returned without losing paid evidence.

No live Top-100 Search provider acceptance was found.

Therefore provider release requires an explicit raw-persistence / payload acceptance, not an assumption based only on provider schema.

## 8. Live installed-runtime identity

Remote server/browser-profile inspection:

```text
SERVER_RUNNING_BROWSER_WITH_YANDEX_BRIDGE = not found
SERVER_CHROME_PROFILE_YANDEX_SEARCH_PREFIX = not found
SERVER_CHROMIUM_PROFILE_YANDEX_SEARCH_PREFIX = not found
```

Opera Browser Connector was also unavailable at preflight time with:

`Browser not connected. Make sure to enable Allow AI connection...`

Therefore the local historical source tree must not be mislabeled as proof of the extension version currently loaded in the owner's browser.

```text
LIVE_INSTALLED_SEARCH_BRIDGE_IDENTITY = NOT_VERIFIED
```

## 9. Non-interference

The located historical `blood_sand-product-control-plane-t2` checkout is on a separate feature branch and contains unrelated uncommitted server/auth/db changes.

It was inspected read-only and was not modified.

Any Search-bridge correction must be isolated from that dirty checkout.

## 10. Preflight verdict

```text
PASS_A2_PROVIDER_MANIFEST = ACCEPTED
OFFICIAL_PROVIDER_SCHEMA = PASS
CURRENT_PRICE_SNAPSHOT = PASS

LIVE_INSTALLED_BRIDGE_IDENTITY = NOT_VERIFIED
A2_FIX_TYPO_OFF = NOT_EXPOSED_BY_HISTORICAL_OVERLAY
DEFERRED_MODE = NOT_IMPLEMENTED_BY_HISTORICAL_OVERLAY
TOP100_RAW_PERSISTENCE_ACCEPTANCE = NOT_PROVEN

M4Q_R2_BRIDGE_PREFLIGHT_R1 = HOLD_BRIDGE_CAPABILITY_CORRECTION_REQUIRED

PROVIDER_EXECUTION_ALLOWED = false
PROVIDER_CALLS_AUTHORIZED = 0
```

## 11. Next bounded unit

Prepare an isolated Search-bridge correction / acceptance unit that, before any 45-query acquisition:

1. exposes explicit WebSearch `FIX_TYPO_MODE_OFF` without changing Wordstat semantics;
2. chooses and documents the actual provider mode (synchronous is permitted only after explicit release; deferred requires its own lifecycle);
3. proves safe Top-100 raw evidence persistence/readback under the chosen request shape;
4. proves the exact package/runtime identity to be loaded;
5. runs static regression;
6. after installation/reload and a fresh price recheck, authorizes at most one bounded live probe;
7. only after successful live probe may a separate release authorize the complete 45-query acquisition.

M5 remains paused and M7 remains blocked.
