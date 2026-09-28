# B19 monitor profile repair approval/admission — 2026-09-28

Status: **SOURCE / DISPOSABLE POSTGRESQL VALIDATED CANDIDATE — NOT LIVE / NOT OWNER-TEST MUTATION**

Task: `B19_REPAIR_APPROVAL_ADMISSION`.

## Authority and dependency

- controller repair-approval authority was frozen in shared source and is present in this branch through:
  - `9b24eaff` — exact manual repair approval/binding contract;
  - `1aa70e2b` — deployment-environment + browser-version binding follow-up.
- B does not edit the shared contract/health helper in this candidate.
- B19 depends on the accepted B18 bounded-retention lineage through migration `0052_monitoring_bounded_retention`; B19 itself adds `0053_monitor_profile_repair_admission`.
- No live database migration, owner-test mutation, browser action, provider call, profile publish, assignment rollout, Telegram send or deployment was performed.

## DB authority

Migration `0053_monitor_profile_repair_admission` adds:

1. immutable `monitor_profile_repair_bindings`
   - exact repair case/revision + binding SHA;
   - active incident/scope;
   - current normalized observation identity;
   - accepted baseline and rollback health runs/profile revisions;
   - exact candidate revision;
   - deployment environment;
   - extension/browser/source/tree/package identity;
   - suite/H4/evidence/matrix/results hashes;
   - exact assignment revision + initial rollout percentage.

2. immutable/non-renewing `monitor_profile_repair_decisions`
   - principal-scoped idempotency;
   - APPROVED/REJECTED decision;
   - manual checklist hash;
   - bounded issued/expires timestamps;
   - monotonic one-way revocation only.

3. one-shot `monitor_profile_repair_operations`
   - approval + INITIAL_ROLLOUT unique receipt;
   - transaction id and actor;
   - IN_PROGRESS -> COMMITTED only once;
   - committed profile + assignment revision/result for lost-response replay.

DB triggers close old-path bypass:
- a registered repair candidate cannot be published through the ordinary P7 publish path without the current admitted operation in the same transaction;
- a registered repair candidate cannot be exposed through ordinary assignment inserts;
- exact safety pause remains available;
- arbitrary percentage increase/resume/completion/direct-target changes remain blocked;
- exact pre-bound rollback remains available as an exposure-reducing safety action.

P7 lifecycle helpers were extracted as transaction-local functions so B19 can publish candidate + append initial rollout revision atomically inside one DB transaction without creating a second profile/assignment lifecycle.

## Repository admission

`createMonitorProfileRepairAdmissionRepository`:

- requires a trusted evidence resolver; there is no allow-without-evidence path;
- reconstructs the current binding from locked DB authority rather than trusting caller-supplied “current” fields;
- locks candidate/baseline/rollback revisions and assignment authority;
- verifies the active incident and exact observation relationship;
- checks current compact NO_SESSION state and rejects UNKNOWN/current-state drift;
- validates accepted baseline/rollback health and exact profile content hashes;
- validates suite definition and H4 phase/provider/surface/target/probe-layer/result/browser/environment;
- validates exact assignment CAS revision and browser/profile hierarchy;
- re-checks external installed-behavior/matrix/results/package/source/browser evidence on REGISTER and APPLY;
- requires current `ai.profile.manage` and `ai.assignment.manage` permissions;
- uses server-side post-lock time for approval expiry;
- keeps decision replay idempotent without extending expiry;
- serializes concurrent APPLY; a committed operation replays the same result and does not append a duplicate assignment revision.

B18 GC treats registered repair binding evidence as `REPAIR_APPROVAL_PINNED`.

## Disposable PostgreSQL acceptance

Pinned Node `24.20.0`, pnpm `10.34.5`.

Primary B19 admission:
- `packages/server/db/src/monitor-profile-repair-admission.integration.test.ts`: **9/9 PASS**;
- supervisor `octoport-test-b-d1b58881d2f34c3eb5daf2f9c644ad4e.service`;
- exit 0, peak ~503 MiB, cleanup verified.
- proves immutable exact registration/conflict rejection, evidence-resolver requirement, non-renewing decision replay, permission loss, concurrent apply/lost-response replay, old P7 bypass closure across another browser scope, exact pause/rollback, matrix/current-observation/H4 drift rejection, revocation, post-lock expiry, and B18 GC pinning.

The discarded setup runs before the final 9/9 result failed only because the test fixture initially inserted non-DRAFT P7 revisions and later reused an existing default assignment scope / exceeded one combined drift-test timeout. Those fixture defects were corrected through the real P7 lifecycle and distinct scope; they are not acceptance evidence.

Serial migration/P7 regression:
- supervisor `octoport-test-b-9ea9c582c05f4f4eb8c9083b61fa1ef1.service`;
- exit 0, peak ~550 MiB, cleanup verified;
- sequentially PASS:
  - fresh PostgreSQL migration/idempotency;
  - adapter registry;
  - canonical lineage upgrades to current `0053`;
  - real C blocker files `p2-auth`, `p5-7-p5-final-acceptance`, `p6-1-admin-security`;
  - P7 lifecycle;
  - P7.2 correction/concurrency.
- current journal assertions are intentionally `42 / 0053_monitor_profile_repair_admission / 1790071020000`; historical 0051->0052 fixtures and STORE 0.2.6 migration51 authority are not rewritten.

Quality:
- supervisor `octoport-test-b-56013d066d664343b044b8320111db9a.service`;
- DB typecheck PASS;
- DB unit tests PASS;
- targeted ESLint PASS;
- targeted Prettier PASS;
- `git diff --check` PASS;
- exit 0, peak ~752 MiB, cleanup verified.

## Boundaries

- This is DB/source authority only.
- It does not authorize a repair automatically.
- It does not generate candidate profile content.
- It does not replace C proof producers for installed behavior/package/matrix/results.
- It does not bypass manual checklist/approval.
- It does not authorize intermediate rollout percentage changes under the initial approval.
- It does not mutate a live/product DB or activate monitoring repair in owner-test/production.
- Owner preauthorization for prepared owner-test flow remains a separate deployment/execution authority; C/controller must still integrate and accept this exact source boundary before using it.
