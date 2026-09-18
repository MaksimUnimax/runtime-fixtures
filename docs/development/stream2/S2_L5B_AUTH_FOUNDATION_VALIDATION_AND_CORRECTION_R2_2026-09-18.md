# S2-L5B authenticated technical session / deep-probe foundation — R2 validation and correction

Status: `IMPLEMENTED_CANDIDATE`; architect acceptance is not claimed.

Observation date: 2026-09-18 (Europe/Moscow).

## Candidate and preflight

| Item | Result |
| --- | --- |
| R1 candidate | `e9169bf11ea2a99ba37e018c13c08c282e0b0053` |
| R1 tree | `19ccc01e00848d778e187c1d0c8f5035cc6071c0` |
| R1 parent / accepted L5A R3 | `c289534c94063ab72d812e48506668ad008f0cfd` / `97ad18421019180a866cb0767e0d9445c39c4b7b` |
| R1 ancestry | `c289534` → `bf39bba` → `dc0069d` → `22c5d7d` verified |
| Remote refs after `git fetch --all --prune` | `origin/main` `bc718cc5c677ad0eb4598e7de3ad766473ff0847`; integration and PR #9 `23047b3bdc22842a5b17e29e3d3f603c0ee51b16` |
| Runtime | Node `v24.21.0`; pnpm `10.34.5` |
| Dependencies | `pnpm install --frozen-lockfile` passed; lockfile unchanged |
| Worktree | dedicated clean R1 worktree; unrelated root-checkout changes untouched |

The R1 seven-file implementation was recovered without recreation. R2 changes
remain inside `apps/health-runner/**` and this receipt. No Stream-1 path, API-watch
path, persistence migration, or product adapter was changed.

## Independent R1 review and corrections

R1 correctly provided nine explicit authenticated surface authorities, the
provider-neutral sequence, typed session states, no-session short-circuiting,
provider-specific strategy identities, bounded evidence, and cleanup. Three
real boundary gaps were corrected:

1. A runtime handle now carries positive expected provider, surface,
   `DEDICATED_HEALTH` technical-session class, and session generation. The
   environment loader requires and validates those bindings. A mismatched
   source fails closed before adapter interaction; no arbitrary profile can be
   treated as a Health technical session.
2. Response observation now requires `EXACT_HEALTH_SEND`, a one-message delta,
   and a bounded pre-send assistant count. An unrelated assistant message with
   the same count delta is rejected.
3. The shell marks Send uncertain before invoking the single Send authority.
   A strategy exception after click/submit records `SEND_UNCERTAIN` with one
   attempted Send and cleanup, and cannot be retried by the shell.

R1’s broad catch path is also typed as `PROBE_EXECUTION_FAILED` before Send and
`SEND_UNCERTAIN` after a Send attempt. No raw exception is returned.

## All-eight authority matrix

There are nine authenticated surfaces for eight providers. Every row remains
represented even when no technical session is configured.

