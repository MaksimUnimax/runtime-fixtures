# Octoport Harness gateway

The browser uses the existing Alisa account login at `https://alisa.octoport.ru/harness/`. The Python gateway listens only on `127.0.0.1:18131`; the actual DeepSeek Harness engine listens on `127.0.0.1:18132`. The gateway authenticates `__Host-alisa_session` through the installed platform account code and enforces the exact site Origin on writes. Browser payloads cannot choose an actor or tenant.

The engine calls `/internal/harness/query` with a server credential and a request binding previously admitted through the authenticated UI. The request retains its original login token in memory. A duplicate from another login cannot replace it. Worker execution rechecks that specific login, account and store rights, including on the HTTP I/O thread immediately before dispatch. Explicit status/read/clarify requests use the current authenticated login and the original runtime guard, so a completed result or pending clarification can reopen after restart without replaying a provider request.

## Existing modules reused

`ALISA_CORE_ROOT` points to the installed Alisa release. `ALISA_PLATFORM_SOURCE` points to the deployed platform release containing `services/platform/src`. Django uses the existing platform environment and database. The gateway imports `RuntimeAuthority`, `RuntimePort`, template catalogue, selector protocol, source qualification, transports, parameter report RPCs, source decoders and native arithmetic. The independent gateway process replaces only its in-memory final answer hook. It never edits the installed Alisa runtime files.

The original `catalog_prefix_v2` serialization and `tenant_v1` selector isolation remain unchanged. Only the selector calls DeepSeek. Native scalar/formula arithmetic, event grouping, complete dataset joins and projections, registered parameter arithmetic and deterministic summaries feed the dedicated chat renderers. Scalar answers contain one store/date heading and concise metrics. Datasets use a registered summary or an eight-row preview, with a separate details view and authenticated full-result download; the details view shows up to 100 table rows. Unknown values, incomplete enrichment, financial date basis and estimated-profit qualifications remain explicit. Multi-store totals use the native expression compiler and currency/source checks; percentages are recomputed from source operands. There is no final answer model, speech synthesis, speech recognition or voice pagination in the active chat path.

The internal result includes `presentation` with schema `octoport-chat-presentation/v1`, `summary`, `details` and `report_urls` (`id`, `label`, `url`). Its `text` is exactly `summary`. The actual Harness engine persists that object with the particular job and assistant message; history does not substitute another turn's result. Existing historical messages keep their recorded text.

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
| `developer_principals` | `/etc/octoport-harness/developer-principals.json` |

The engine loads the same original DeepSeek key under its own `deepseek.key` credential name and the shared `bridge.key`. Dynamic store credentials are fetched from the original vault after current scope checks. The `ozon`/`wb` credentials preserve existing qualified legacy mappings; they do not grant an account access to those stores.

Nginx forwards only `/harness/` to the gateway. `/harness/login` uses a fixed short-lived return marker and redirects to the ordinary `/login`; the corresponding exact `/app` nginx handling returns that login to `/harness/`. The marker is navigation state, never authentication. The internal query endpoint stays loopback-only.

## Account scope and developer meter

The gateway deliberately reuses the deployed Octoport account/session and store-ownership authority. It does not create a separate login database. Every engine operation receives the current authenticated `actor_id` and `tenant_id`; chat ownership, jobs, account plugin defaults and chat plugin overrides are separately scoped by that pair. Business execution additionally binds active selected stores and rechecks their authority before dispatch and before returning a result. An ordinary account owner role is not developer authorization.

The root-owned private developer policy has exactly this structure; real principal IDs are provisioned outside Git:

```json
{"schema":"octoport-developer-principals/v1","principals":[{"actor_id":"<canonical customer UUID>","tenant_id":"<canonical tenant UUID>","permissions":["developer_meter"]}]}
```

`DeveloperAccess` reads `$CREDENTIALS_DIRECTORY/developer_principals` on each request, with an optional explicit `OCTOPORT_DEVELOPER_PRINCIPALS` path for controlled deployments/tests. Files must be regular, owned by root or the service UID, not group/other writable and not symlinks. Missing or malformed policies grant nothing. With systemd credentials, a policy change takes effect when the service reloads its credential by restarting. There is no automatic first-user, tenant-owner, email/name or browser-flag grant. `developer_meter_all` is a distinct dormant permission; all current meter routes still require `developer_meter` and use only the caller's own pair.

