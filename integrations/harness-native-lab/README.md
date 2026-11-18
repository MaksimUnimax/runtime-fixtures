# Native Harness + business MCP laboratory

This isolated prototype is the real **DeepSeek Harness 0.2.2-rc.1** web application and agent loop. It keeps native conversation history, multiple sessions, streaming, tool exchanges and the normal model picker. It is not the older custom `integrations/harness-api` UI.

## What is implemented

- `native/`: a controlled native preset, official DeepSeek Messages provider and MCP client, and a small model-selection policy plugin.
- `mcp/`: real stdio MCP tools for the allowed Ozon connection and Yandex Wordstat GetTop; no second LLM hidden in the tools.
- `gateway/`: a loopback Messages proxy which holds the real DeepSeek credential and journals actual terminal usage. The Host receives only a virtual gateway credential.
- `deploy/`: an isolated service deployment for the authorized laboratory server. Existing application services remain separate.

The initial policy uses **Flash/off** for conversation and tool selection. An explicit request to analyze successfully returned business data permits **one Pro/high step**. A follow-up can analyze the actual previous native tool result without fetching it again. Subsequent steps return to Flash. A manual model choice overrides Auto.

This is a private **single-operator, text-only** test stand. Product registration, public guest access, tenant isolation, wallets and payments are future work. Native launch-token access is not a replacement for that product authorization. The private entry URL must never be committed.

## Try in the native chat

On first use, accept the native preview notice, select **Choose workspace**, and choose `/srv/harness-native-lab` in the official directory dialog. This laboratory uses a private operator account. The future customer product must bind its workspace automatically and enforce filesystem isolation; the native directory picker is not a tenant boundary.

1. `В общих чертах объясни разницу FBO и FBS без данных моего магазина.` — ordinary model answer; no business API is needed.
2. `Покажи текущие остатки моего магазина: отдельно FBO и FBS, отдельно резерв.` — native tool call to real MCP, followed by an answer grounded in the returned data.
3. `Проанализируй эти данные: какие выводы можно и нельзя сделать по одному снимку?` — one Pro/high analysis of existing evidence.
4. Ask a normal unrelated question. The private full-agent preset has no marketplace-only topic restriction.
5. Create another chat, switch back and continue the previous conversation.

Native commands `/lab-mode status`, `/lab-mode auto` and `/lab-mode manual` do not call the model. For a guaranteed manual override use `/lab-mode manual`, then the normal model/reasoning picker. API verification must use the native commands endpoint rather than submitting these strings as ordinary prompts.

## Tools and actual qualification

| Tool | Purpose | Current qualification |
| --- | --- | --- |
| `lab_capabilities` | List configured capabilities and their status | Implemented; configuration is not represented as a successful connectivity test |
| `marketplace_stock_snapshot` | Current Ozon FBO/FBS and separate reserves | Real complete response, cache hit, and actual native-agent-to-MCP dialogue verified |
| `marketplace_orders_report` | Ozon orders for a validated date range | Implemented; one real provider attempt returned HTTP 429, so live successful reporting is not claimed |
| `yandex_collect_phrases` | Wordstat GetTop phrases and associations | Contract implemented from `MaksimUnimax/Yandex_direct`; required server API key/folder are not configured |

The official Wordstat documentation currently warns that statistics after **7 October 2026** are unavailable. A successful API response is not proof of current data. Missing connections and provider errors are explicit failures; no sample numbers are substituted.

The lab reuses an existing qualified Ozon handler from an immutable server release. Extracting the permitted matrix/handlers into an independent product is still required. The dependency is explicit; no old Alisa voice interface or account system is used.

## Verification performed on 18 November 2026

- 30 MCP regression tests, with the actual native core present: PASS.
- 6 pure native policy tests: PASS.
- 2 tests on the exact installed Harness runtime and generated RPC codecs: PASS. These use a fixture model, not a paid provider, and are reported separately from live tests.
- 5 gateway black-box tests: PASS, covering concurrent admission, allowed payload surfaces, wire preservation, no replay and incomplete SSE usage.
- Real paid DeepSeek dialogue: memory after service restart, ordinary explanations with no MCP, an unrelated creative request, Ozon stock tool + answer, one Pro/high analysis reusing the data, and an honest Wordstat connection error.

Actual business values, full transcripts, usage receipts with private context, tokens and credentials are retained outside the public repository. Monetary amounts are conservative estimates from actual usage and a dated tariff/FX snapshot; they are not provider invoices or client wallet debits. Unknown usage remains unknown.

See [native operation and limitations](native/README.md) and [MCP contracts](mcp/README.md). Do not turn this single-owner lab into a public shared Host by exposing its launch token or bypassing the native origin/session checks.
