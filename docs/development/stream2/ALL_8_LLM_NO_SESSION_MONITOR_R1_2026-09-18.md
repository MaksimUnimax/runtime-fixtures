# ALL_8_LLM_NO_SESSION_MONITOR — R1 candidate

Work ID: `S2_LLM8_NO_SESSION_MONITOR_FOUNDATION_2026-09-18_R1`

Status: `IMPLEMENTED_CANDIDATE` / `PROVISIONAL_OWNER_REVIEW`

This record is a bounded Stream-2 candidate. It does not claim architect or
owner acceptance, authenticated-session acceptance, scheduling, incidents, or
API-watch work.

## Provenance and non-interference

- Continuation branch: `feature/stream2-llm8-nosession-r1`
- Starting HEAD: `22c5d7a33b7672f3b589382eadcfe68ef75abba7`
- Accepted L5 tree: `827d626b6f876d097dd198bbc072bc94fb793ce8`
- Accepted L5 parent: `df4b7d31475552fd8a37ab5834661fb1dd9d82c8`
- Current fetched `origin/main`: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`
- Current fetched `origin/integration/i1-c1-srv5-2026-09-16`: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- Integration relation: `origin/main...origin/integration` is `0 106`
- The accepted L5 ancestry already contains the fetched integration ancestry;
  merging the integration ref into the continuation reported `Already up to
  date`.
- No Stream-1 production file was changed. Active worktree inspection found no
  tracked health-runner, server-health, or Stream-2 documentation overlap.

## Architecture

The candidate adds a separate no-session path:

`NO_SESSION_TARGETS` → fresh ephemeral Chrome context → provider-specific
selector profile → bounded structural snapshot → typed blocker/access state →
six-state Health classification → L5-compatible safe metadata/transition
evidence.

Existing `hf-*` fixture strategies and H3 authenticated strategies remain
unchanged. No production adapter, auth bootstrap, session, DB schema,
scheduler, incident path, or Stream-1 runtime was changed.

The implementation is in:

- `apps/health-runner/src/no-session-target-authority.ts`
- `apps/health-runner/src/no-session-contracts.ts`
- `apps/health-runner/src/no-session-strategies.ts`
- `apps/health-runner/src/no-session-browser-driver.ts`
- `apps/health-runner/src/no-session-runner.ts`
- `apps/health-runner/src/no-session-evidence.ts`
- `apps/health-runner/src/no-session-monitor.test.ts`

## Target authority

There are exactly eight provider IDs and nine explicit surfaces:

| Provider | Surface / start URL | Allowed origin | No-session boundary |
|---|---|---|---|
| `chatgpt` | `CHATGPT_STANDARD` / `https://chatgpt.com/` | `https://chatgpt.com` | Public page identity and public composer signals where exposed; no prompt or Work inference |
| `chatgpt` | `CHATGPT_WORK` / `https://chatgpt.com/` | `https://chatgpt.com` | Work requires positive workspace evidence; URL shape and Standard markers never prove Work |
| `alice` | `ALICE` / `https://alice.yandex.ru/` | `https://alice.yandex.ru` | Alice-specific public landing/composer signals; no authenticated `/chat/<UUID>` assumption |
| `deepseek` | `DEEPSEEK` / `https://chat.deepseek.com/` | `https://chat.deepseek.com` | Public identity/auth surface only; deep interaction is not inferred |
| `grok` | `GROK` / `https://grok.com/` | `https://grok.com` | Grok-specific public surface and auth signals; no X account use |
| `claude` | `CLAUDE` / `https://claude.ai/` | `https://claude.ai` | Claude-specific public/auth surface; no account or message interaction |
| `gemini` | `GEMINI` / `https://gemini.google.com/` | `https://gemini.google.com` | Signed-out capability variation is observed; no Google account use |
| `qwen` | `QWEN` / `https://chat.qwen.ai/chat` | `https://chat.qwen.ai` | Qwen Studio-specific surface; no account or prompt interaction |
| `kimi` | `KIMI` / `https://www.kimi.com/` | `https://www.kimi.com` | Kimi-specific public/auth surface; no account or prompt interaction |

Every target uses `SAME_ORIGIN_ONLY`, a bounded 15-second navigation timeout,
an explicit strategy ID/revision, and requires origin plus a provider-specific
surface signal. Generic textbox, generic title, and origin alone are
insufficient identity evidence.

## First-party origin provenance

Origin decisions were reviewed on 2026-09-18 using the following first-party
provider surfaces:

