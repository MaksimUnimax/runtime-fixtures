# B12 monitor pilot authority provisioning — 2026-09-27

Status: **SOURCE / DISPOSABLE POSTGRESQL VALIDATED CANDIDATE — NOT LIVE-APPLIED**

Controller assignment: `MONITOR-PILOT-PROVISIONING-20260927-1130`.

## Exact problem closed

The first isolated monitor-pilot cycle had nine terminal scheduled failures with no persisted health runs. The dedicated pilot catalog was empty. The existing no-session persistence resolver checks `ai_adapters` first, so the precise root authority error for every affected target is:

`NO_SESSION_PROVIDER_AUTHORITY_NOT_FOUND`

The runtime subsequently maps deterministic persistence errors to the coarser scheduled-run failure `NO_SESSION_PERSISTENCE_REJECTED`. B12 adds a read-only authority preflight so this exact missing/inactive/ambiguous authority is reported before any browser/probe execution.

B did not read or print `/etc/octoport-monitor/pilot.env` or any connection secret.

## Frozen source / manifest authority

Pilot provisioning is bound to deployed monitor source:

`69db39e795010d0f9acfc9ffcaef76b38f5f59b3`

The deployed and current blobs for:

- `apps/health-runner/src/no-session-target-authority.ts`;
- `apps/health-runner/src/no-session-strategies.ts`;

were verified byte-identical before implementation.

The canonical nine-target target+strategy manifest is pinned by SHA-256:

`01665888b04717b99ff5564f3e2eaf1f389249dae7cef83c5aa75d79d81ace7e`

Any source/manifest drift fails before writes.

## Database boundary

Production CLI operations are hard-bound to database name:

`octoport_monitor_pilot`

and require an explicit expected database role. Both `current_database()` and `current_user` are checked before catalog inspection or mutation. Connection values never appear in output or errors.

A `VITEST`-gated test-only API permits disposable test database names. It is not available to the production CLI path.

No product schema or migration changed.

## Catalog and lifecycle behavior

Initialization accepts only:

1. a completely empty adapter/profile catalog; or
2. the exact already-provisioned nine-target state.

Any count conflict, disabled authority, ambiguous identity/revision, wrong profile content, wrong DB/role or source drift fails before provisioning writes.

Catalog identities are created only through the existing P7 registry command repository. Profile revisions are created only through the existing profile lifecycle repository with the normal mutation-authorization hook.

Each target gets:

- ACTIVE provider adapter;
- ACTIVE surface (`standard` / `work` for ChatGPT, lowercase surface identity otherwise);
- ACTIVE profile keyed by the exact no-session `strategyId`;
- no variant;
- exactly one Chrome-compatible PUBLISHED revision.

Profile revision content is a valid `adapter_profile_v1` authority record derived from the target's current capability expectations. Existing `validateProfileContent` computes the canonical fingerprint. Lifecycle is exactly:

`DRAFT -> CANDIDATE -> PUBLISHED`

The profile content is an authority/catalog anchor. Actual no-session CSS selector behavior remains owned by the frozen `NO_SESSION_STRATEGIES` source and is independently included in the manifest fingerprint; B12 does not invent a second selector runtime.

There are no direct `INSERT` / `UPDATE` / `DELETE` mutations to:

- `ai_adapters`;
- `ai_surfaces`;
- `ai_variants`;
- `adapter_profiles`;
- `adapter_profile_revisions`

inside the initializer.

## Narrow bootstrap authority

A pristine isolated pilot DB has no ordinary admin principal, while existing P7 registry commands correctly require `ai.registry.manage` / `ai.profile.manage`.

B12 therefore uses a bounded technical bootstrap only when:

- the catalog is empty;
- database name and role are exact;
- there is no active admin role grant.

The full operation runs inside one outer PostgreSQL transaction under an advisory lock:

1. create a technical user/principal;
2. temporarily grant existing `ADMIN_OPS`;
3. execute all P7 registry and profile lifecycle operations;
4. run post-write authority preflight;
5. revoke the temporary grant;
6. suspend the technical principal and technical user;
7. record safe audit events;
8. commit.

P7 repositories receive a transaction-scoped runtime, so their normal nested transactions remain in the same outer transaction.

If any step fails, PostgreSQL rolls back the entire catalog change and the temporary authority together. No reusable global bypass is introduced. On success there is no active temporary grant, principal or technical user.

An exact rerun returns `ALREADY_EXACT` and does not create new catalog revisions or audit rows.

No owner account, email identity, OTP, portal session, marketplace credential, beta policy, commercial config, profile assignment or extension assignment is used.

## Preflight output

Safe target-key diagnostics distinguish:

- provider missing/inactive/ambiguous;
- surface missing/inactive/ambiguous;
- profile missing/inactive/ambiguous;
- unexpected variant binding;
- published Chrome revision missing/ambiguous;
- profile-content mismatch.

