# Harness native laboratory: 20 November 2026 recovery and acceptance record

**Status:** corrective deployment `harness-native-20261120-r3`, single-operator laboratory only, no public SaaS account/auth.

## Reproduced failure

The actual browser Session events for `session-80750780-dabb-4bc4-9dd5-5cbf09b32f18` show a 20 November user message "скажи продажи за вчреа на озон". The native Flash/off model incorrectly inferred the current date was 13 October 2026 and called `mcp__business__marketplace_orders_report` with 12 October instead of 19 November. The Ozon `/v1/analytics/data` API returned HTTP 429, provider code 8, reason `RATE_LIMIT_PER_SECOND`. The subsequent user "еще раз запрашивай" asked for the same *incorrect* period. At the time, the ledger reused the first failed 429 for 900 seconds, so **two chat tool calls caused only one upstream Ozon call**. The error text's `as_of` was the tool error timestamp, not an analytics data timestamp; the prior model incorrectly treated it as suspicious clock skew.

This was **not** a DeepSeek provider outage. Four actual model attempts completed normally. Peak-price RUB quotes for the two failed user turns were ~0.03948 RUB and ~0.04235 RUB; total ~0.08183 RUB despite no sales data returned.

## Corrective architecture

- Native full conversational agent and Web UI remain native `@deepseek-ai/dsh 0.2.2-rc.1`; no alternate chat agent, generic adapter, or extra LLM classifier.
- Official `@deepseek-ai/dsh-time-context` is mounted with Moscow fallback and 30-second refresh interval. Browser-zone time context may use the browser's zone. Ozon reports never rely on the model to compute server business dates.
- MCP orders tool schema allows **either** `{"period":"yesterday"}` **or** explicit inclusive `date_from/date_to`; the business server converts `period:yesterday` to the fully completed preceding day using `Europe/Moscow`. Do not infer yesterday from model pretraining or obsolete conversation statements. For a 20 Nov Moscow request the period is **19 November 2026**.
- The Ozon endpoint `/v1/analytics/data` is rate limited to **one request per minute**, also potentially **50/day** for sellers without the relevant subscription. No 2-/5-second immediate automatic retry. Each MCP invocation performs **no more than one outgoing Ozon analytics request**; when Ozon rejects with definitive code8/429, preserve the error and impose the interval before another operator-initiated attempt. Successful reports keep 900-second cache. Distinct provider attempts count toward a durable SQLite 24h quota, including failed 429s. The previous 900-second *failed* cache was a local defect.
- A **real request for 19 November 2026 was still rejected by Ozon 429** during recovery testing; an additional earlier candidate performed wasteful quick retries and was retired. Therefore real Ozon sales remain unavailable and no values have been fabricated. External provider-side throttling or shared API-key traffic needs separate source investigation. This release fixes our handling, not Ozon's error.
- Errors/partial tool results must **not** unlock Pro/high model promotion. Only explicit user analysis intent plus successful structured actual business MCP evidence can promote one reasoning step.

## Model choice: exact current configuration

Default native model selection is **`deepseek-official / deepseek-flash / reasoningEffort=off`**. Native **Flash/off** both (a) answers general questions directly and (b) chooses whether to invoke read-only MCP (e.g., Ozon sales, Wordstat). A tool-based simple answer normally costs two model requests: choose tool, then explain tool result.

The host policy permits one **`deepseek-v4-pro / high`** model step ONLY for an explicit analytical follow-up and actual complete structured MCP data in the active/visible context. Immediately after the selected Pro step, the next step returns to Flash/off. An Ozon 429 is an error, not data; both user turns in the reproduced problem remained Flash/off.

Native commands: `/lab-mode auto`, `/lab-mode manual`, `/lab-mode status`. In Manual, choose model and reasoning via the official native picker. The Auto rule is conservative, **not** optimal difficult-query routing; a complicated general question without proven MCP evidence does not auto-escalate. Per-turn maximum eight agent steps, single tool at a time; model retries at this level are bounded.

## RUB usage beside token UI

The model gateway records terminal provider usage for every admitted model attempt and a **conservative peak USD/RUB quote**. Historical receipts retain historical currency quotations. During this update the FX for new terminal receipts changed to **81.9290 RUB/USD** (20 Nov 2026 official Central Bank rate). This is a *price estimate*, **not a provider invoice, client debit, or subscription balance**. Nonterminal/unknown attempt cost is recorded as unknown, not free.

The private loopback gateway exposes GET `/lab-meter` with aggregate totals and latest active-session quote (without transcripts, keys, private sales data). Public Nginx uses **native `auth_request` cookie validation** before proxying the read-only meter. Anonymous `/lab-meter` returns HTTP 401, authenticated native session HTTP 200. Native HTML receives `lab-meter-ui.js` on the Host page, rendering a small informational RUB usage overlay (alongside the native token statistics). The UI differentiates the **last active session** and **all lab sessions**, not the currently selected session; visual acceptance and per-current-dialog placement remain follow-ups.

At deployment verification, terminal historical quotes totaled **~0.908887 RUB** across 18 model calls and **~0.081832 RUB** for the last 24 hours / latest active session, corresponding to the two user failed turns. These are dated observations, not future or real-time invariants.

No client pays anything through this meter. Wallet/ledger/tenant billing remain future independent product modules.

## Validation

- **33 MCP tests PASS**: strict tool schemas, genuine SDK protocol, Moscow yesterday, rate-limited 429 cooldown, physical-attempt accounting, synthetic matrix and safe failure modes.
- **6 gateway tests PASS**: native Messages wire preservation, quota/concurrency, terminal-usage receipts, safety checks, RUB/session aggregation and unknown costs.
- **8 native agent tests PASS** on the exact installed harness rc.1 (set `HARNESS_NODE_MODULES=/opt/octoport-harness-api/runtime/node_modules`), including actual native model-selection hooks and tool evidence.
- Live HTTPS verification: signed owner entry creates a cookie and loads genuine native Web HTML. Native operator authentication cookie can access `/lab-meter`, unauthenticated requests cannot. Native page includes the RUB overlay script exactly once. A real browser visual check of overlay positioning is still not completed; do not mark that criterion accepted.
- 5 persisted lab sessions confirmed present after deployment, Host and gateway running.
- Ozon real sales **NOT confirmed**. The latest real attempt for 19 Nov returned provider `UPSTREAM_HTTP_429`; no fake results.

## Service deployment and rollback

Live release: `/opt/harness-native-lab/releases/harness-native-20261120-r3`.
Service units: `harness-native-lab.service`, `harness-native-model-gateway.service`, `harness-native-lab-entry.service`; Nginx named site `harness-native-lab.conf` on HTTPS port 18443. Existing Alisa production/stage services are distinct.
Pre-change systemd unit backups under `/etc/systemd/system/` with suffix `.bak-20261120-r2`, pre-meter Nginx copy under `/etc/nginx/backups/harness-native-lab.before-meter-20261120.conf`.
Do not share the native launch token or convert the private owner Host to public multiuser access without tenant authorization.
