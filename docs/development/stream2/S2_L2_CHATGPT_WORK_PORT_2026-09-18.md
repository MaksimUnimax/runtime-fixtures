# S2-L2 ChatGPT Work H3 port — 2026-09-18

WORK_ID: `S2_L2_CHATGPT_WORK_ACCEPTED_AUTHORITY_PORT_2026-09-18_R5`

Outcome: `CHATGPT_WORK_CURRENT_INTEGRATION_NONLIVE_CANDIDATE`

This bounded record covers the non-live generic Work H3 port onto the accepted
Stream-2 Standard/dedicated-session line. It does not claim architect
acceptance, live ChatGPT reachability, authenticated Work capability, or a
dedicated Work session.

## Lineage and authority

- Exact parent/base: `fdf8e7049a764fb188fc72d6e63e5ececefcaba4`
  (`fix(health): bind dedicated session to validated state snapshot`).
- Working branch: `feature/stream2-health-l2-work-port-2026-09-18`.
- Re-verified integration remote:
  `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
  (`origin/integration/i1-c1-srv5-2026-09-16`).
- Re-verified historical Health remote:
  `d4bae8752c304cd49cf5c0f4ef2b5d44281d0f95`
  (`origin/feature/server-health-h3-p8-4`). It was not used as a source.
- Accepted B4 authority: `53419eb57cc222254e14b5dc273a37249487331c` and
  `docs/server/B4_CHATGPT_WORK_H3_EVIDENCE_2026-09-15.md`.
- Accepted B6 source state: `697eea7adc337e1f11def16818829c2e443efb15`.
  B6 corrections were used for Work behavior; B7A code from the historical
  Health branch was not taken.

## Reconciliation before editing

| Classification | Reconciled paths/decision |
| --- | --- |
| `BYTE_EQUAL_ACCEPTED_SHARED_ALREADY_PRESENT` | `h3-contracts.ts`, `h3-actions.ts`, `h3-strategy.ts`, evidence sanitization, H3 persistence, and the existing Standard profile/fixture authority already carried the accepted contract vocabulary. |
| `WORK_FILE_TO_PORT` | `work-h3-profile.ts`, `work-h3-profile.test.ts`, `work-h3-strategy.ts`, `health-work-h3.spec.ts`, and `health-work-h3-fixture.ts` were ported from accepted B6. |
| `SHARED_FILE_TO_EXTEND` | `browser-driver.ts`, `target-registry.ts`, `target-registry.test.ts`, `h3-engine.ts`, `h3-engine.test.ts`, and `index.ts` were extended semantically; newer R2–R4 changes were retained. |
| `STANDARD_SECURITY_MUST_PRESERVE` | Standard Work-marker isolation, exact Standard strategy/profile behavior, target checks, navigation defense, and one-send engine invariants were preserved. |
| `STANDARD_DEDICATED_SECURITY_MUST_PRESERVE` | Dedicated session files were not broadened. The WeakMap capability, in-memory trusted snapshot, Standard-only target filter, no Work config key, and no Work authenticated factory remain intact. |
| `B7A_NOT_ALLOWED` | No authenticated Work loader, storage binding, Work start URL, or B7A implementation was ported. |
| `NOT_REQUIRED` | No database, migration, product runtime, extension, persistence schema, provider, or live-session change was needed. |

An internal, non-public packaged-strategy capability fence was added so a
forged same-profile/target strategy cannot execute. Only the Standard and Work
factories mark strategies as packaged; test doubles explicitly mark themselves
as test authority, and an unmarked forged double is rejected before action.

## Required RED evidence on the exact parent

Executed before Work files were restored, with Node 24/pnpm 10.34.5:

```text
pnpm --filter @product/health-runner exec vitest run src/h3-engine.test.ts -t 'unported Work'
=> PASS: the parent test proved CHATGPT_WORK was rejected with STRATEGY_NOT_REGISTERED;
   no prompt insertion or Send occurred.

test ! -e apps/health-runner/src/work-h3-profile.ts &&
test ! -e apps/health-runner/src/work-h3-strategy.ts
=> W-RED-02 PASS: Work profile/strategy implementation absent.

! rg -q 'createPackagedWorkH3TargetRegistry' apps/health-runner/src/target-registry.ts
=> W-RED-03 PASS: packaged Work target factory absent.

! rg -q 'createChatGPTWorkH3Strategy' apps/health-runner/src/browser-driver.ts
=> W-RED-04 PASS: generic driver could not construct Work; no deterministic
   accepted nine-step Work fixture/spec existed.
```

The initial unwrapped shell invocation also exposed the host `/usr/bin/node`
12.22.9; it was not treated as evidence. All validation below used the
repository Node 24 wrapper.

## Implementation

The port restores the exact accepted Work identity and semantics:

- `CHATGPT_WORK`, `CHATGPT_WORK_H3_V1`, revision `1`, `ru-RU`, origin
  `https://chatgpt.com`, exact marker `Работа`, and bounded synthetic
  project/conversation route authority.
- Marker ownership excludes assistant/user content, composer/editor/code
  content; zero or duplicate eligible visible markers fail closed.
- Route/project/conversation identity is supporting ownership, not Work proof;
  route drift and canonical conflicts fail closed.