Where the existing persistence resolver already defines the condition, B12 uses its exact `NO_SESSION_*_AUTHORITY_*` code, including the current empty-catalog root cause.

The initializer itself performs no network request, browser launch or prompt send.

## Disposable integration evidence

The integration test migrates a clean B disposable PostgreSQL database and proves:

- empty catalog preflight returns exact `NO_SESSION_PROVIDER_AUTHORITY_NOT_FOUND` before a probe spy can run;
- production path rejects the disposable DB name;
- expected-role mismatch and source-manifest drift fail without writes;
- forced mid-provision failure rolls back all catalog, audit, technical user, principal and grant state to zero;
- initialization creates exactly 8 adapters / 9 surfaces / 9 profiles / 9 published revisions / 0 variants;
- after successful initialization there are zero active temporary grants, principals and technical users;
- exact rerun is idempotent;
- disabled authority, ambiguous published revision and wrong profile content fail closed without initializer writes;
- one explicitly synthetic BROKEN probe runs through the real existing `executeScheduledNoSessionHealthRun` plus `createHealthNoSessionCompletionAdapter`;
- one health run is persisted with the exact provider/surface/strategy/profile binding;
- the real incident path opens one incident and creates one notification intent.

Historical failed live pilot rows are not modified.

## Parent verification

Toolchain: Node 24.20.0, pnpm 10.34.5.

- Manifest unit: **2/2 PASS**, supervisor `octoport-test-b-a6bb980ce9cd4baca773c59e54d3b4e0.service`.
- B12 tooling targeted TypeScript: **PASS**, supervisor `octoport-test-b-f3289853819040ca958a8b01572cb7e5.service`.
- Telegram-operator project typecheck: **PASS**, supervisor `octoport-test-b-179f59a41dff45cfafdc3870fa7bab64.service`.
- Disposable PostgreSQL B12 integration: **3/3 PASS**, supervisor `octoport-test-b-894fb993a8d545ecabac73cd25342f92.service`.

One earlier PostgreSQL run exposed an invalid synthetic observation fixture; the fixture was corrected to the existing no-session schema and the exact parent run passed 3/3. An earlier telegram-operator typecheck exposed a missing workspace symlink in the local install; `pnpm install --offline --frozen-lockfile` restored the declared dependency link without changing the lockfile, after which the project typecheck passed.

## Remaining operational gate

This commit does **not** initialize the protected pilot database and does **not** rerun the live monitor.

After normal C intake/acceptance, the controller owns the already-authorized isolated runtime action:

1. run the B12 read-only preflight against the protected `octoport_monitor_pilot` connection while supplying the exact intended DB role without logging it;
2. if the catalog is the expected empty state, run the explicit B12 initializer;
3. read back `READY`;
4. schedule one new real monitor cycle;
5. verify nine persisted observations/classifications and notification state.

The previous nine failed scheduled records remain historical evidence and must not be rewritten as successful.

## Controller-audit correction — CLI preflight exit status

The 2026-09-27 controller audit found one bounded gate defect in the candidate above: the production CLI printed a MISSING_AUTHORITY preflight result and then returned exit status 0 because no exception was raised.

The correction preserves the existing read-only preflight and database hard-pin:

- READY leaves exit status 0;
- any non-READY preflight result keeps the safe target-key diagnostics and sets exit status 2;
- operational/configuration exceptions still use the existing catch path and exit status 1;
- production CLI preflight is hard-pinned to octoport_monitor_pilot in every environment; no environment variable can replace that database name;
- the disposable PostgreSQL subprocess proof uses a separate integration-only entrypoint under tests/integration/server/fixtures, which calls the same production preflight-result reporting/exit-code seam with the existing VITEST-gated test preflight identity.

Fresh verification on Node 24.20.0 / pnpm 10.34.5:

- manifest unit: **2/2 PASS**;
- disposable PostgreSQL authority integration: **3/3 PASS**, supervisor octoport-test-b-6b2c8e852a0f49b0af7943f02908ace5.service, peak 593 MiB, cleanup verified;
- the integration starts a separate test-only TypeScript subprocess before provisioning and proves MISSING_AUTHORITY + exact NO_SESSION_PROVIDER_AUTHORITY_NOT_FOUND + exit 2, then starts it after provisioning and proves READY; issues=none + exit 0; both paths use the same production result-reporting/exit-code function;
- controller notice B-CLI-PREFLIGHT-PIN-20260927-1345 is addressed by removing the environment-controlled database-name override from the production CLI.
- intermediate candidate cc9d9070bdef9f8cb4266d59ba9aa91ffef9474f is superseded by this hard-pin correction and must not be integrated.

No pilot/live database was accessed or mutated by this correction.
