# ALL_8_LLM_NO_SESSION_MONITOR — R3 acceptance closure

Work ID: `S2_L5A_ALL8_NO_SESSION_MONITOR_ACCEPTANCE_CLOSURE_2026-09-18_R3`

Status: `IMPLEMENTED_CANDIDATE` — architect acceptance remains external to this
task.

## A. Preflight

- Starting R2: `bf39bba6ed1a7eb590df0db91bbd450673634ee9`
- Starting R2 tree: `45c7cb950d6564fc747e5e8c30a8c9ec5e5b49a1`
- R2 parent / R1: `dc0069d52dfd934c2ea94f6447ce0cbf9244e12d`
- Accepted L5 ancestor: `22c5d7a33b7672f3b589382eadcfe68ef75abba7`
- Current `origin/main`: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`
- Current integration: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- Owner no-session-first docs authority: `b3cc0289780ba2590a6dfcf8a8e84059e5319594`
- R2 ancestry, R1 ancestry, and L5 ancestry verified.
- Complete R2 diff inspected. R2’s own delta was limited to
  `apps/health-runner/**` and Stream-2 documentation.
- Stream-1 overlap review found no R2 changes in the prohibited production
  paths; R3 changes remain within health-runner and Stream-2 documentation.

## B. Automatic browser-mode policy

Normal execution now creates a fresh headed, non-headless Chromium context as
the canonical observation. It does not read a manual headful environment
switch. Headless is represented only as `HEADLESS_DIAGNOSTIC` and is available
to the deterministic automatic policy for bounded diagnostic-first escalation.

When configured for diagnostic-first operation, a security checkpoint, access
block, unproven identity, or unexpected static surface causes exactly one
automatic headed attempt. A successful headed observation is authoritative and
cannot be overwritten by a headless result. If headed infrastructure cannot be
created, the result is `BROWSER_FAILURE` / `UNKNOWN` with
`headedInfrastructure=UNAVAILABLE` and `environmentLimited=true`.

The result and both safe evidence artifacts carry bounded mode metadata:
canonical mode, authoritative mode, diagnostic mode, fallback attempt/reason,
headed availability, and typed diagnostic/canonical summaries. No stealth,
fingerprint, CAPTCHA, challenge, cookie, storage-state, or authenticated
profile behavior was added.

Deterministic browser-policy coverage: 5 orchestration tests, including headed
authority over headless 403, one-shot fallback, both-mode blocking,
environment-limited headed absence, and safe mode evidence.

## C. Claude

Fresh headed Chromium reached `https://claude.ai/login` with HTTP 200 and one
same-origin redirect in the final matrix. Identity was `PROVEN`; the login
boundary was `LOGIN_REQUIRED` / `AUTH_REQUIRED`; public Health was `HEALTHY`.
The normal login-page CAPTCHA marker did not promote the expected login page to
`SECURITY_CHECKPOINT`.

Fixtures and classifier tests distinguish that page from a genuine security
challenge (`SECURITY_CHECKPOINT`, `UNKNOWN`) and fail closed on wrong origin or
missing identity. No login control was clicked and no credential was entered.

## D. Qwen

The canonical headed run reached `https://chat.qwen.ai/` with HTTP 200,
provider identity proven, hydrated Studio surface, observed composer/input,
`PUBLIC_INTERACTIVE`, and `HEALTHY`.

The automatic strategy also recognizes the official same-origin
“Current System does not Support” contour as provider-identified
`UNSUPPORTED_ENVIRONMENT` with `ENVIRONMENT_SUPPORT_BOUNDARY` and `UNKNOWN`,
not wrong-origin or generic identity failure. Deterministic tests exercise that
automatic policy path and verify that headed usable Studio wins over a
diagnostic unsupported result. The live environment exposed usable Studio, not
the divergent unsupported contour.

## E. WD-16 isolation

| Run | Repetitions | Result |
|---|---:|---|
| WD-16 alone | 20 | 20 pass |
| Full dedicated-session containing suite | 20 | adjacent Alice AD16-18 churn failure observed at repetition 5; WD-16 itself passed |
| no-session suite immediately before WD-16 | 20 ordered pairs | 20 pass |
| WD-16 immediately before no-session suite | 20 ordered pairs | 20 pass |

The full health-runner gate also reproduced the unrelated AD16-18 Alice churn
failure once. No-session code inspection found no process/global writes, no
environment mutation, no module/browser singleton mutation, no persistent
storage, and no authenticated state. Browser mode support only reads the
existing Chrome-path environment variable and uses per-probe ephemeral objects.

Classification: `PRE_EXISTING_OR_NON_REPRODUCIBLE_FLAKE` for the adjacent
Alice churn failure; WD-16 itself is not reproduced and its assertion was not
weakened or retried.

## F. Final automatic live matrix

The final run used fresh ephemeral headed Chromium under Xvfb, Chromium
`151.0.7922.34`, with no provider interaction. One later Work browser launch
hit transient local browser-resource exhaustion; it is recorded as an
environment-limited result. A separate immediate headed retry reconfirmed
ChatGPT Standard public/healthy behavior. The matrix below records the final
per-surface observations and safe evidence references were present on every
result (two references per result).

| Surface | Final origin | HTTP | Mode / fallback | Readiness | Identity | Composer / input / send | Auth | Outcome | Health |
|---|---|---:|---|---|---|---|---|---|---|
| ChatGPT Standard | `https://chatgpt.com` | 200 | headed / none | hydrated | proven | observed / observed / not expected | login required | public interactive | healthy |
| ChatGPT Work | `null` (headed launch unavailable) | — | headed attempted, environment-limited | not observed | not proven | not provable / not provable / not provable | not provable | browser failure | unknown |
| Alice | `https://alice.yandex.ru` | 200 | headed / none | hydrated | proven | observed / observed / observed | login required | public interactive | healthy |
| DeepSeek | `https://chat.deepseek.com` | 202 | headed / none | static landing | not proven | not provable / not provable / not provable | not provable | identity not proven | unknown |
| Grok | `https://grok.com` | 200 | headed / none | hydrated | proven | observed / observed / observed | not required | public interactive | healthy |
| Claude | `https://claude.ai` (`/login`) | 200 | headed / none | security-marked login surface | proven | not provable / not provable / not provable | login required | auth required | healthy |
| Gemini | `https://gemini.google.com` | 200 | headed / none | hydrated | proven | observed / observed / not expected | login required | public interactive | healthy |
| Qwen | `https://chat.qwen.ai` | 200 | headed / none | hydrated | proven | observed / observed / not expected | not required | public interactive | healthy |
| Kimi | `https://www.kimi.com` | 200 | headed / none | hydrated | proven | observed / observed / not expected | not required | public interactive | healthy |

ChatGPT Work remains strictly `NOT_OBSERVABLE_WITHOUT_SESSION` when its
provider marker is absent; Standard is never used to infer Work. DeepSeek is
not forced past its truthful same-origin static/202 response.

## G. Tests and gates

- Focused/full health-runner deterministic suite: no-session 66/66; latest full
  suite 269/269. Earlier repeated full-suite runs recorded the adjacent
  AD16-18 churn failure; WD-16 isolation and ordered matrices above are green.
- `@product/health`: 57/57.
- Health-runner typecheck: pass.
- Recursive workspace typecheck: pass, 34 projects.
- Health-runner build: pass.
- Lint: pass.
- Format check: pass.
- Documentation check: pass.
- Bridge/repository guard: pass.
- `git diff --check`: pass.
- No DB/persistence code changed; PostgreSQL was not required.

## H. Privacy and no interaction

All runs were passive navigation and structural observation only. No typing,
clicking, Send, prompt submission, login, OTP, CAPTCHA solving, challenge
bypass, model selection, or conversation creation occurred. Persisted evidence
remains limited to `SAFE_ELEMENT_METADATA` and `STATE_TRANSITION_TRACE` with
sanitized origins, bounded enums/counts, hashes, and mode metadata. No raw DOM,
HTML, screenshot, accessibility tree, arbitrary page text, cookies,
storageState, auth headers, or private content was retained.

## I. Git/publication

R3 is a separate commit based on R2. No force push, merge, history rewrite, or
PR mutation was performed. Remote publication/readback is attempted after the
commit; if credentials are unavailable it remains `ENVIRONMENT_DEFERRED`.

## J. Deferred ledger

- Architect acceptance of S2-L5A remains external.
- Adjacent pre-existing/non-reproducible Alice AD16-18 churn remains recorded;
  no unrelated dedicated-session code was changed.
- A transient local headed browser-resource launch limitation affected one
  Work row in the final all-nine run; the result is explicitly environment
  limited and not treated as provider failure.
- No S2-L5B, S2-L6, API-watch, scheduler, incident, authenticated-session,
  production adapter, or Stream-1 work was started.

## K. Verdict

`IMPLEMENTED_CANDIDATE` — not self-accepted.

## L. S2-L5A readiness

The implementation and deterministic acceptance criteria are satisfied within
the bounded Stream-2 scope, with the two explicitly recorded environment/test
limitations above. Recommend architect acceptance of S2-L5A after review of
those recorded limitations. Do not begin S2-L5B until the architect explicitly
accepts S2-L5A.