- Composer, localized Send/Stop/busy signals, associated assistant message ID,
  completion, code-local token, code-local native Copy, and Work-composer
  delivery ownership are all checked.
- The fixed nine-step order is preserved with one irreversible Send, no Enter
  fallback, no retry/resend, observation-only Stop, and fail-closed completion.
- Generic packaged targets now include separate Standard and Work factories and
  a combined `createPackagedH3TargetRegistry`.
- `ChromeBrowserDriver` can create Work only from the active generic Work
  target. `createDedicatedHealthChromeBrowserDriver` remains Standard-only and
  cannot resolve/open `chatgpt_work_health`.
- Public exports restore Work profile helpers, Work strategy factory, and
  generic Work target factories only. No Work dedicated-session API is exported.

No model name, picker interaction, model switching, fallback model, auth
material, provider call, or live ChatGPT action was introduced.

## Deterministic evidence

Final Work Chromium command:

```text
pnpm exec playwright test tests/e2e/server/health-work-h3.spec.ts
  --config=tests/e2e/server/playwright-work-h3.config.ts
=> 42 passed (1.4m)
```

The temporary no-webserver config was removed after the run. The B6 fixture
uses only synthetic route identifiers and local loopback HTTP; it has no real
account, project, conversation, cookies, storage state, or provider path.

W01–W30 mapping to the final fixture/spec:

| IDs | Evidence |
| --- | --- |
| W01–W05 | `MISSING_WORK_MARKER`, `NO_ROUTE_SHAPE`, `AMBIGUOUS_WORK_MARKER`, `STANDARD_SURFACE`, `WORK_MARKER_CONTENT_ONLY`, `VALID_WORK_MARKER_PLUS_MESSAGE_TEXT_WORK`. |
| W06–W09 | `AMBIGUOUS_WORK_MARKER`, `STANDARD_SURFACE`, `MISSING_COMPOSER`, `AMBIGUOUS_COMPOSER`, `WRONG_COMPOSER_NAME`, `DISABLED_INPUT`, `MISSING_SEND`, `AMBIGUOUS_SEND`. |
| W10–W14 | `VALID`, `TEXT_PRESENT_GENERATING`, `STOP_SEND_CONFUSION`; the spec asserts one Send and no resend across every post-Send failure. No Enter path exists in the Work strategy. |
| W15–W20 | busy transition, associated response, stable route/canonical identity, `PROJECT_ROUTE_MUTATION`, `CONVERSATION_MUTATION`, `COMPLETION_MISSING`, `RESPONSE_SELF_BUSY_STUCK`, `STOP_CLEARS_BUT_OTHER_BUSY_REMAINS`, `BUSY_CLEARS_BUT_STOP_REMAINS`, `EMPTY_RESPONSE_AFTER_GENERATION`. |
| W21–W25 | `CODE_BLOCK_MISSING`, `NATIVE_COPY_MISSING`, `NATIVE_COPY_MISMATCHED`, `RESPONSE_COPY_ONLY_WITH_CODE`, `TABLE_COPY_ONLY_WITH_CODE`, `DELIVERY_MISSING`, plus the valid code-local Copy case. |
| W26–W27 | `LOGIN_EXPIRED`, `CAPTCHA_CHECKPOINT`, `VERIFICATION_CHECKPOINT`, `ACCOUNT_BLOCKED` produce environment uncertainty and no Send. |
| W28–W30 | source guards and result assertions exclude route IDs, prompt/response/DOM content; loopback fixture proves no provider/live call and no persisted raw browser state. |

## Regression evidence

- Work unit/profile/engine/registry focused tests: 56/56 passed.
- Complete health-runner unit suite: 120/120 passed.
- Work Chromium deterministic matrix: 42/42 passed.
- Standard Chromium, dedicated Standard Chromium, and H2 Chromium: 53/53
  passed in `playwright-dedicated-session.config.ts`.
- Dedicated Standard negatives include forged registry, powerless constructor
  injection, in-memory snapshot binding, no writeback, no Work config key,
  factory rejection of Work, and `open("chatgpt_work_health")` rejection.
- Standard/Work mismatch proof: Standard+Standard and Work+Work pass;
  Standard+Work and Work+Standard fail before Send; ordinary Standard message
  text `Работа` remains valid; positive Work marker under Standard fails.

## Boundary and deferred ledger

`S2-L2-CHATGPT-STANDARD-LIVE-001` remains `OWNER_DEFERRED_TEST` and was not
resolved. The required next dependency is recorded as:

`S2-L2-WORK-DEDICATED-SESSION-001` — `NOT_STARTED / REQUIRED_BEFORE_LIVE`.

No live Standard or Work test was run. No Work authenticated session support,
Alice, P8.5, merge, or product runtime change was started. Stream 1 paths were
not modified.

## Validation and audit

The final gate results are recorded in the terminal report accompanying this
document. No persistence code or schema changed, so PostgreSQL was not run for
activity. The final source audit classified existing dedicated Standard
`storageState` handling and the fixed packaged prompt as pre-existing/allowed;
no new `storageStatePath`, `userDataDir`, `launchPersistentContext`, cookies,
authorization, token, password, or Work auth material was added. Work production
code does not persist real IDs, raw DOM, screenshots, prompts, responses, or
clipboard data.

Publication credentials were not exercised in this bounded worktree; no push
was attempted.