- OpenAI: [ChatGPT home page help](https://help.openai.com/en/articles/9125172)
  identifies `chatgpt.com`.
- Yandex: [Alice AI](https://alice.yandex.ru/about) identifies
  `alice.yandex.ru`.
- DeepSeek: [DeepSeek official site](https://www.deepseek.com/en/) links its
  DeepSeek Web product; the chat start is constrained to
  `chat.deepseek.com`.
- xAI: [Grok](https://grok.com/) is the monitored first-party web surface.
- Anthropic: [Claude product material](https://www.anthropic.com/claude)
  identifies the Claude web app; the constrained surface is `claude.ai`.
- Google: [Gemini Apps Help](https://support.google.com/gemini/answer/13275745)
  identifies `gemini.google.com` and documents signed-out variation.
- Qwen: [Qwen Studio](https://qwen.ai/qwenchat) links its web product; the
  current start surface is `chat.qwen.ai/chat`.
- Moonshot AI: [Kimi](https://www.kimi.com/) is the monitored first-party web
  surface.

Live HTTP/browser observations retained only normalized origins and bounded
booleans; no page captures were committed. Redirects outside the exact origin
allowlist fail closed.

## Blocker and Health semantics

The typed model distinguishes navigation, identity, public reachability,
composer, editable input, Send control, authentication, checkpoint, CAPTCHA,
access block, maintenance, browser/network failure, and unexpected surface.

The six Health states reuse the accepted S2-L4 vocabulary and precedence:

- proven identity plus all expected public contours: `HEALTHY`;
- proven identity with a required public contour absent: `DRIFT`;
- login/auth wall: `UNKNOWN` with `AUTH_REQUIRED_BOUNDARY`, never DOM drift or
  successful deep interaction;
- CAPTCHA/security checkpoint or access block: `UNKNOWN` with a typed blocker;
- positive maintenance surface: `MAINTENANCE`;
- origin/identity/network/browser uncertainty before identity: `UNKNOWN`;
- ChatGPT Work without positive Work evidence: `NOT_PROVEN` / `UNKNOWN`.

## Passive live probe matrix

Run: 2026-09-18, fresh Chrome 147.0.7727.116 contexts, headless, no
storageState/cookies/profile, no typing/clicking/submission. Each target was
attempted once in an independent context. Every output produced two bounded
safe evidence references.

| Surface | Navigation | Origin | Identity | Composer / input / Send | Auth | Blocker | Health |
|---|---|---|---|---|---|---|---|
| `CHATGPT_STANDARD` | loaded | valid | not proven | not provable / not provable / not provable | not provable | unexpected surface | `UNKNOWN` |
| `CHATGPT_WORK` | loaded | valid | not proven | not provable / not provable / not provable | not provable | unexpected surface | `UNKNOWN` |
| `ALICE` | loaded | valid | proven | absent / absent / absent | not required | none | `DRIFT` |
| `DEEPSEEK` | loaded | valid | not proven | not expected / not expected / not expected | not provable | unexpected surface | `UNKNOWN` |
| `GROK` | loaded | valid | not proven | not provable / not provable / not provable | not provable | unexpected surface | `UNKNOWN` |
| `CLAUDE` | loaded | valid | not proven | not provable / not provable / not provable | not provable | unexpected surface | `UNKNOWN` |
| `GEMINI` | loaded | valid | not proven | not provable / not provable / not provable | login required | unexpected surface | `UNKNOWN` |
| `QWEN` | loaded | valid | not proven | not provable / not provable / not provable | not provable | unexpected surface | `UNKNOWN` |
| `KIMI` | loaded | valid | not proven | not provable / not provable / not provable | not provable | unexpected surface | `UNKNOWN` |

These are current-point observations, not permanent selector truth. The
`ALICE` result is a candidate public-contour drift signal and needs owner review
before any selector/profile revision. No provider result was retried and no
provider blocker aborted another target.

## Evidence and privacy

No-session evidence is bounded to `SAFE_ELEMENT_METADATA` and
`STATE_TRANSITION_TRACE`. It contains provider/surface/target IDs, normalized
origin, strategy revision, bounded element counts, visibility/editability/
actionability booleans, typed blocker/auth/classification values, and safe
semantic SHA-256 hashes. Evidence UUIDs are random and excluded from semantic
hashes. No DB migration or durable artifact store was added.

The implementation contains no raw HTML/DOM, accessibility tree, screenshot,
page text, prompt, response, cookie, storage state, authorization header,
password, OTP, token, seller data, or private conversation data. The live
driver creates a new non-persistent context and never imports credentials or
owner session state. The result contract carries `noInteraction: true`.

## Validation

- RED: the first focused run genuinely failed two newly written semantic
  assertions; the assertions were corrected to the model’s explicit
  `MISMATCH` and `NOT_EXPECTED` outcomes.
- Focused no-session matrix: `54/54 PASS`.
- Full health-runner suite: `257/257 PASS`.
- `@product/health` suite: `57/57 PASS`.
- Health-runner typecheck: PASS.
- Health-runner build: PASS.
- Live passive matrix: `1/1` matrix test PASS, nine targets attempted.
- One earlier full-runner attempt had a single timing-sensitive accepted
  `WD-16` dedicated-session failure; the unchanged suite passed on immediate
  rerun (`257/257`), so no unrelated code was changed.
- DB Health tests: not changed or required by this runner-only candidate.
- Lint, format, recursive typecheck/build, bridge guard, and docs check: run
  in the terminal validation phase and recorded in the final report.
- `git diff --check`: PASS at documentation time.

## Boundaries and next step

Remaining limitations are intentionally explicit: live provider UI markers can
be absent because of regional rollout, anti-bot/security surfaces, or selector
drift; no-session cannot prove authenticated account/workspace identity or
message delivery. No auto-patch is made from a live observation.

Recommended next dependency-correct step: owner/architect review of this
candidate and the Alice public-contour observation, followed by a separately
bounded authenticated-session expansion. Scheduling/incidents and API-watch
remain later tasks.
