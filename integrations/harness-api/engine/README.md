# Octoport Harness API engine

This service runs the real `@deepseek-ai/dsh` **0.2.2-rc.1** agent loop and JSONL session persistence. It mounts the `octoport-templates` provider (`alisa-matrix` model) and a real Cordis service for scoped feature plugins. The default `matrix` plugin executes the existing Alisa selector/template/handler pipeline exactly once for ordinary questions. Recognized plugin commands are handled locally. Every final text is committed as a native Harness assistant response; there is no model request after the handler.

The official `deepseek-official` API-key plugin is also configured from the server credential. It is not the default conversational route. The engine exposes no API for changing providers and adds no automatic fallback that would unexpectedly spend tokens.

## Runtime

Node.js 24 or later is required. Install the exact dependency in this directory with `npm install --omit=dev`, or set `HARNESS_NODE_MODULES` to an existing `node_modules` tree containing the pinned Harness installation. The service verifies the installed Harness version at startup.

`node server.mjs` listens only on `127.0.0.1:18132` by default.

| Setting | Default |
|---|---|
| `HARNESS_NODE_MODULES` | Resolve dependencies beside this package |
| `OCTOPORT_ENGINE_PORT` | `18132` |
| `OCTOPORT_ENGINE_STATE` | `/var/lib/octoport-harness/engine` |
| `OCTOPORT_PIPELINE_URL` | `http://127.0.0.1:18131/internal/harness/query` |
| `OCTOPORT_BRIDGE_KEY_FILE` | `/etc/octoport-harness/bridge.key` |
| `DEEPSEEK_KEY_FILE` | `/var/lib/alice-lab/secrets/deepseek.key` |
| `OCTOPORT_PLUGINS_DIRECTORY` | `engine/plugins/installed/` in the trusted release |

When systemd supplies `CREDENTIALS_DIRECTORY`, the files named `bridge.key` and `deepseek.key` there take precedence. Credentials never appear in API responses, persisted chats, or generated requests to the template selector. The DeepSeek key remains in the Harness credential resolution context; the adapter receives only a separate loopback service credential.

Only one engine process may own one state directory. Run it under a single systemd unit. The Harness persistence layer enforces session write ownership; horizontal instances require distinct state directories and a coordinated ownership store.

## Gateway contract

All POST endpoints require `Authorization: Bearer <bridge credential>`. The gateway must derive `actor_id`, `tenant_id` and optional `capabilities` from the authenticated Alisa session and its explicit developer allowlist. Browser input is never an authority for those fields. `capabilities: ["developer_meter"]` is required for the developer meter; absence means no developer permissions.

| Endpoint | Body | Response |
|---|---|---|
| `POST /v1/chats/create` | `actor_id`, `tenant_id` | `chat_id`, `session_id`, `title`, `created_at` |
| `POST /v1/chats/list` | `actor_id`, `tenant_id` | `chats` |
| `POST /v1/chats/history` | Owner fields, `chat_id` | `messages` |
| `POST /v1/chats/send` | Owner fields, `chat_id`, `request_id`, `text` | HTTP 202; `job_id`, `accepted`, `chat_id` |
| `POST /v1/jobs/status` | Owner fields, `job_id` | `finished`, `state`, `message`, `assistant_message_id`, `messages`, `text`, `error`, `usage`, `metadata` |
| `POST /v1/chats/cancel` | Owner fields, `chat_id` | `ok`, `canceled` |
| `POST /v1/plugins/list` | Owner/capability fields, optional `chat_id` | Scoped permitted plugin inventory |
| `POST /v1/plugins/set` | Owner/capability fields, `scope`, optional `chat_id`, `plugin_id`, `enabled` | Saved scoped selection and inventory |
| `POST /v1/plugins/parse` | Owner/capability fields, optional `chat_id`, `text` | `handled`, `kind`; no execution |
| `POST /v1/plugins/call` | Owner/capability fields, optional `chat_id`, `plugin_id`, `action`, `arguments` | Registered plugin action data |
| `GET /health` | — | Runtime version, provider, active job count, credential presence |

`message` is the exact native assistant `{id, role, text}` committed for this
job, or `null` before a response is committed. Its ID persists across restarts.
The `messages` field is full current conversation history; a later completed
turn may already appear there when polling an older job. Render `message` or
the job's `text` as its receipt; do not choose the latest assistant from history.
Structured `presentation` is also retained for that exact response and its history
message. Ordinary responses expose `usage: null` and public metadata only. A
permitted, enabled developer meter exposes actual telemetry. Developer action
text is redacted if the caller no longer has the required capability.

See [PLUGINS.md](PLUGINS.md) for module registration, commands, multiuser scope,
cost accounting and the distinction between installing, enabling and invoking.

`session_id` equals `chat_id`, an engine-generated UUID. The gateway installs its authorized request binding **before** submitting `/v1/chats/send`. An internal adapter call receives:

```json
{
  "actor_id": "authenticated customer UUID",
  "tenant_id": "authenticated tenant UUID",
  "session_id": "engine-generated chat UUID",
  "request_id": "gateway request ID",
  "text": "original user text"
}
```

The adapter must revalidate the current user session and store access. Its response is:

```json
{
  "text": "exact final handler text",
  "usage": {
    "prompt_tokens": 1000,
    "prompt_cache_hit_tokens": 900,
    "prompt_cache_miss_tokens": 100,
    "completion_tokens": 25
  },
  "metadata": {
    "template_ids": ["example"],
    "selector_calls": 1,
    "answer_calls": 0
  }
}
```

`usage` may be `null` when a usage receipt is unavailable; local manager commands explicitly record zero usage. Do not infer zero cost from a missing receipt or estimate usage from answer text. The engine maps uncached and cached input to separate Harness counters and refuses inconsistent totals. A trusted failed internal response may also include a canonical `meter` matching its exact request ID; that receipt is retained without retry and remains developer-only.

The template adapter uses the loop's model-hidden `sessionId` and the durable human message ID to retrieve its server-owned request binding. Injected context, model text, tool arguments, and title/compaction requests cannot select another actor or run the business pipeline.

The default pipeline deadline is 600 seconds. The browser polls jobs; it does not hold a 600-second chat POST open. Transport failures and interrupted jobs are not automatically dispatched again. Duplicate request IDs with the same chat and text return the original job; a different payload under an existing request ID is rejected.

## Verification

Run `node --test tests/*.test.mjs`. The integration tests require the pinned Harness dependency. A passing release run must show **zero skipped tests**. Tests cover native Harness sessions and persistence, symlink entrypoint startup/shutdown, exact handler text, restart restoration, deduplication, actor/tenant isolation, cancellation, service authorization, auxiliary-call rejection, cache-token accounting, real Cordis registration/disposal, scoped plugin activation, immutable request feature snapshots, developer revocation and failure-meter preservation. Test pipelines are local fixtures; they make no marketplace or paid model calls.