| Provider / surface | First-party start and auth authority | Session status | Conversation / strategy | Deep-probe readiness and blockers |
| --- | --- | --- | --- | --- |
| ChatGPT Standard | `chatgpt.com`; OpenAI account, including password/social/tenant SSO as applicable | `NO_SESSION_CONFIGURED` | Fixed dedicated Health conversation; `CHATGPT_STANDARD_AUTH_V1` | Foundation available; no Send without bound dedicated session |
| ChatGPT Work | `chatgpt.com`; OpenAI account plus positive intended managed-workspace membership | `NO_SESSION_CONFIGURED` | Fixed Work Health conversation; no URL-only inference or model-picker fallback; `CHATGPT_WORK_AUTH_V1` | Foundation available; wrong workspace fails closed |
| Alice | `alice.yandex.ru`; Yandex ID account identity for persistent history | `NO_SESSION_CONFIGURED` | Fixed `/chat/<UUID>` plus active-history corroboration; `ALICE_AUTH_V1` | Foundation available; route-only identity rejected |
| DeepSeek | `chat.deepseek.com`; account-backed first-party web session | `NO_SESSION_CONFIGURED` | Fixed dedicated conversation; `DEEPSEEK_AUTH_V1` | Not live-ready; selectors/account identity/restriction review required |
| Grok | `grok.com`; xAI account sign-in, with Google, X, Apple, email, or GitHub shown by the first-party account surface | `NO_SESSION_CONFIGURED` | Fixed conversation; no connector/agent/disposable-chat mutation; `GROK_AUTH_V1` | Not live-ready; provider-specific verification required |
| Claude | `claude.ai`; Google, email secure link, or SSO; Team/Enterprise context must be proven | `NO_SESSION_CONFIGURED` | Fixed dedicated conversation; `CLAUDE_AUTH_V1` | Not live-ready; account/team identity and restrictions require review |
| Gemini | `gemini.google.com`; Google personal, work, or school account with required access/license | `NO_SESSION_CONFIGURED` | Fixed conversation; no connected apps/tools; `GEMINI_AUTH_V1` | Not live-ready; account context and access must be proven |
| Qwen Studio | `chat.qwen.ai`; current first-party auth presents email/password and sign-up | `NO_SESSION_CONFIGURED` | Fixed dedicated conversation; `QWEN_AUTH_V1` | Not live-ready; provider-specific verification required |
| Kimi | Regional Kimi identity: `kimi.ai` overseas Google/phone or `kimi.com` mainland China phone/WeChat | `NO_SESSION_CONFIGURED` | Fixed dedicated conversation; explicit regional surface; `KIMI_AUTH_V1` | Not live-ready; regional/account controls require review |

All rows declare typed missing, expired, invalid, verification, CAPTCHA,
blocked-account, environment-unavailable, cleanup, evidence, and readiness
semantics in `auth-session-authority.ts`. No live Send was attempted.

## Current first-party auth review

Checked on 2026-09-18:

