# Scoped Harness plugins

## Native runtime and multiuser boundary

The running engine is the installed `@deepseek-ai/dsh@0.2.2-rc.1` with its
`@deepseek-ai/cordis@4.1.0`. `runtime.mjs` mounts `ScopedPluginManager` through
`ctx.plugin()`. The manager extends the installed Cordis `Service` class and
provides `ctx.octoportPlugins`. Each installed module is a separate Cordis plugin;
its registration belongs to `ctx.effect()` and is removed when its fiber is
disposed. This is exercised against the actual installed runtime.

The stock `@deepseek-ai/dsh-plugin-manager` manages a profile's package files and
composition. Its installed README explicitly describes changes applying to every
session in that profile. This server keeps Host composition under deployment
control and exposes scoped feature activation to customers. It does not expose
the stock profile manager, npm installation, arbitrary module paths, a shell,
Host-owner RPC or a shared attachment store.

| Operation | What changes | Who controls it |
| --- | --- | --- |
| Install a module | Trusted release files, manifest, module SHA256; restart loads the new code | Server operator/deployment |
| Enable a feature | Account default or one chat override in scoped state | Authenticated entitled account |
| Invoke a feature | A registered action or an enabled request processor for the current turn | Authenticated entitled account |

Installation and invocation are separate. Enabling a plugin does not download
code. Installed code runs in the Host process, so the manifest is a reviewed code
registration contract, not an application sandbox.

## Built-in feature modules

| ID | Default | Purpose |
| --- | --- | --- |
| `plugin-manager` | Always on; cannot be disabled | Local inventory, scoped activation and command dispatch |
| `matrix` | Enabled | Existing Alisa selector → template → provider/API → response handler |
| `dev-meter` | Enabled for permitted developers; unavailable to other users | Read actual per-request tokens and historical ruble estimates |

The matrix is a standalone installed module, not a special case in the
dispatcher. Its processor receives only the trusted actor, tenant, session,
request ID and original question. It calls the existing internal Alisa pipeline.
The final handler text is streamed straight into the native Harness session.
The official DeepSeek API provider stays configured, but there is no automatic
general-chat or final-answer model fallback.

If no enabled processor accepts a normal question, the manager gives a local
message asking the user to enable a processor. It does not silently reactivate
the matrix or call a different model.

## Commands without a model dispatcher

These forms are deterministic and cost no model call for manager operations:

```text
плагины
покажи плагины
список плагинов
включи плагин матрица
отключи плагин matrix
включи счётчик токенов
/plugins
/plugins enable dev-meter
/plugins disable dev-meter
/plugins account enable dev-meter
/plugins account disable dev-meter
/plugin dev-meter requests
/plugin dev-meter requests {"job_id":"REQUEST_ID"}
/plugin dev-meter requests {"limit":20}
```

The meter also declares exact action aliases: `покажи расход`,
`расход последнего запроса`, `покажи расход последнего запроса`.
Aliases are read from each module manifest. Names are compared after Unicode
normalization, lowercasing, whitespace normalization and `ё`/`е` normalization.
An ambiguous name gets local help. Unknown explicit `/plugins`, `/plugin`,
`включи`, `отключи` or `выключи` control commands are not sent to the matrix.
Other natural-language questions use the ordinary enabled processor chain.

The gateway calls the side-effect-free `plugins/parse` endpoint before requiring
selected stores. A recognized control command can work when no store is
connected. The engine parses the actual durable user message again when it runs.
The business pipeline independently refuses empty store authority, so parser
classification cannot grant store access.

These commands differ from native model-selected tools. Native Harness tools
may be selected by an LLM as part of its agent loop; these recognized commands
are handled inside the custom provider without asking a model to select a tool.
New natural phrases must be explicit manifest aliases or a reviewed module
processor. Arbitrary intent understanding is not claimed.

## Multiuser state and permissions

