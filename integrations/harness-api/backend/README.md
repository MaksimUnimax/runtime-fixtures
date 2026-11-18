# Octoport Harness gateway

The browser uses the existing Alisa account login at `https://alisa.octoport.ru/harness/`. The Python gateway listens only on `127.0.0.1:18131`; the actual DeepSeek Harness engine listens on `127.0.0.1:18132`. The gateway authenticates `__Host-alisa_session` through the installed platform account code and enforces the exact site Origin on writes. Browser payloads cannot choose an actor or tenant.

The engine calls `/internal/harness/query` with a server credential and a request binding previously admitted through the authenticated UI. The request retains its original login token in memory. A duplicate from another login cannot replace it. Worker execution rechecks that specific login, account and store rights, including on the HTTP I/O thread immediately before dispatch. Explicit status/read/clarify requests use the current authenticated login and the original runtime guard, so a completed result or pending clarification can reopen after restart without replaying a provider request.

## Existing modules reused

`ALISA_CORE_ROOT` points to the installed Alisa release. `ALISA_PLATFORM_SOURCE` points to the deployed platform release containing `services/platform/src`. Django uses the existing platform environment and database. The gateway imports `RuntimeAuthority`, `RuntimePort`, template catalogue, selector protocol, source qualification, transports, parameter report RPCs, source decoders and native arithmetic. The independent gateway process replaces only its in-memory final answer hook. It never edits the installed Alisa runtime files.

The original `catalog_prefix_v2` serialization and `tenant_v1` selector isolation remain unchanged. Only the selector calls DeepSeek. Registered scalar/formula/event renderers, complete dataset joins and projections, registered parameter arithmetic and explicit deterministic summaries produce the final chat text. Large datasets display 100 rows and an authenticated full-result download. Multi-store totals use the native expression compiler and currency/source checks; percentages are recomputed from source operands.

Compound/economics requests create genuine owner-scoped `WEB` Query receipts with the original `remember(SessionPrincipal(...))` proof and `continuation.harness_runtime_v1`. A companion platform patch excludes these receipts from native cabinet list/read/recover/clarify/cancel paths. The receipts remain available to the original parameter RPCs. Work executes only in the separate Harness runtime queue.

## Runtime configuration

Run `gateway.py` with the existing platform Python environment and platform environment files. Keep the standard authority, stores, entitlements and parameter flags enabled, including `ALISA_OWNER_PARAMETERS_ENABLED=1` and `ALISA_OWNER_PARAMETER_COLLECTION_ENABLED=1` and the deployed compound/economics flags. `OCTOPORT_GATEWAY_STATE` defaults to `/var/lib/octoport-harness/gateway`; its directory must be owned by the service user and not group/world writable. The isolated SQLite state, encrypted source support key and report archive live there.

Use systemd credentials. Values are never placed in JavaScript, source, chat, command arguments or logs:

| Credential name | Existing file |
| --- | --- |
| `deepseek` | `/var/lib/alice-lab/secrets/deepseek.key` |
| `market_config` | `/etc/alice-market/market-runtime.json` |
| `answer_settings` | `/var/lib/alice-market/answer-settings.json` |
| `ozon` | `/etc/alice-lab/marketplaces/ozon.json` |
| `wb` | `/etc/alice-lab/marketplaces/wb.json` |
| `bridge.key` | `/etc/octoport-harness/bridge.key` |

The engine loads the same original DeepSeek key under its own `deepseek.key` credential name and the shared `bridge.key`. Dynamic store credentials are fetched from the original vault after current scope checks. The `ozon`/`wb` credentials preserve existing qualified legacy mappings; they do not grant an account access to those stores.

Nginx forwards only `/harness/` to the gateway. `/harness/login` uses a fixed short-lived return marker and redirects to the ordinary `/login`; the corresponding exact `/app` nginx handling returns that login to `/harness/`. The marker is navigation state, never authentication. The internal query endpoint stays loopback-only.

## Verification

From the project parent directory, with the actual installed core or a read-only copy:

```sh
ALISA_CORE_ROOT=/path/to/alisa/core python3 -m unittest discover -s harness-api/backend/tests -v
ALISA_CORE_ROOT=/path/to/alisa/core python3 -m unittest discover -s harness-api/tests -p 'test_*.py' -v
```

The backend suite covers cookie/Origin rejection, cross-tenant chats/stores, absent request bindings, duplicate and concurrent delivery, immutable admitted login, session revocation, failed-attempt no-replay, fixed login return, direct output/unknown monetary values, exact native Worker/decoder integration, I/O-thread authorization, native clarification, restart reads and usage receipt uncertainty. The renderer suite covers registered calculation routes, large datasets, complete joins, missing values, currency separation and native weighted totals.

`runtime_smoke.py --core-root /path/to/alisa/core` runs an isolated native-core pipeline with synthetic account/scope and marketplace replies. It opens no production account database and creates no owner session. `--live-selector --credentials-directory /run/credentials/alice-market.service` enables at most one real selector call; every marketplace operation remains a strict fixture. Do not use this optional paid mode as an automatic health check.

Observed on 2026-11-18 with the original server key: the first selector call used 14,814 prompt tokens, 125 completion tokens, 0 cache hits and 14,814 misses. A second independently run warm-prefix check used 14,814 prompt tokens, 114 completion tokens, 14,592 cache hits and 222 misses. Both selected `B01.ordered_units`, passed a synthetic raw Ozon response through the installed decoder, returned the fixture quantity 17 directly, made zero final-model calls and dispatched no work on replay. These prove the actual selector/key/cache path and native handler integration; the quantity is test data, not a production store result.

Missing or inconsistent model usage receipts return `usage: null` with `metadata.usage_complete=false`. Available partial counters remain explicitly marked in metadata; they never become a claimed zero-cost call and never prevent an otherwise valid handler answer.
