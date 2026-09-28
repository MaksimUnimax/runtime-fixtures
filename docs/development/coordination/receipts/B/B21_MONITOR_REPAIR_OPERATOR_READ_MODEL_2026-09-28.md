# B21 — monitor repair operator DB read model — 2026-09-28

Status: **SOURCE + DISPOSABLE POSTGRESQL CANDIDATE; NOT LIVE / NOT DEPLOYED / NO HUMAN APPROVAL FABRICATED**.

Task: `B_AUTO_REPAIR_OPERATOR_READ_MODEL` (B06 / S2).

## Existing implementation audit

Before adding code, B verified the existing read paths:

- `health-admin-read-repository.ts` exposes Health targets, incidents, evaluations and recommendations;
- `monitor-profile-repair-admission-repository.ts` exposes mutation/authority operations only: register candidate, record/revoke decision and guarded initial rollout;
- there was no bounded DB-backed list/detail projection over `monitor_profile_repair_bindings`, `monitor_profile_repair_decisions` and `monitor_profile_repair_operations`.

No new migration or shared contract is required. C owns HTTP/operator DTO/UI and authorization composition.

## Read model

New repository: `createMonitorProfileRepairReadRepository()`.

It provides:

- stable keyset case pagination by `created_at + repair_case_id + case_revision`;
- mandatory `scopeSha256` filter for list/detail isolation;
- exact binding/candidate/incident/observation/test-evidence/assignment/decision/operation identities;
- explicit case states for pending, rejected, revoked, not-yet-valid, expired, stale-approved, current-approved, apply-in-progress and applied;
- explicit staleness reasons for current observation, incident, candidate profile, suite/H4, assignment and approval-binding drift;
- exact operation-to-approval linkage after apply, even if a newer unrelated case decision is later written;
- no raw binding/request/result JSON in the returned operator projection;
- `executionAuthority: false` on every result.

The read model is descriptive only. Displayed `APPROVAL_CURRENT` is never apply authority. Existing B19 apply continues to rebuild and revalidate trusted evidence, incident state, assignment CAS, approval TTL/revocation and current binding inside the mutation transaction.

## Scope and permissions boundary

B does not add a new permission or HTTP route. Existing admin permission composition already has `health.read`, `ai.profile.read` and `ai.assignment.read`; C must enforce its chosen existing operator/admin context when integrating the DB read model.

No secrets, cookies, marketplace payload, raw customer data or provider/browser execution are involved.

Peer handoff to C was created before implementation:

`/root/octoport-control/peer-handoffs/C/B-C-REPAIR-READ-MODEL-20260928-1415.request.json`.

## Verification

Pinned toolchain: Node 24.20.0 / pnpm 10.34.5.

Light checks:

- `pnpm --filter @product/db typecheck`: PASS;
- targeted Prettier: PASS;
- targeted ESLint: PASS;
- `git diff --check`: PASS.

Disposable PostgreSQL supervisor:

`octoport-test-b-ebced2ad7e7d4d71afe8831eff8a1f9f.service`

Result:

- `monitor-profile-repair-admission.integration.test.ts`: **20/20 PASS**;
- includes 5 new read-model scenarios for stable pagination/scope isolation, current approval, expired/revoked/rejected decisions, stale current observation and applied operation identity;
- the applied regression writes a later REJECTED case decision after the committed rollout and proves the read model still reports the exact approval that authorized the operation;
- existing B19 mutation/permission/replay/lock/GC tests remain green;
- exit 0;
- peak 594 MiB;
- cleanup verified.

An earlier attempt was correctly rejected by the resource runner as `RESOURCE_WAIT/MEMORY_PRESSURE_RETRY_LATER`; it was not bypassed. The same integration profile was retried after PSI normalized.

## Handoff

C should consume the DB projection through its existing operator/admin surface, preserve current read permissions and plain-Russian presentation, and keep commands separate from reads. Real human decision/apply remains a separate gate.

No live database, production service, browser/provider call or Telegram delivery was changed by this candidate.
