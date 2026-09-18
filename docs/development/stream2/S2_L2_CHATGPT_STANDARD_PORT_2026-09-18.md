# S2-L2 R1 — ChatGPT Standard non-live H3 port

Work ID: S2_L2_CHATGPT_STANDARD_ACCEPTED_AUTHORITY_PORT_2026-09-18_R1
Repository: MaksimUnimax/runtime-fixtures
Branch: feature/stream2-health-l2-standard-port-2026-09-18

## Boundary

This candidate ports the accepted non-live ChatGPT Standard H3 authority onto
the current integration line. It does not claim live ChatGPT acceptance,
dedicated authenticated sessions, Work execution, B7A, P8.4 full acceptance,
P8.5, scheduling, or monitoring readiness.

The required sequence remains the immutable packaged order:

IDENTIFY_SURFACE → IDENTIFY_COMPOSER → INSERT_PROMPT → SEND_ONCE →
OBSERVE_BUSY → OBSERVE_RESPONSE → OBSERVE_COMPLETION →
VALIDATE_BRIDGE_SURFACES → CLEANUP.

## Authority and dependency closure

Product base: origin/integration/i1-c1-srv5-2026-09-16 at
23047b3bdc22842a5b17e29e3d3f603c0ee51b16.

Accepted Health source refs used:

- B1 f11b21392ae5543356cde0803d1b53591376f5a1
- B2 0474d83e27074f9f61a41efd13e916d2ab75d20c
- B3 accepted Standard lineage through c3662cac0b88f46a5b01f5fbc488578e82983046,
  with exact accepted implementation blobs from B6
- B5 bf3c27a817c7e4698f539ff5cacc1db73c833710
- B6 697eea7adc337e1f11def16818829c2e443efb15

The Health branch tip d4bae8752c304cd49ef5c0f4ef2b5d44281d0f95 was
source reference only; it was not merged or rebased.

| Classification | Paths/decision |
| --- | --- |
| PORT_STANDARD_REQUIRED | Standard profile/strategy/tests, Standard Chromium spec/fixture, Standard BrowserDriver factory, Standard target registry/test |
| PORT_SHARED_REQUIRED | B1 actions/tests; B2 strategy/engine/tests; B5 H3 persistence mapper/tests; sanitizer; public health-runner exports; H3 contract test observation update |
| PORT_SHARED_REQUIRED (minimal isolation) | standard-work-isolation.ts: only the accepted positive Work-marker predicate needed for Standard fail-closed isolation |
| ALREADY_PRESENT_EQUIVALENT | h3-contracts.ts, H2 implementation/tests, packages/server/health/**, health-runner package/toolchain dependencies |
| OVERLAP_REQUIRES_RECONCILIATION | packages/server/db/src/health-persistence.integration.test.ts; three-way result below |
| WORK_ONLY_NOT_PORTED | work-h3-profile.ts, work-h3-strategy.ts, Work fixture/spec and Work-only target registry helpers |
| B7A_NOT_ACCEPTED | Dedicated session registry, storageState loading/configuration, dedicated Work route/session provenance, and dedicated driver factory |
| EVIDENCE_ONLY / NOT_REQUIRED | B1–B6 historical evidence files, unrelated B6 integration/Stream-1 changes, migrations, contracts, production adapters |

The distinct CHATGPT_STANDARD/CHATGPT_WORK contract identities remain
in shared H3 schemas/action metadata. No Work strategy or executable Work
monitor is exposed.

## RED-first result

Before the port, the integration worktree had no accepted Standard action
compiler, H3 engine, Standard profile/strategy, H3 persistence mapper, or
Standard fixture/spec. The focused probe
pnpm --filter @product/health-runner exec vitest run
src/standard-h3-profile.test.ts returned “No test files found” after the
locked dependencies were installed. The initial unprefixed probe also exposed
the old Node 12 PATH; all acceptance checks below use Node 24.21.0 and pnpm
10.34.5.

## Persistence reconciliation

Common base: de41f33646d5dd61bcae66624225e16538fd8f3a.

- Integration-only: migration reset/re-run in beforeAll, retained.
- Health-only: B5 fixture IDs/scope binding and the UUID-per-retry test,
  retained.
- Identical: all existing suite revision, classifier, rollback, evidence,
  immutability, and incident constraint assertions, retained.
- Conflict: none.
- Result: accepted B6 Health semantics plus the integration migration
  isolation behavior; no production DB semantic, schema, or migration change.

The DB fixture now proves both the integration reset path and the Health
random completed-run IDs. Isolated PostgreSQL results were 39/39 passed.

## Green evidence

- Health-runner focused unit/security: 103/103 passed across H2, H3 contracts,
  packaged actions, engine, persistence mapper, Standard profile, and target
  registry.
- Health-runner typecheck: PASS.
- Health-runner build: PASS.
- Root recursive typecheck: PASS.
- Lint and Bridge guard: PASS.
- Format check: PASS.
- Standard Chromium deterministic fixture: 37/37 passed.
- H2 Chromium security regression: 13/13 passed.
- PostgreSQL H3/DB persistence: 39/39 passed.
- git diff --check: run before publication.
- Docs check: run before publication.

The Standard matrix covers packaged immutable order and safe kinds; no caller
selector/script/URL authority; one Send/no resend; bounded cleanup/timeouts;
surface/composer/input/send ownership; prompt insertion/readback; busy,
response association, completion and identity fail-closed behavior; code-local
Copy and code-block ownership; delivery path; login/verification/CAPTCHA/
blocked/browser/network uncertainty; sanitizer privacy; positive Work-surface
isolation; and zero provider calls. Work-specific tests are intentionally not
claimed.

## Security, privacy, and live boundary

All browser fixtures are synthetic loopback fixtures. No credentials, cookies,
storageState, auth headers, owner profile, private conversation, raw prompt,
raw response, raw DOM, screenshot, marketplace secret, or provider call was
used or persisted. The BrowserDriver remains fresh
chromium.launch() → browser.newContext() with ephemeral cleanup.

Provider/live ChatGPT calls: 0. Marketplace calls: 0. Customer-session reuse:
false. B7A: not started. The fixed benign health prompt exists only as
code-owned fixture input; persisted output is bounded Health metadata/evidence.

Deferred ledger item:
OWNER_DEFERRED_TEST / S2-L2-CHATGPT-STANDARD-LIVE-001, to be considered
only after dedicated authenticated Health-session capability is separately
accepted.

## Stream 1 and publication

No files under apps/extension/**, packages/bridge-core/**,
packages/control-client/**, packages/ai-adapters/**, or
packages/marketplaces/** were changed. No auth/bootstrap/session,
migration, contract, production adapter, Work lifecycle, or I1/C2 execution
authority was changed.

Before publication, integration refetch/recheck is required. This local
candidate is not published and does not constitute architect acceptance.

Bounded verdict:
CURRENT_INTEGRATION_STANDARD_H3_NONLIVE_PORTED_CANDIDATE.

Next bounded S2-L2 slice:
accept the dedicated authenticated Health-session mechanism, then separately
run the owner-deferred live Standard test. Do not start Work, Alice, B7A, or
P8.5 in this slice.
