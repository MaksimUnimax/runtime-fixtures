# ALL_8_LLM_NO_SESSION_MONITOR — R2 rework

Work ID: `S2_L5A_ALL8_NO_SESSION_MONITOR_2026-09-18_R2`

Status: `IMPLEMENTED_CANDIDATE`

This is a bounded Stream-2 no-session monitoring candidate. It does not add
authenticated sessions, API-watch work, scheduling, incidents, or product
runtime changes.

## Provenance

- Branch: `feature/stream2-llm8-nosession-r1`
- R1 parent / accepted L5 commit: `22c5d7a33b7672f3b589382eadcfe68ef75abba7`
- Accepted L5 tree: `827d626b6f876d097dd198bbc072bc94fb793ce8`
- R1 commit: `dc0069d52dfd934c2ea94f6447ce0cbf9244e12d`
- R1 tree: `c0bdfe314553dcf6ec12ea83bc15bc8daee661d9`
- Fetched `origin/main`: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`
- Fetched integration HEAD: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- Fetched docs authority: `b3cc0289780ba2590a6dfcf8a8e84059e5319594`
- `origin/main` is an ancestor of integration; integration is 106 commits
  ahead and 0 behind.
- L5 is an ancestor of R1; the docs authority commit is present on its remote
  docs branch.

## R1 root causes corrected

R1 used mostly placeholder-like `data-testid` profiles, had no main-document
status or final-URL evidence, observed immediately after DOMContentLoaded,
treated login controls as hard auth walls, required the same public contour
from every provider, assumed Alice’s composer/send controls were mandatory,
and started Qwen at `/chat`. It therefore collapsed access gates, rollout
boundaries, hydration delay, and positive public shells into generic
`UNKNOWN` or false Alice drift.

R2 now has reviewed provider-owned structural markers, a capability
expectation model (`EXPECTED`, `OPTIONAL_OR_REGION_DEPENDENT`,
`NOT_EXPECTED`, `NOT_OBSERVABLE_WITHOUT_SESSION`), bounded readiness polling,
safe navigation metadata, and typed surface outcomes layered over the
existing six-state Health vocabulary. ChatGPT Work is never inferred from
Standard.

## Changed files

- `apps/health-runner/src/no-session-contracts.ts`
- `apps/health-runner/src/no-session-target-authority.ts`
- `apps/health-runner/src/no-session-strategies.ts`
- `apps/health-runner/src/no-session-browser-driver.ts`
- `apps/health-runner/src/no-session-runner.ts`
- `apps/health-runner/src/no-session-evidence.ts`
- `apps/health-runner/src/no-session-monitor.test.ts`
- `apps/health-runner/src/index.ts`
- `docs/development/stream2/ALL_8_LLM_NO_SESSION_MONITOR_R2_2026-09-18.md`

No Stream-1 production path, `packages/ai-adapters/**`, product auth/session
code, database schema, scheduler, incident path, or API-watch code changed.

## Navigation and readiness

Each probe now retains only bounded safe metadata: sanitized requested start
URL, sanitized final URL, final origin, main-document status when available,
redirect count capped at eight, and a typed navigation outcome. Query strings,
fragments, headers, cookies, bodies, and redirect history are not retained.

The driver waits for load state and a bounded two-read stability window over
reviewed provider markers. It records `STATIC_LANDING`, `APP_HYDRATED`,
`ACCESS_GATE`, `SECURITY_GATE`, or `MAINTENANCE_GATE`; it never clicks, types,
submits, polls aggressively, or solves a challenge.

## First-party authority and no-session expectations

| Surface | Canonical start | Allowed origin | No-session expectation |
|---|---|---|---|
| ChatGPT Standard | `https://chatgpt.com/` | `https://chatgpt.com` | Public shell and composer expected when exposed; login may coexist |
| ChatGPT Work | `https://chatgpt.com/` | `https://chatgpt.com` | Positive workspace evidence only; otherwise not observable without session |
| Alice | `https://alice.yandex.ru/` | `https://alice.yandex.ru` | Alice landing expected; composer/input/send optional or rollout-dependent |
| DeepSeek | `https://chat.deepseek.com/` | `https://chat.deepseek.com` | Provider app or access/security response; no deep interaction inference |
| Grok | `https://grok.com/` | `https://grok.com` | Grok public landing/input may be available; auth may coexist |
| Claude | `https://claude.ai/` | `https://claude.ai` | Claude login/security boundary is a legitimate no-session result |
| Gemini | `https://gemini.google.com/` | `https://gemini.google.com` | Public input is eligibility-dependent; sign-in-only is a typed boundary |
| Qwen | `https://chat.qwen.ai/` | `https://chat.qwen.ai` | Current Qwen Studio root is canonical; `/chat` is not hardcoded |
| Kimi | `https://www.kimi.com/` | `https://www.kimi.com` | Kimi public application shell/input may be available; account sync is separate |

Sources used: [OpenAI ChatGPT home-page help](https://help.openai.com/en/articles/9125172),
[Alice](https://alice.yandex.ru/), [Alice chat help](https://alice.yandex.ru/support/ru/assistant/chat-alice),
[DeepSeek](https://www.deepseek.com/en/), [Grok](https://grok.com/),
[xAI Grok docs](https://docs.x.ai/grok/overview), [Claude](https://claude.ai/),
[Gemini](https://gemini.google.com/), [Google signed-out eligibility help](https://support.google.com/gemini/answer/13278668),
[Qwen](https://qwen.ai/), [Qwen Studio](https://chat.qwen.ai/),
[Kimi](https://www.kimi.com/), and [Kimi new-user help](https://www.kimi.com/en/help/new-user-guide/overview).

## Final passive live matrix

Fresh ephemeral Chromium contexts were used. No prompt was entered and no
control was activated. The headless matrix below is the final R2 run; each
result has two safe evidence references.

| Surface | Mode | HTTP / redirects | Readiness | Identity | Surface outcome | Input / Send | Auth | Health / basis |
|---|---|---:|---|---|---|---|---|---|
| ChatGPT Standard | headless | 403 / 1 | security gate | not proven | security checkpoint | not provable / not provable | not provable | UNKNOWN / SECURITY_CHECKPOINT |
| ChatGPT Work | headless | 403 / 1 | security gate | not proven | security checkpoint | not provable / not provable | not provable | UNKNOWN / SECURITY_CHECKPOINT |
| Alice | headless | 200 / 0 | app hydrated | proven | public interactive | observed / observed | login required | HEALTHY / PUBLIC_SURFACE_PRIMARY |
| DeepSeek | headless | 403 / 0 | access gate | not proven | access blocked | not provable / not provable | not provable | UNKNOWN / ACCESS_BLOCKED |
| Grok | headless | 200 / 0 | app hydrated | proven | public interactive | observed / observed | not required | HEALTHY / PUBLIC_SURFACE_PRIMARY |
| Claude | headless | 403 / 1 | static landing | not proven | security checkpoint | not provable / not provable | not provable | UNKNOWN / SECURITY_CHECKPOINT |
| Gemini | headless | 200 / 3 | app hydrated | proven | public interactive | observed / not expected | login required | HEALTHY / PUBLIC_SURFACE_PRIMARY |
| Qwen | headless | 200 / 0 | app hydrated | proven | public interactive | observed / not expected | not required | HEALTHY / PUBLIC_SURFACE_PRIMARY |
| Kimi | headless | 200 / 0 | app hydrated | proven | public interactive | observed / not expected | not required | HEALTHY / PUBLIC_SURFACE_PRIMARY |

Headful Chromium under Xvfb was also run. ChatGPT Standard proved its public
shell and composer (`HEALTHY`), while ChatGPT Work remained
`NOT_OBSERVABLE_WITHOUT_SESSION`. Alice, Grok, Gemini, Qwen, and Kimi remained
positive. Claude reached a same-origin login/security surface. DeepSeek
returned a 202 static/no-identity response instead of the headless 403; this
environment difference is retained as evidence and is not tuned around.

## Regression coverage

The focused R2 suite covers: ChatGPT public identity, Work non-inference,
Alice optional and required contour behavior, DeepSeek 403 typing, Grok and
Kimi identity, Gemini auth boundary, Qwen root/unsupported behavior, Claude
auth surface fixtures, wrong origin, generic textbox rejection, cross-provider
marker separation, hydration delay, navigation evidence, and required-contour
drift.

## Privacy and interaction boundary

Only reviewed booleans, bounded counts, enums, sanitized URLs, and hashes are
persisted. No raw DOM, HTML, page text, accessibility tree, screenshot,
cookie, storage state, auth header, prompt, response, token, or private content
is retained. All probe results set `noInteraction: true`.

## Deferred ledger

- `ENVIRONMENT_DEFERRED`: remote publication/readback is reported separately
  if credentials are unavailable.
- No owner manual health action is required.
- No `OWNER_DEFERRED_TEST`, authenticated-session expansion, scheduler,
  API-watch, or Stream-1 patch is part of this candidate.

## Verdict

`IMPLEMENTED_CANDIDATE` — architect acceptance remains outside this bounded
Codex task.

Next: keep work in S2-L5A for architect review and any further no-session
precision fixes. Do not begin authenticated technical sessions or S2-L6 until
S2-L5A is accepted.