Public plugin routes are `GET /harness/api/plugins`, `GET /harness/api/chats/{id}/plugins` and the corresponding `POST .../plugins/{plugin_id}` with exactly `{"enabled":true|false}`. They forward trusted capabilities to the engine's plugin service. Its deterministic `plugins/parse` identifies local commands before the selected-store requirement: plugin controls can work without a store, while the business adapter still refuses empty store scopes. Browser payloads cannot inject capabilities or other owners.

`GET /harness/api/me` exposes `permissions.developer_meter`. The developer-only read routes are `/harness/api/developer/meter` and `/harness/api/developer/requests/{request_id}/meter`, delegated to the enabled `dev-meter` plugin. The gateway rechecks the policy and the engine rechecks both entitlement and plugin state. Ordinary status/history projections omit usage, costs, quotes and billing metadata. Revoked grants cannot read old developer results through the current API.

`request_meter.py` accounts for actual dispatched calls from the isolated native ledger, including failed requests. The immutable `octoport-request-meter/v1` object contains `calls`, `tokens`, `rub`, `quotes`, `attempts` and `request_id`. Missing or contradictory receipts produce unknown values (`null`), with a separate known subtotal and completeness flags. Reasoning tokens already included in completion tokens are never added twice. A local command with no model calls is a genuine zero-call result. The internal failure body can carry the same meter; repeated delivery retains it without another dispatch.

`pricing_snapshot.py` installs a validated, process-local wrapper before native dispatch receipt creation and validation. Packaged `pricing.json` records the unchanged official DeepSeek tariffs verified on 2026-11-18 and the dated CBR USD/RUB 82.4529 rate effective 2026-11-18. The installed Alisa source/settings are untouched. Native dispatch quotes record the selected rates; old quotes are never repriced with newer FX. The ruble value is an estimate from the published tariff and dated FX, not a verified invoice or actual card charge. Source URLs are recorded in each quote: [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/) and [CBR 18 November 2026](https://www.cbr.ru/currency_base/daily/?UniDbQuery.Posted=True&UniDbQuery.To=18.11.2026).

## Verification

From the project parent directory, with the actual installed core or a read-only copy:

```sh
ALISA_CORE_ROOT=/path/to/alisa/core python3 -m unittest discover -s harness-api/backend/tests -v
ALISA_CORE_ROOT=/path/to/alisa/core python3 -m unittest discover -s harness-api/tests -p 'test_*.py' -v
```

The backend suite covers cookie/Origin rejection, cross-tenant chats/stores/plugins, absent request bindings, duplicate and concurrent delivery, immutable admitted login, session revocation, failed-attempt no-replay, fixed login return, developer policy loading/revocation, ordinary-user billing redaction, local plugin controls without stores, exact native Worker/decoder integration, I/O-thread authorization, native clarification, restart reads, receipt uncertainty and immutable historical pricing. The renderer suite covers registered calculation routes, large datasets, complete joins, missing values, currency separation, native weighted totals, compact scalar comparisons, short/default versus complete/details output, parameter context pairing and event date/unknown-money semantics.

`runtime_smoke.py --core-root /path/to/alisa/core` runs an isolated native-core pipeline with synthetic account/scope and marketplace replies. It opens no production account database and creates no owner session. `--live-selector --credentials-directory /run/credentials/alice-market.service` enables at most one real selector call; every marketplace operation remains a strict fixture. Do not use this optional paid mode as an automatic health check.

Observed on 2026-11-18 with the original server key: the first selector call used 14,814 prompt tokens, 125 completion tokens, 0 cache hits and 14,814 misses. A second independently run warm-prefix check used 14,814 prompt tokens, 114 completion tokens, 14,592 cache hits and 222 misses. Both selected `B01.ordered_units`, passed a synthetic raw Ozon response through the installed decoder, returned the fixture quantity 17 directly, made zero final-model calls and dispatched no work on replay. These prove the actual selector/key/cache path and native handler integration; the quantity is test data, not a production store result.

Inside the trusted pipeline, missing or inconsistent model usage receipts return `usage: null` with `metadata.usage_complete=false`. Available partial counters remain explicitly marked; they never become a claimed zero-cost call and never prevent an otherwise valid handler answer. Ordinary public users receive none of these accounting fields.
