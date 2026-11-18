# Native Harness lab: real read-only MCP tools

This is an **isolated single-owner laboratory connector**, not SaaS account authorization. The native Harness agent calls the official MCP protocol over stdio. This process performs one bounded provider request per business tool call and returns structured facts. It does not call DeepSeek, a selector, or an answer model. The native Harness agent owns the conversation and final answer.

## Proven source and current limitations

The phrase collector was identified from **MaksimUnimax/Yandex_direct**, commit `08989e4d34db20bfd9f43d5becf90ab1d2e2fbff`, specifically `extension/src/shared/wordstat_protocol.js` and the credential/worker contract. The two other repositories named `bridgeService` and `BridgeSmall` are Business Bridge products and are not the source of this tool.

The bridge's actual `getTop` operation is `POST https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests`, with `phrase`, `numPhrases`, `regions`, `devices`, and the trusted credential's `folderId`. Cloud authorization is `Authorization: Api-Key ...`. This adapter reimplements that narrow, documented wire contract; it does not run the browser extension, pretend to use a nonexistent bridge HTTP service, or substitute the old OAuth Wordstat API.

**Provider freshness limitation, checked 2026-11-18:** official Yandex documentation says Wordstat API statistics after **2026-10-07 are unavailable**, although methods continue to respond. Successful phrase responses include that warning. `as_of` means acquisition time, not the date of the underlying statistics. GetTop gives bounded results and associations, not a complete semantic core or sales forecast. The documented RUB estimate is 20 RUB / 1,000 GetTop calls, or 0.02 RUB per call; it is not an invoice.

The Ozon tools use the existing Alisa **scalar matrix request builder, real source qualification, and response decoder** for `ozon_orders` and `ozon_stocks`. It does not use Alisa Django, portal sessions, Query records, the old worker, or its model selector. It returns two source metrics, ordered units and order revenue, after the native decoder reconciles row sums with provider totals. Order revenue is not payout or profit. This lab still depends on the installed matrix modules and their protected source configuration. A future independent product must extract/package the reviewed matrix and authorization contract; this lab does not claim that extraction is complete.

No Yandex key is bundled. An unconfigured tool returns `CONNECTOR_DISABLED` with `isError=true`; it never fabricates phrases or frequencies. Real provider keys, real marketplace results, runtime state, owner URLs, and private configuration must stay outside Git.

## Tools and output

| Tool | Model arguments | Provider work |
| --- | --- | --- |
| `lab_capabilities` | none | None. Reports configured connector status, counts and safe setup guidance. |
| `yandex_collect_phrases` | `phrase` 1–400 chars; `limit` 1–50 (20); numeric-string `regions` 1–5 (`["225"]`); `device` all/desktop/phone/tablet | At most one Cloud Wordstat GetTop request. Six-hour exact-request cache. |
| `marketplace_orders_report` | `date_from`, `date_to` as `YYYY-MM-DD`, inclusive completed 1–31 day period in Moscow time | At most one Ozon `/v1/analytics/data` request. Fifteen-minute exact-request cache. |
| `marketplace_stock_snapshot` | none | At most one qualified Ozon `/v4/product/info/stocks` request. Current FBO/FBS present/reserved units and validated product count. Two-minute cache. |

All schemas set `additionalProperties:false`. Credentials, account IDs, store IDs, URLs, HTTP headers, arbitrary methods, and file paths are absent from model-facing arguments. A private server configuration determines the fixed connector scope. Capabilities distinguish `enabled`/`configuration_status` from a successful connection: `connection_checked:false` is explicit, and enabling a connector never claims that its key or source qualification works.

Successful data uses MCP `structuredContent`:

```json
{
  "schema": "harness-lab-tool-result/v1",
  "kind": "data",
  "data": {"provider-specific closed projection": "..."},
  "source": {"provider": "...", "operation": "...", "url": "fixed reviewed HTTPS URL"},
  "as_of": "2026-11-18T00:00:00Z",
  "complete": true,
  "cache": {"hit": false, "acquired_at": "2026-11-18T00:00:00Z", "ttl_seconds": 900},
  "execution": {"provider_requests_this_call": 1, "automatic_retry": false}
}
```

