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


## Adversarial review and contract disposition

Read-only Codex B review `b19-final-review-20260928-r1` inspected exact code commit
`483d8b513ef1efa834ae8c4a2a5f77ea0f229c7f` and reported two proposed
blocking findings. Parent B independently checked both against the frozen shared
contract and source:

1. **Latest observation run id must not replace the pinned triggering run.**
   The architecture explicitly states that `observation.runId` is the pinned
   triggering proof, not a cursor, and that a newer identical normalized semantic
   observation must not invalidate approval. Therefore requiring
   `health_no_session_scope_states.latest_run_id === binding.observation.runId`
   would violate the accepted contract. B19 already rechecks the newest normalized
   semantic fingerprint, rejects UNKNOWN, and requires trusted freshness.
   A dedicated PostgreSQL case now proves a newer run with the same normalized
   state remains admissible.

2. **H4 identity and exact validation-result proof are separate authorities.**
   The frozen binding contains `h4EvaluationKey` plus separate immutable
   `installedBehaviorEvidenceSha256`, `matrixSha256`, and `resultsSha256`.
   It does not define an H4 execution-id/evaluated-at/result-payload hash field.
   B19 rechecks the current DB H4 row under the bound identity and requires it to
   remain H4_CANDIDATE / COMPLETED / PASS with exact provider/surface/target,
   candidate/baseline, suite, browser and environment. Separately, the mandatory
   trusted evidence resolver must reproduce the bound installed/matrix/results
   hashes on every APPLY. B must not invent an additional shared-contract field.
   A dedicated PostgreSQL case now proves that changing exact
   `resultsSha256` fails closed.

Follow-up admission acceptance after these explicit contract cases:
- `packages/server/db/src/monitor-profile-repair-admission.integration.test.ts`:
  **11/11 PASS**;
- supervisor `octoport-test-b-3119cefaee5042f483f370993432cbc3.service`;
- exit 0, peak ~516 MiB, cleanup verified.

The first read-only review result is preserved at
`/root/octoport-control/logs/B/b19-final-review-20260928-r1-result.md`;
its proposed findings are not silently discarded. Their parent disposition above
is grounded in the frozen contract rather than a relaxed local interpretation.


## Final read-only review and lock-order hardening

Second read-only Codex B review `b19-final-review-20260928-r2` inspected exact
candidate `44aa9e0e61201cae04b743e6d037259c4c8cd2e2` with the frozen contract
semantics stated explicitly. Verdict: **REVIEW_PASS**, no blocking findings.

Its only nonblocking finding was an APPLY/REVOKE lock-order inversion:
APPLY locked the approval decision before current admin authority, while REVOKE
locked current admin authority before the decision. Although PostgreSQL would
abort one transaction rather than permit an unsafe mutation, B closed the
availability/retry hazard before handoff.

Final hardening:
- new APPLY mutations lock current admin authority before the decision row,
  matching REVOKE;
- already-COMMITTED operation replay remains read-only/idempotent and returns the
  stored result without creating a new mutation;
- a concurrent APPLY/REVOKE regression accepts either legal serialization
  (apply commits before revoke, or revoke wins and apply blocks) but rejects any
  deadlock outcome.

Final primary admission PostgreSQL acceptance:
- **12/12 PASS**;
- supervisor `octoport-test-b-e5ffe12a07c94b3aa43183a51639097b.service`;
- exit 0, peak ~530 MiB, cleanup verified.

R2 review result is preserved at
`/root/octoport-control/logs/B/b19-final-review-20260928-r2-result.md`.