Preferences are stored under a hash of the exact `(actor_id, tenant_id)` pair.
Each entry contains account defaults and chat overrides. Chat ownership is
checked before reading or changing a chat's settings. A chat override wins over
the account default; changing the account default leaves explicit overrides
intact. The manager is required and never becomes disabled.

Each admitted request stores an immutable feature selection and its preference
revision before the native user message is queued. A toggle during execution
changes future requests, not an already admitted request. Code composition is
unchanged by these settings, and one customer's toggle cannot unload another
customer's module. Preferences survive engine restart; interrupted requests
retain the existing no-automatic-replay policy.

The gateway supplies `capabilities: ["developer_meter"]` only after matching its
server-side developer allowlist against the authenticated actor and tenant.
`OWNER_CLIENT` alone does not imply developer access. Browser bodies, prompt text
and model outputs cannot grant this capability. The engine applies a second
check on inventory, enablement, action execution, status and history projection.

Private developer assistant text is also protected after role revocation.
Before execution, a durable request intent records required capabilities. If a
process stops after native assistant commit but before receipt completion,
history correlates the assistant with the durable human message ID and checks
that intent before exposing text. This closes the incomplete-receipt gap while
preserving older ordinary matrix history.

## Telemetry and rubles

The internal pipeline supplies `metadata.meter` with schema
`octoport-request-meter/v1`. A failed internal response can supply the same meter
at the top level. The engine accepts a failure receipt only when its request ID
matches the dispatched request, stores it without retry, and exposes it only
through a permitted enabled developer meter.

The meter retains actual attempts, model-call counts, cache hit/miss/input/output
tokens and the pricing/FX quote captured by the backend at dispatch. Historical
requests are not repriced with current rates. Ruble totals use decimal-string
arithmetic through integer scaling; they do not sum floating-point currency.
They are estimates, not the provider's invoice.

Missing usage or a missing price receipt remains unknown. The API reports
`estimated: null` and `complete: false` where appropriate; `known` sums only known
parts. A missing failed-request receipt is not treated as a free request.
Only the built-in manager and the developer meter's local read action explicitly
declare zero model calls. Other plugin actions do not receive automatic zero
usage: an extension that calls an API must return its own real receipt.

Ordinary status responses contain `usage: null` and a public metadata whitelist.
Their structured `presentation` is preserved, including summary, details and
report links. Developer data stays in private engine state and is projected only
after fresh capability/enablement checks.

## Trusted module registration

The default directory is `plugins/installed/` beside this file. An operator may
set `OCTOPORT_PLUGINS_DIRECTORY` to another trusted installation directory. It
must not be a user-upload or chat-state directory. Neither the root directory,
plugin directory, manifest nor entry file may be group/world writable. Plugin
directories and entry files cannot be symlinks; the entry must remain inside the
installation directory. The loader checks the entry SHA256 before importing.

The loader does not enforce a particular owner UID: mode `0755` is accepted
regardless of who owns the directory. The operator must keep this code directory
and its parent directories under trusted deployment ownership, inaccessible for
modification by untrusted users. In production, use the root-owned release with
the engine service restricted to reading it. An owner able to rewrite both a
module and its manifest can also replace the recorded hash. This is a trusted
code-loading boundary, not a sandbox or a user-selectable installation API.

A module directory contains `manifest.json` and its entry file. Required fields:

```json
{
  "api_version": "octoport.harness-plugin/v1",
  "harness_version": "0.2.2-rc.1",
  "id": "example",
  "name": "Пример",
  "description": "Описание установленной возможности.",
  "version": "1.0.0",
  "default_enabled": false,
  "required": false,
  "capability": null,
  "priority": 50,
  "aliases": ["пример"],
  "actions": {
    "inspect": {"title": "Проверить", "aliases": ["проверь пример"]}
  },
  "entry": "plugin.mjs",
  "sha256": "REPLACE_WITH_SHA256_OF_THE_ENTRY_FILE"
}
```