The example is a schema illustration, not a provider result. Phrase data fields: `seed`, `total_count`, `phrases:[{phrase,count}]`, `associations:[{phrase,count}]`, `regions`, `device`, `coverage`, `statistics_available_through`, `warnings`, `provider_price_estimate`. Report fields: `report`, `period`, `ordered_units`, `ordered_revenue` (decimal string), `currency` (nullable), `source_rows`, `basis`, `warnings`.

The stock snapshot uses its own native qualified source, with positive unique product identities and `total`/`total_items`/cursor reconciliation. A partial first page produces `INCOMPLETE_DATA`; the tool does not sum a partial inventory or silently fetch further pages. It accepts no historical date. Present and reserved values stay separate; reserve is not subtracted again. The native decoder already supports the official total→total_items transition announced for 2026-11-23.

`complete:true` means the bounded declared source operation passed its completeness checks. It does not claim that GetTop is every possible search phrase. Empty, genuinely returned data remains empty. Unknown currency is `null`, never assumed RUB. Errors use `isError:true`, `kind:error`, `complete:false`, and `error:{code,message,outcome_unknown,retry_after_seconds?}`. Provider error bodies and exception details are not reflected into the model or logs. A bounded error-body parser may expose only a numeric or fixed-enum `provider_code` and fixed `provider_reason` such as `RATE_LIMIT_PER_SECOND`; no provider message is echoed.

## Private configuration and stdio launch

Install the pinned SDK dependencies in the **lab's own** virtual environment:

```bash
python3 -m venv /srv/harness-native-lab/venv
/srv/harness-native-lab/venv/bin/pip install -r /srv/harness-native-lab/source/mcp/requirements.txt
```

The checked-in example disables both connectors. An operator can create this private JSON file (mode `0600`, or trusted systemd credential mode `0400`/`0440`) outside the source checkout:

```json
{
  "schema": "harness-lab-connectors/v1",
  "scope_id": "single-owner-lab",
  "revision": "v1",
  "yandex": {"enabled": false},
  "ozon": {
    "enabled": true,
    "credential_file": "/run/credentials/harness-native-lab.service/ozon.json",
    "max_daily_requests": 50,
    "core_root": "/srv/reviewed-matrix-source",
    "native_runtime_file": "/run/credentials/harness-native-lab.service/market-runtime.json",
    "native_store_id": "operator-selected-existing-lab-store"
  }
}
```

`native_store_id` must select exactly one existing store in an active native lab account; it is never supplied by the agent. The existing source proof must match the imported registry and scalar matrix hashes. No synthetic proof may be used for a real call. The private Ozon credential JSON uses the existing `seller_client_id` and `seller_api_key` fields. Extra performance fields may exist, but this tool neither reads their values into output nor calls those APIs.

To configure Yandex, set `yandex` to `{"enabled":true,"credential_file":"/private/yandex.json","max_daily_requests":20}`. Its private JSON must contain `api_key` and `folder_id`. Do not paste either into a chat. Each service retains its own credential; no reuse of Yandex Direct/Webmaster OAuth is implied.

Native MCP client configuration:

```json
{
  "transport": "stdio",
  "serverName": "business",
  "command": "/srv/harness-native-lab/venv/bin/python",
  "args": ["/srv/harness-native-lab/source/mcp/server.py"],
  "cwd": "/srv/harness-native-lab/source/mcp",
  "env": {
    "HARNESS_LAB_CONNECTORS_FILE": "/run/credentials/harness-native-lab.service/connectors.json",
    "HARNESS_LAB_CREDENTIALS_DIRECTORY": "/run/credentials/harness-native-lab.service",
    "HARNESS_LAB_STATE_DIR": "/var/lib/harness-native-lab/mcp"
  },
  "toolCallTimeoutMs": 90000,
  "failOnStartupError": true
}
```

The launcher supplies `HARNESS_LAB_CREDENTIALS_DIRECTORY` (or `CREDENTIALS_DIRECTORY`) only from the trusted unit environment. Readonly 0440 credentials are accepted only within that directory, which must have no group write or world access. Symlinks, writable credential files and world-readable files remain rejected. Files outside this directory retain the strict private-mode requirement.

Mount once at the native Host. The child process has no public listener. Host access is the lab's separate owner boundary. This process is not a multiuser MCP service and is not safe to share across unrelated product users. Logs go to stderr; stdout is exclusively SDK protocol traffic.

## Dispatch, cache and revocation

