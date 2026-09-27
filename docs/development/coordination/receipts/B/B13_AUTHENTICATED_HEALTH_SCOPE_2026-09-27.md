# B13 authenticated-deep Health scope resolver — 2026-09-27

Status: **SOURCE / DISPOSABLE POSTGRESQL VALIDATED CANDIDATE — NOT LIVE / NOT DEPLOYED**

Assignment: `B13_AUTHENTICATED_HEALTH_SCOPE`.

## Consumer boundary

Current C04 authenticated-deep runtime expects an injected `AuthenticatedDeepPersistenceContextResolver` before any H3 prompt send. B13 provides the DB-owned read model needed for that composition without importing or depending on `apps/telegram-operator`.

The new `createHealthAuthenticatedDeepScopeRepository()` returns a validated `@product/health` `HealthScope`. C remains responsible for composing the `HealthSuiteDefinition` and for runtime-only values:

- actual controlled browser/session metadata;
- actual browser version;
- extension and adapter-engine versions selected for that run;
- actual `startedAt` / `completedAt`;
- classifier version;
- Health suite machine key/revision and final H3 persistence context.

B does not guess those values.

## Frozen packaged-to-P7 identity

The resolver uses the existing packaged H3 identities already exercised by the repository's H3 integration coverage:

| Surface | H3 target | Packaged profile | P7 profile key | Required P7 revision |
|---|---|---|---|---:|
| ChatGPT Standard | `chatgpt_standard_health` | `CHATGPT_STANDARD_H3_V2` | `standard-h3` | 2 |
| ChatGPT Work | `chatgpt_work_health` | `CHATGPT_WORK_H3_V1` | `work-h3` | 1 |

Both use P7 adapter `chatgpt`, surfaces `standard` / `work`, and `variant = NULL`.

No NO_SESSION profile/suite is reused to satisfy H3 foreign keys.

## Fail-closed DB authority

Before C can run H3, the DB resolver requires:

- exactly one ACTIVE `chatgpt` adapter;
- exactly one ACTIVE requested surface;
- exactly one ACTIVE dedicated H3 profile with the expected hierarchy and no variant;
- PUBLISHED profile revision(s) with valid `adapter_profile_v1` content/fingerprint;
- compatibility with the actual browser family/version and extension version supplied by C;
- exactly one compatible PUBLISHED revision;
- the exact packaged revision number (`2` Standard, `1` Work).

Missing, inactive, ambiguous, hierarchy-conflicting, incompatible, corrupt, or wrong packaged revision authority rejects resolution. The resolver performs reads only.

## Disposable PostgreSQL evidence

Pinned toolchain: Node 24.20.0 / pnpm 10.34.5.

Focused source checks:

- `@product/db` typecheck: PASS;
- ESLint on new resolver/export/integration test: PASS;
- Prettier: PASS;
- `git diff --check`: PASS.

Disposable PostgreSQL integration:

- supervisor: `octoport-test-b-81dbddcd17524f4d9c27ce0995a231db.service`;
- **4/4 PASS**;
- peak: 398 MiB;
- cgroup cleanup verified.

The test proves:

1. an empty catalog returns `AUTHENTICATED_DEEP_PROVIDER_AUTHORITY_NOT_FOUND` and remains at zero adapters/surfaces/profiles/revisions;
2. Standard resolves to distinct `standard-h3` revision 2 and Work resolves to distinct `work-h3` revision 1;
3. inactive profile, incompatible browser family, multiple compatible PUBLISHED revisions, and a single wrong packaged revision all fail closed;
4. a synthetic Standard H3 failure using the resolved scope persists with a real `scheduledRunId`, reaches the existing incident processor, opens one LLM Health incident and creates one `INCIDENT_OPENED` notification intent.

Synthetic evidence is not browser/live evidence and contains no provider response bytes.

## Provisioning boundary still open

B12 provisions only the nine NO_SESSION authorities. It must not be broadened into a universal catalog checker.

If the isolated monitor-pilot DB lacks `standard-h3@2` / `work-h3@1`, B must provide a separate explicit idempotent pilot-only initializer using existing P7 registry/profile lifecycle authority. It must preserve all nine NO_SESSION identities/history, reject conflicts, and must not fabricate a Standard revision 1 merely to obtain revision 2.

No protected pilot DB, production DB, browser session, Telegram delivery, provider network, or live catalog was accessed or mutated by this slice.