The example hash is a placeholder; installation rejects it until replaced by
the real 64-character SHA256. Review all imported dependencies as part of the
trusted release, whose source manifest covers the full artifact.

```js
export default {
  name: 'octoport-example',
  inject: ['octoportPlugins'],
  apply(ctx, { manifest, PipelineError }) {
    ctx.octoportPlugins.register(ctx, manifest, {
      actions: {
        async inspect({ scope, args, readJobs }) {
          // scope is authenticated; readJobs is already owner/chat scoped.
          // Validate args and provide real accounting if an API is called.
          return { text: 'Результат проверки.', data: { ok: true } };
        },
      },
      // Optional process({scope, text, signal}) returns null to decline a
      // normal turn, or the same {text, usage?, metadata?, presentation?} result.
    });
  },
};
```

Modules can register actions, a normal-turn processor, and a result projection.
Processors run in ascending manifest priority; the first non-null result wins.
The matrix priority is 1000, so a deliberately enabled specialized processor can
run before it. Permission and enablement checks precede every invocation.
Do not add a branch to `manager.mjs` when adding a module. Add a reviewed module
directory, its hash-pinned manifest, suitable scoped permissions, and tests; then
deploy and restart the engine through the ordinary release procedure.

## Internal API

All routes require the bridge bearer credential and gateway-derived owner fields.

| Route | Additional fields | Result |
| --- | --- | --- |
| `/v1/plugins/list` | Optional `chat_id` | `{scope, chat_id?, plugins}`; only permitted modules |
| `/v1/plugins/set` | `scope: "account"` or `"chat"`, optional/required `chat_id`, `plugin_id`, `enabled` | `{ok, scope, plugins}` |
| `/v1/plugins/parse` | Optional `chat_id`, `text` | `{handled, kind}`; no mutation or execution |
| `/v1/plugins/call` | Optional `chat_id`, `plugin_id`, `action`, `arguments` | Registered action's data |

For `dev-meter`, action `requests` accepts optional `job_id` and `limit` (1–100,
default 50). It returns `{scope, requests, summary}`. Each request contains its
job ID, chat ID, state and canonical meter or `null`. The summary includes
request count, model-call counts, tokens and exact decimal ruble aggregates.
The aggregate describes only the returned bounded request set.

## Verification and source references

The full engine suite passed **21/21 tests, zero skipped** against the installed
0.2.2-rc.1 runtime under `alisa-platform-stage`, with synthetic pipelines and no
paid or marketplace calls. It includes a third module loaded from a manifest
without dispatcher edits, lifecycle disposal, hash rejection, cross-user and
cross-tenant isolation, chat/account defaults, immutable admitted feature state,
presentation persistence, exact historical meter receipts, failed requests and
developer-text redaction across an incomplete-receipt crash gap.

Primary references used for this implementation:

- [DeepSeek Harness architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md): the product is composed of Cordis plugins and services.
- [Plugin manager package](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md): profile-wide selection, package installation, host execution and restart/HMR behavior. Exact installed copy checked at `@deepseek-ai/dsh-plugin-manager/README.md` in the pinned 0.2.2-rc.1 runtime; that package's `repository.directory` is `packages/boot/plugin-manager`.
- [Cordis Service](https://github.com/deepseek-ai/deepseek-harness/blob/master/vendor/cordis/src/service.ts): named services and their owning fiber. Exact installed copy checked at `@deepseek-ai/cordis/src/service.ts`, Cordis 4.1.0.
- [Cordis Fiber](https://github.com/deepseek-ai/deepseek-harness/blob/master/vendor/cordis/src/fiber.ts): reversible `ctx.effect()` registrations and disposal. Exact installed API checked at `@deepseek-ai/cordis/lib/types/fiber.d.ts`.

The links follow the official repository. Runtime compatibility is established
by the inspected installed 0.2.2-rc.1 packages and the actual-runtime tests, not by
assuming that the repository's moving master branch is identical.