- [OpenAI managed-workspace identity and access](https://help.openai.com/en/articles/9047883), [OpenAI SSO overview](https://help.openai.com/en/articles/10468051-sso-overview)
- [Yandex ID sign-in](https://yandex.ru/support/id/ru/auth), [Alice AI chat](https://alice.yandex.ru/support/ru/assistant/chat-alice)
- [DeepSeek official web surface](https://chat.deepseek.com/) and [DeepSeek official privacy policy](https://platform.deepseek.com/downloads/DeepSeek%20Privacy%20Policy.pdf) (the policy PDF was provider-protected during retrieval; no narrower method claim was added)
- [xAI account sign-in](https://accounts.x.ai/sign-in), [Grok overview](https://docs.x.ai/grok/overview), and [Grok account FAQ](https://docs.x.ai/grok/faq)
- [Claude login](https://claude.ai/login) and [Claude login help](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)
- [Gemini sign-in requirements](https://support.google.com/gemini/answer/13278668?hl=en) and [work/school account boundary](https://support.google.com/gemini/answer/14620100?hl=en-CA)
- [Qwen Studio auth surface](https://chat.qwen.ai/auth)
- [Kimi overview](https://www.kimi.ai/help/getting-started/overview) and [regional/device identity](https://www.kimi.ai/help/others/device-management)

The factual correction to R1 is that the current xAI first-party sign-in page
also lists GitHub. Kimi’s current overview directs users to `kimi.com`, while
the official device-management help retains the regional `kimi.ai` / `kimi.com`
identity distinction. DeepSeek remains intentionally modeled only as an
account-backed first-party session; unsupported provider-specific login details
were not hardcoded.

## Alice AD16–18 and ordered stability

The pre-correction R1 reproduction used the old combined race test and produced
29/30 (one failure at repetition 26). The complete Alice suite then produced
17/20, with the same negative read-churn assertion failing when replace-and-
restore completed between the loader’s observations. This was a scheduler
race in the test choreography: the loader already compares opened-file identity
and final path identity, but a transient replacement restored before both
observations is not observable as a final state.

The test was corrected without retry-to-green or assertion weakening: AD16,
AD17, and AD18 are separate checks; AD18 replaces the path synchronously with a
symlink-backed state and accepts only the two safe rejection codes produced by
the secure-read boundary. The existing Work WD-16 race test received the same
deterministic replacement proof after it failed twice in the ordered matrix.

| Matrix | Result |
| --- | ---: |
| AD16 only × 30 | 30/30 |
| AD17 only × 30 | 30/30 |
| AD18 only × 30 | 30/30 |
| AD16–18 group × 30 | 30/30 |
| Complete Alice dedicated-session suite × 20 | 20/20 |
| No-session suite → Alice suite × 20 | 20/20 |
| Work suite → Alice suite × 20 | 20/20 |
| Reverse Alice suite → Work suite × 20 | 20/20 |

## Test and gate results

| Check | Result |
| --- | --- |
| L5B focused / full health-runner | PASS — 14 files, 300 tests |
| `@product/health` full suite | PASS — 57 tests |
| DB unit suite | PASS — 3 files, 12 tests; integration not required because DB code was untouched |
| Root `pnpm test` | PASS — all 34 test-bearing workspace projects and bridge guard |
| Existing no-session suite | PASS — 66 tests in the full health-runner run |
| Standard / Work / Alice dedicated foundations | PASS — full health-runner run; ordered stability matrices above |
| Recursive typecheck | PASS — 34/35 workspace projects; one workspace has no typecheck script |
| Health-runner build | PASS |
| API / worker / portal / admin builds | PASS |
| ESLint and bridge guard | PASS |
| Prettier check | PASS |
| Docs check | PASS |
| `git diff --check` | PASS |

The package-install warning about ignored optional dependency build scripts did
not affect the executed gates; no package metadata or lockfile was changed.

## Live session matrix

No `HEALTH_AUTH_SESSION_REF_*` binding was present in the executor environment.
No account was registered, no owner/personal browser profile was used, no terms
were accepted, and no live Send occurred.

| Provider | Dedicated technical session available | Live Send | Reason |
| --- | --- | --- | --- |
| ChatGPT Standard | NO | NO | No approved bound runtime handle |
| ChatGPT Work | NO | NO | No approved bound runtime handle |
| Alice | NO | NO | No approved bound runtime handle |
| DeepSeek | NO | NO | No approved bound runtime handle; not live-ready |
| Grok | NO | NO | No approved bound runtime handle; not live-ready |
| Claude | NO | NO | No approved bound runtime handle; not live-ready |
| Gemini | NO | NO | No approved bound runtime handle; not live-ready |
| Qwen | NO | NO | No approved bound runtime handle; not live-ready |
| Kimi | NO | NO | No approved bound runtime handle; not live-ready |

Missing sessions are readiness state, not provider failure.

## Privacy and boundary review

Synthetic opaque fixture labels only. A changed-file and receipt scan found no
cookies, storageState payloads, passwords, tokens, Authorization headers, OTP
material, email links, filesystem profile paths, personal account identifiers,
real conversation identifiers, or private response text. Durable evidence is
limited to prompt ID/hash, typed transitions, bounded counts, association state,
completion state, booleans, and strategy identity. Stream-1 and
`packages/ai-adapters/**` production behavior are untouched.

## Deferred ledger and verdict

- `ENVIRONMENT_DEFERRED`: normal remote publication/readback requires available
  push credentials; no push was attempted from this bounded validation.
- `ENVIRONMENT_DEFERRED`: real provider sessions are not provisioned in this
  executor; live Send validation is intentionally not executed.

Verdict: `IMPLEMENTED_CANDIDATE`.

### L5B foundation readiness

**YES** — ready for architect acceptance review independently of real account
provisioning. The remaining review items are architect acceptance, optional
approved technical-session provisioning, and provider-specific live strategy
verification; they are not deterministic foundation blockers.

## Next

Recommend architect review of this R2 candidate, followed by a separately
bounded continuation that provisions and validates one approved dedicated
technical session at a time. Do not start S2-L6 in this task.
