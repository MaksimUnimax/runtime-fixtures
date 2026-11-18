# Native Harness test stand

This is the real `dsh web` application and native agent loop from **@deepseek-ai/dsh 0.2.2-rc.1**. It has the official frontend, independent persisted Sessions, the official DeepSeek Messages adapter, and the official MCP client. There is no custom latest-message provider or substitute chat UI.

It is a private single-operator test stand. Product accounts, guest access, multi-tenant isolation and a wallet are deliberately not implemented in this step. Keep the standard native launch-token authentication and share its entry URL privately.

## Launch contract

The operator installs the pinned runtime and Python dependencies and supplies these environment variables to the lab service:

```sh
HARNESS_NODE_MODULES=/opt/octoport-harness-api/runtime/node_modules
HARNESS_LAB_HOME=/var/lib/harness-native-lab/dsh
HARNESS_LAB_WORKSPACE=/srv/harness-native-lab
HARNESS_LAB_GATEWAY_URL=http://127.0.0.1:18442
HARNESS_LAB_GATEWAY_KEY_FILE=/run/credentials/harness-native-lab.service/gateway.key
HARNESS_LAB_CONNECTORS_FILE=/run/credentials/harness-native-lab.service/connectors.json
HARNESS_LAB_MCP_PYTHON=/opt/harness-native-lab/venv/bin/python
HARNESS_LAB_PORT=18440
HARNESS_LAB_PUBLIC_URL=https://LAB_HOST:18443
```

`HARNESS_LAB_MCP_SERVER` defaults to the sibling `../mcp/server.py`; `HARNESS_LAB_MCP_STATE_DIR` defaults to `$HARNESS_LAB_HOME/mcp-state`. Both credential files must be private regular files, mode 0600 or stricter. Protected systemd `LoadCredential` files may instead be 0440: the launcher accepts that permission only for an immediate child of the service's actual `CREDENTIALS_DIRECTORY` under `/run/credentials/`, with no symlinks, world access or group write. It forwards that directory path to the MCP child as `HARNESS_LAB_CREDENTIALS_DIRECTORY`; no credential value is copied into the profile. The key in the Host is the **virtual gateway credential**, not the real DeepSeek key. The launcher does not overwrite `HOME`; run under the dedicated service user.

```sh
node /absolute/release/harness-lab/native/launch.mjs --prepare-only
node /absolute/release/harness-lab/native/launch.mjs
```

Preparation creates a named `native-lab` profile with the installed base and web bundles. The supported CLI resolves these shipped bundles from its own installation; it needs neither a second npm install nor a copied runtime inside the profile. Custom plugin imports explicitly resolve against `HARNESS_NODE_MODULES`.

The underlying command is `node <runtime>/@deepseek-ai/dsh/lib/bin.js --profile native-lab --host 127.0.0.1 --port 18440 --no-open`, plus `--public-url` and the exact `--trusted-host` when configured. Native state stays under the lab's separate `DSH_HOME`; launching twice over the same home is not supported.

The signed native entry URL is captured into `$HARNESS_LAB_HOME/private/entry-url.txt`, mode 0600. The wrapper redacts query tokens from stdout/stderr. Do not commit that URL, cookies, connector config, real business results or runtime state. An HTTPS reverse proxy to the HTTP loopback listener must preserve `Host` and WebSocket upgrades and add `Secure` to native cookies; the rc.1 listener does not infer TLS from forwarded headers. The public origin has no path prefix in this stand.

## Actual model and tool flow

- Default: `deepseek-official / deepseek-flash / off`, output cap 4096.
- One automatic analysis step: `deepseek-official / deepseek-v4-pro / high`, cap 8192.
- Native provider `thinking: enabled` permits both choices. A global `disabled` policy would prevent promotion.
- Explicit catalog and custom `baseURL` target the loopback Messages gateway. There is no paid discovery/classifier request. The actual gateway upstream must accept the configured model IDs; the catalog itself does not prove availability.
- Native model retries are bounded at zero; tool calls use a 90-second deadline. The loop is capped at eight steps **per turn**, with one parallel tool at a time. The native loop resets its step counter for each turn.
- Paid automatic title generation is disabled; native fallback titles remain. Native compaction is retained and can make a model call when context needs reduction.

The assistant chooses MCP through normal native function calling. The persona distinguishes **a need for live/private data or an action** from ordinary explanation. It does not route every marketplace word to MCP. The small stable tools are `mcp__business__lab_capabilities`, `mcp__business__yandex_collect_phrases`, `mcp__business__marketplace_orders_report`, and `mcp__business__marketplace_stock_snapshot`. The stock snapshot is a current FBO/FBS and reserved-quantity view; it is not a substitute for unavailable order statistics.

The MCP process is mounted once at Host scope through the official stdio client. Initial tool registration is mandatory: the native agent loop depends on both `labMcpReady` and `labPolicy`; missing/failed MCP or policy leaves the required loop unavailable and startup fails. Normal reconnect is bounded. A missing connector is a real tool error, not a fabricated success.

