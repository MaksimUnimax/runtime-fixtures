# S2-L5B authenticated technical session / deep-probe foundation — R1

Status: `IMPLEMENTED_CANDIDATE` for bounded R1 foundation; not architect acceptance.

Observation date: 2026-09-18 (Europe/Moscow).

## Identity and ancestry

| Item | Authority |
| --- | --- |
| Work ID | `S2_L5B_AUTH_SESSION_AUTHORITY_AND_DEEP_PROBE_FOUNDATION_2026-09-18_R1` |
| Branch | `feature/stream2-l5b-auth-foundation-2026-09-18` |
| Parent | `c289534c94063ab72d812e48506668ad008f0cfd` (`97ad18421019180a866cb0767e0d9445c39c4b7b`) |
| Accepted R2 ancestor | `bf39bba6ed1a7eb590df0db91bbd450673634ee9` |
| Accepted R1 ancestor | `dc0069d52dfd934c2ea94f6447ce0cbf9244e12d` |
| Accepted L5 ancestor | `22c5d7a33b7672f3b589382eadcfe68ef75abba7` (`827d626b6f876d097dd198bbc072bc94fb793ce8`) |
| Current product refs inspected | `origin/main` `bc718cc5c677ad0eb4598e7de3ad766473ff0847`; `origin/integration/i1-c1-srv5-2026-09-16` `23047b3bdc22842a5b17e29e3d3f603c0ee51b16` |
| Documentation owner-correction ref | `origin/docs/stream2-all8-no-session-first-2026-09-18` `b3cc0289780ba2590a6dfcf8a8e84059e5319594` |

The root checkout had unrelated uncommitted Stream-1 work, so implementation was
performed in a clean worktree from the accepted R3 commit. No destructive reset,
rebase, main merge, PR #9 mutation, or force push was performed.

## Existing foundations preserved

The accepted H3 foundations remain unchanged:

- ChatGPT Standard: strict dedicated technical storage-state loader, isolated
  Chrome boundary, fixed Health conversation identity, Standard profile and
  exactly-one-send strategy.
- ChatGPT Work: distinct target key and profile, trusted fixed route, positive
  workspace identity, no URL-only Work inference, and no model-picker/fallback
  interaction.
- Alice: Yandex-origin dedicated loader, exact `/chat/<UUID>` route, active
  history corroboration, Alice-specific composer/send/stop/code/copy strategy.

R1 adds the provider-neutral L5B shell and authority catalog. It does not alter
the existing H3 selector implementations or product adapters.

## Authenticated authority matrix

There are nine authenticated surface identities for eight providers because
ChatGPT Standard and ChatGPT Work are separate authorities.

| Provider / surface | Official start / expected origin | Auth boundary and conversation rule | Capability vector | Status / live readiness |
| --- | --- | --- | --- | --- |
| ChatGPT / `CHATGPT_STANDARD` | `https://chatgpt.com/` / `https://chatgpt.com` | OpenAI account identity; fixed dedicated Health conversation; no arbitrary user chat | Send, busy, response association, completion, code, Copy, delivery: supported by existing H3 foundation | `FOUNDATION_AVAILABLE`; blocked until dedicated technical session |
| ChatGPT / `CHATGPT_WORK` | `https://chatgpt.com/` / `https://chatgpt.com` | Account plus positive managed-workspace identity; fixed dedicated Work conversation; URL alone rejected | Same as Standard, with positive Work identity and no model-picker interaction | `FOUNDATION_AVAILABLE`; blocked until dedicated Work session |
| Alice / `ALICE_CHAT` | `https://alice.yandex.ru/` / `https://alice.yandex.ru` | Yandex ID; fixed `/chat/<UUID>` plus active-history corroboration; no route-only binding | Send, busy, response association, completion, code, Copy, delivery: supported by existing H3 foundation | `FOUNDATION_AVAILABLE`; blocked until dedicated Alice session |
| DeepSeek / `DEEPSEEK_CHAT` | `https://chat.deepseek.com/` / `https://chat.deepseek.com` | Account-backed web session; fixed dedicated conversation; disposable creation not permitted | Structural capability vector is declared; live Send is disabled until selectors, account identity, and restrictions are verified | `SESSION_NOT_PROVISIONED`; blocked before Send |
| Grok / `GROK_WEB` | `https://grok.com/` / `https://grok.com` (auth may use `accounts.x.ai`) | xAI account identity; fixed dedicated conversation; no connectors/agents | Structural vector declared; live Send disabled pending provider-specific verification | `SESSION_NOT_PROVISIONED`; blocked before Send |
| Claude / `CLAUDE_WEB` | `https://claude.ai/` / `https://claude.ai` | Google, email secure-link, or SSO; Team/Enterprise context must be proven; fixed dedicated conversation | Structural vector declared; live Send disabled pending provider-specific verification and restriction review | `SESSION_NOT_PROVISIONED`; blocked before Send |
| Gemini / `GEMINI_WEB` | `https://gemini.google.com/` / `https://gemini.google.com` | Google Account; personal/work/school context and admin/license access must be proven; fixed conversation | Structural vector declared; no connected apps/tools; live Send disabled pending verification | `SESSION_NOT_PROVISIONED`; blocked before Send |
| Qwen / `QWEN_STUDIO` | `https://chat.qwen.ai/` / `https://chat.qwen.ai` | Qwen Studio account; fixed dedicated conversation; no disposable creation in R1 | Structural vector declared; live Send disabled pending provider-specific verification | `SESSION_NOT_PROVISIONED`; blocked before Send |
| Kimi / `KIMI_WEB` | `https://www.kimi.ai/` or `https://kimi.com/` / regional origins | Regional Kimi identity; official help documents Google/phone on `kimi.ai`, phone/WeChat on `kimi.com`; fixed conversation | Structural vector declared; regional surface must be selected explicitly; live Send disabled pending verification | `SESSION_NOT_PROVISIONED`; blocked before Send |