Private configuration, connector enablement, credential availability, native account activity, and source qualification are rechecked **before a cache result can be returned**. Updating a private config revision changes the request fingerprint. The owner must increment `revision` when rotating/reassigning credentials. Systemd credential files are snapshots: changing their source requires the normal service credential reload/restart. There is no claim of immediate propagation through an already mounted systemd credential snapshot.

The private SQLite ledger reserves a dispatch before HTTP. A process crash or network timeout leaves its outcome unknown; the same fingerprint is not automatically replayed, including after restart. An operator must inspect such outcomes before deliberately changing its revision/resetting a lab run. No transparent retry, pagination, fallback API, or hidden batch is implemented.

The operator-configured `max_daily_requests` is a cap over a **rolling 24 hours**, not a lifetime limit. Every dispatch counts conservatively, including failures. Budget errors return `retry_after_seconds`. The orders tool requires at least 61 seconds since the last Ozon connector dispatch; the stock tool requires at least two seconds. Both share the explicit lab daily connector budget. Identical successful requests can use their cache immediately. This local ledger cannot coordinate Ozon quota consumed by other production processes or manual clients; an upstream 429 remains an honest error. Calls do not wait in long hidden queues. The provider itself remains authoritative for account-wide quota.

HTTP permits only the three fixed HTTPS endpoints, validates certificates, ignores proxy environment variables, follows no redirects, has a 30-second timeout and a 2 MB response cap. Closed response projections omit raw envelopes, headers, cabinet identity and credentials. The private state directory must be mode `0700`; its database is mode `0600`.

## Verification and what has actually run

From the repository containing `harness-lab`:

```bash
HARNESS_TEST_CORE_ROOT=/absolute/reviewed-matrix-source \
python -m unittest discover -s harness-lab/mcp/tests -v
```

The focused suite runs **30 tests**: native scalar request/decoder with explicitly synthetic provider responses, row/totals mismatch, qualification drift, inactive account, unknown currency, date bounds, model scope/URL injection, private file modes, trusted readonly systemd 0440 credentials and rejection outside that mount, revocation before cache, cross-owner cache separation, restart cache, durable timeout non-replay, daily budget renewal, rate limits, closed projection, secret omission and honest connection status, stock source qualification, stock identity/total/completeness validation, separate reserves, stock cache, and safe provider error classification. It also runs an actual subprocess MCP SDK initialize/discover/call cycle and checks structured genuine `CONNECTOR_DISABLED` errors and safe rejection of credential-like extra parameters.

Observed locally on 2026-11-18: **30/30 PASS**, official MCP Python SDK `1.29.0`, HTTPX `0.28.1`. These tests made **zero real provider or model calls**. They are not evidence of a successful production credential/API request. Real end-to-end reports must be recorded separately as private lab evidence by the deployment/test owner. A separately authorized stock adapter smoke on 2026-11-18 succeeded with a complete native-validated response, exactly one provider HTTP request, and a second application call served from cache. Its business data and evidence stay private. This establishes the connector path, not by itself the native-agent-to-MCP conversation path. The earlier orders smoke returned HTTP 429 and is not represented as a successful report.

## Primary references, checked 2026-11-18

- Exact Bridge code: https://github.com/MaksimUnimax/Yandex_direct/blob/08989e4d34db20bfd9f43d5becf90ab1d2e2fbff/extension/src/shared/wordstat_protocol.js
- Bridge source status: https://github.com/MaksimUnimax/Yandex_direct/blob/08989e4d34db20bfd9f43d5becf90ab1d2e2fbff/extension/docs/CURRENT_STATE.md
- Cloud GetTop contract: https://aistudio.yandex.ru/ru/docs/search-api/api-ref/Wordstat/getTop
- Current freshness limitation: https://aistudio.yandex.ru/ru/docs/search-api/concepts/wordstat
- Cloud credential/setup example: https://aistudio.yandex.ru/ru/docs/search-api/operations/wordstat-gettop
- Wordstat pricing: https://aistudio.yandex.ru/ru/docs/search-api/pricing
- Ozon published analytics quota change: https://dev.ozon.ru/news/797-Izmenenie-limitov-na-metod-v1-analytics-data/
- Official Python MCP SDK: https://github.com/modelcontextprotocol/python-sdk

- Official stock read method: https://dev.ozon.ru/start/299-Rekomendatsii-po-upravleniiu-ostatkami-v-Seller-API/
- Official total_items transition: https://dev.ozon.ru/news/801-Otkaz-ot-polia-total-v-metodakh-Seller-API/