### Bounded Auto, not a general intelligence router

The native `/lab-mode auto`, `/lab-mode manual`, and `/lab-mode status` commands run locally and create normal native command records, with zero LLM calls.

Auto detects a small explicit set of analysis requests (`проанализируй`, `сравни`, `сопоставь`, `проведи анализ`, `объясни причины`, `найди причину`, English analyze/compare). Ordinary input starts on Flash/off. A successful structured data result from one of the three actual business tools permits **one** Pro/high step, then Flash/off resumes. Capabilities, errors, partial data and text merely claiming success do not promote.

For a follow-up such as «Проанализируй эти данные», an earlier genuine data result may authorize the one analysis step without another API call. It must still be present unchanged in native model-visible history as a successful `tool/result` linked to its matching, permitted `tool/call`. Its model-visible content must contain the server's canonical complete data envelope. A quotation in a user message has neither of those native tool events and cannot qualify. A result replaced by compaction is not treated as still directly available by this rule. The official MCP adapter includes this canonical JSON once in model context; its additional `structuredContent` copy is execution-local and is not also sent to the model.

`agent/inbox/claimed` runs synchronously before the current step's model is captured. `tools/result` runs before the next step. In `agent/pre-step`, the current choice is already captured: when it is the one permitted Pro/high step, the plugin sets the **next unprepared step** back to Flash without changing that captured request. It also resets on native idle status after failures. A `session/event` observer must not recursively append a model selection. `agent/request` caps output controls while preserving model/provider/effort. No request or proxy wire is silently rewritten.

Manual mode survives restart through the native storage domain. A genuine native model-selection event also disables Auto. **Selecting an identical already selected model may be a native no-op**, so guaranteed manual override is `/lab-mode manual` followed by the normal model/reasoning picker. `/lab-mode auto` re-enables the explicit policy. The policy is not an optimal semantic classifier, does not guarantee that an expensive model is correct, and does not automatically escalate general difficult questions lacking the defined data evidence.

## Native API for integration verification

`native-rpc.mjs` is a test helper for the genuine rc.1 protocol. Import it on a trusted machine, read the private entry URL without printing it, and authenticate against `http://127.0.0.1:18440`. It exchanges the launch token through native `GET /connect?token=...&interactions=none`, accepts the native 302 redirect with an API cookie, retains that cookie in memory and calls native RPCs. This API peer flow sends no browser `Origin` header; use the exact Host authority configured for the Host, including when testing a loopback connection behind its public proxy. The browser UI instead opens the private root launch URL and receives its browser cookie through a 303 redirect to `./`.

```js
const client = new NativeRpc('http://127.0.0.1:18440');
await client.authenticate(privateEntryURL);
const { sessionId } = await client.create({ cwd: '/srv/harness-native-lab', agentPreset: 'lab-assistant' });
await client.call('commands/execute', { agentId: sessionId, line: '/lab-mode auto', submittedAttachments: [] });
await client.prompt(sessionId, 'Запомни: контрольный цвет — янтарный.');
await client.wait(sessionId);
await client.prompt(sessionId, 'Какой контрольный цвет я назвал?');
const outcome = await client.wait(sessionId);
const events = await client.events(sessionId);
```

The raw call is `POST /api/session/create`, with `{type:'client-request',rpcId,method:'session/create',payload:{args:{request:{...}}}}`. The response is a `server-response` with matching `rpcId` and `result:{ok,value|error}`. Prompt uses a fresh request ID; repeating the same request ID is idempotent at native prompt admission. `session/events` requires `request.address:{kind:'session',sessionId}` and returns a page whose `records` are `{type:'event',event:{type,seq,time,data,...}}`. `session/wait` distinguishes idle, input-required and timeout; acceptance alone is not completion. API tests run slash commands through `commands/execute` as shown; passing a slash-command string to `session/prompt` is still a model-facing prompt. The native chat composer already uses the command endpoint for recognized commands.

Before paid verification, validate boot, `session/modelCatalog` and the selected preset. Then test ordinary two-turn memory, a second isolated chat, a real MCP result, an analysis follow-up, manual selection, and restart/history restoration. Inspect the **native request/header** events and actual gateway records to prove model/effort/usage; a UI label alone is insufficient. Save real output and credentials outside the public source repository.

## Tests and boundaries

```sh
node --test /absolute/release/harness-lab/native/test/*.test.mjs
```

Pure contract tests cover Unicode intent, trusted evidence, visible-history checks, new-session/restored mode semantics, and composition. Tests requiring `HARNESS_NODE_MODULES` are explicitly skipped when the exact installed runtime is unavailable. Root-owned isolated full boot and paid browser/API acceptance must be reported separately; this source package does not itself prove production multi-user readiness.

The controlled preset has no shell, file editor, arbitrary package installation, profile-editing tool or arbitrary external MCP configuration. Native chat, session navigation, questions, model picker and compaction remain. This configuration is for a trusted private operator; it does not turn native owner access into a public multi-user service.