Every entry declares login/session identity, expected origins, fixed-conversation
policy, Send/busy/response/completion/code/Copy/delivery capability, logout,
checkpoint, blocked-account and invalid-session semantics, cleanup and evidence
limitations. No provider is represented as architectural `UNKNOWN` merely because
its technical session is absent.

## First-party auth authority

The following first-party pages were inspected on the observation date:

- OpenAI: [managed workspace identity and access](https://help.openai.com/en/articles/9047883-if-i-m-in-a-chatgpt-enterprise-workspace-why-can-t-i-access-my-company-s-org-account%3F.pptx), [Business workspace switching](https://help.openai.com/en/articles/8542216), [SSO login methods](https://help.openai.com/en/articles/10468051-sso-overview), [active sessions](https://help.openai.com/en/articles/20001257).
- Alice/Yandex: [Alice AI chat](https://alice.yandex.ru/support/ru/assistant/chat-alice), [Yandex ID login](https://yandex.ru/support/id/ru/auth).
- DeepSeek: [official web chat](https://chat.deepseek.com/), [DeepSeek privacy policy, account registration/login section](https://platform.deepseek.com/downloads/DeepSeek%20Privacy%20Policy.pdf), [user agreement](https://platform.deepseek.com/downloads/DeepSeek%20User%20Agreement.pdf).
- Grok/xAI: [Grok web overview](https://docs.x.ai/grok/overview), [official account login](https://accounts.x.ai/sign-in), [Grok account FAQ](https://docs.x.ai/grok/faq).
- Claude/Anthropic: [Claude login](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account), [Claude login surface](https://claude.ai/login), [supported interfaces](https://support.anthropic.com/en/articles/8114487-what-interfaces-can-i-use-to-access-claude).
- Gemini/Google: [what is required to sign in](https://support.google.com/gemini/answer/13278668?hl=en), [work/school account boundary](https://support.google.com/gemini/answer/14620100?hl=en-CA).
- Qwen: [Qwen Studio](https://chat.qwen.ai/), [Qwen login surface](https://chat.qwen.ai/auth).
- Kimi/Moonshot: [Kimi overview](https://www.kimi.ai/help/getting-started/overview), [regional sign-in and device identity](https://www.kimi.ai/help/others/device-management).

No account registration, subscription purchase, legal acceptance, personal
profile use, or login was performed.

## Session security boundary

`auth-session-runtime.ts` accepts only an opaque runtime reference such as a
deployment-provided handle. It does not accept paths, cookies, storageState,
tokens, auth headers, passwords, OTP secrets, or profile contents. A missing
environment reference yields `NO_SESSION_CONFIGURED`; explicit runtime state can
be `PREPROVISIONED_DEDICATED`, `SESSION_EXPIRED`, `SESSION_INVALID`,
`VERIFICATION_REQUIRED`, `CAPTCHA_SECURITY_CHECKPOINT`, `ACCOUNT_BLOCKED`, or
`SESSION_ENVIRONMENT_UNAVAILABLE`.

The browser/session executor is expected to resolve the opaque handle outside the
repository and outside the evidence tree. Only a boolean presence and typed state
are safe to report. There is no personal-profile or alternate-account fallback.

## Provider-neutral shell and evidence

`runAuthenticatedDeepProbe` owns one fixed sequence:

`session → surface → fixed conversation → composer → packaged prompt → exactly-one
Send → generation → associated response → completion → code/Copy/delivery
validation → cleanup`.

Provider adapters own only their selectors and identity rules. The shell refuses
to proceed for wrong account/surface/conversation, provider readiness blocked,
checkpoint, or session uncertainty. It increments the Send gate once, rejects
any adapter report other than exactly one action, and never retries after an
uncertain or post-send failure.

Evidence contains only prompt ID/hash, booleans, bounded counts, transition enums,
safe surface flags, and strategy identity. It never stores prompt/response text,
conversation IDs, session references, browser paths, cookies, tokens, passwords,
OTP values, or auth headers.

## Alice AD16–18 investigation

The accepted R3 record reports WD-16 stable while the adjacent Alice AD16–18
containing suite can fail on repetition 5; ordered WD-16/no-session matrices were
stable. Static inspection shows AD16–18 intentionally races a 1 ms delayed loader
against repeated rename replacement of a large file. That makes the negative
assertion scheduler-sensitive; it is not evidence of shared no-session state or
Alice route contamination. No retry or assertion weakening was added. The item is
classified as a pre-existing timing-sensitive foundation-test flake and remains
an explicit prerequisite before live Alice acceptance. Exact rerun is deferred by
the unavailable package/runtime toolchain described below.

## Tests and validation

New deterministic RED-first coverage is in
`apps/health-runner/src/auth-deep-probe.test.ts` and covers missing/expired/
invalid/checkpoint/CAPTCHA/blocked sessions, wrong account/surface/conversation,
duplicate and uncertain Send, response association, completion timeout, provider
cross-contamination, provider readiness gating, safe evidence, and no-session
short-circuit behavior. Fixtures are synthetic and loopback-free.

The environment currently provides Node `v12.22.9`, with no npm, pnpm, corepack,
or installed dependency tree. Therefore the focused Vitest suite, full
health-runner suite, typecheck, build, lint, format, docs check, bridge guards,
and exact Node 24 matrix could not be executed in this environment. Node 24 is an
explicit `ENVIRONMENT_DEFERRED`; Node 12 was not treated as a validation match.
Existing R3 evidence remains the authority for the accepted no-session matrix:
66/66 focused no-session tests, with the documented adjacent AD16–18 containing
flake and stable WD-16 isolation matrices.

## Scope and privacy

Changed scope is limited to `apps/health-runner/**` and this document. No
`apps/extension/**`, product auth/bootstrap/session, product Work, provider
dispatch/replay, rare sync, multi-browser runtime, release logic, or
`packages/ai-adapters/**` production behavior was changed. No scheduler,
incidents, API-watch, persistence migration, or S2-L6 work was added.

Changed-file review found no passwords, tokens, cookies, storageState, auth
headers, OTP, email links, private account IDs, personal conversation IDs,
session paths, or private chat content. Synthetic references are opaque fixture
labels only.

## Deferred ledger

- `ENVIRONMENT_DEFERRED`: Node 24 and package-manager/dependency execution are
  unavailable; exact test/build/readback validation remains pending.
- `ENVIRONMENT_DEFERRED`: accepted Stream-2 code publication/readback remains
  pending credentials.
- `PROVISIONAL_OWNER_REVIEW`: provisioned dedicated technical sessions and any
  provider-specific restriction review must be confirmed before live Send for
  the six non-existing foundations; no owner action was requested during R1.
- `PARALLEL_STREAM_DEPENDENCY`: existing Alice AD16–18 timing-sensitive test
  flake must be rerun and cleared before Alice authenticated acceptance.

## Next dependency-correct step

Run the new and accepted suites under Node 24 with dependencies installed; then
provision only legitimately available dedicated technical sessions through the
opaque runtime boundary, starting with ChatGPT Standard/Work and Alice after the
AD16–18 gate. Establish one provider-specific live readiness review at a time.
Do not begin S2-L6 scheduling/incidents before this authenticated layer reaches
its own accepted boundary.
