# Profile repair approval and admission boundary v1

Owner manual mode, architecture
[monitoring repair](../development/coordination/MONITORING_REPAIR_ARCHITECTURE_2026-09-28.md),
sections 6/11. This is the first profile-only contract. Code package releases
continue through the existing store package/preflight workflow.

## Implemented boundary

Contracts exports strict MonitorProfileRepairBindingV1, decision request, and
approval receipt schemas. Health exports monitorProfileRepairBindingSha256 and
checkProfileRepairApprovalBinding. The hash uses existing canonicalizeJson and
SHA-256. No new signing service, keys, endpoint, permission, database or rollout
engine is introduced by this candidate.

A binding is the compact immutable manifest: repair case/revision, incident,
scope, observed state/run, accepted baseline, exact candidate profile revision
and content hash, tested extension source/tree/package/version/browser, suite
definition/revision, H4 key, installed-behavior evidence, matrix/result hashes,
current assignment revision, one exact initial rollout percentage and an accepted
rollback reference. Referenced proofs are retained separately and pinned.

The helper returns CURRENT only when the exact current binding matches a
non-revoked APPROVED receipt within its validity interval. CURRENT proves identity
and time only. It does not verify actor permissions, test provenance, real
installation, H4/H5 success, rollback safety, or transactional publication.

The initial supported operation is publication plus one initial P7 profile rollout
on an existing assignment with a positive revision. All involved profile revisions
belong to the same profile. Later exposure changes need a refreshed binding/approval
in this first conservative boundary. This is not permission for unattended full
rollout, store-code delivery or immediate rollback of installed store packages.

## Operator action

Use the existing protected administrative session and existing ai.profile.manage /
ai.assignment.manage permissions; do not add a second account system or grant
repair/monitoring workers an operator credential. The actual manual check is
performed by the operator, never synthesized by an agent or inferred from a
Telegram read/delivery or automated test result.

The request supplies only an idempotency key, expected case revision/binding hash,
APPROVED/REJECTED and a manual checklist result/hash tied to those exact bytes.
Principal, authoritative binding, issuance/expiry timestamps and receipt identity
come from trusted server state. Reject actorId, human=true, system=true and other
extra caller fields. Approval requires PASS; an operator may reject for any reason.

The initial maximum approval lifetime is 24 hours. Same-state authority and fresh
health are still rechecked on every mutation, so the lifetime is not a permission
to ignore intervening changes. Use server time after lock acquisition. Equal-to-
expiry is expired. A shorter operational lifetime is allowed; extending this
maximum is an explicit contract change.

A retry with the same principal/idempotency key and identical body returns the
original decision/receipt and original expiry. Different body with the same key
is a conflict. Never renew approval or erase rejection merely because a client
retried. Renewed manual approval requires a new explicit operator action.

## B persistence and transaction assignment

B owns DB/schema/migrations and P7 repository guards. Implement this contract only
after its exact C handoff, preserve existing signed/profile lifecycle semantics,
and select migration numbering from fresh main.

1. Register a repair candidate and its immutable binding/proof references.
   Persist the association to the profile revision; a caller cannot bypass the
   guard by omitting a repairCaseId on the old publish/assign endpoint.
2. Store operator decisions and their audit through the protected service boundary.
   A JSON approval row or UUID by itself is not evidence of an authorized operator.
3. Before every publication/exposure-increasing assignment of a registered repair,
   lock the repair case, actual profile/assignment and required authority records
   in one documented order. Rebuild currentBinding from trusted rows; do not pass
   a client's original manifest as the current state.
4. Validate incident/scope, immutable candidate content, extension acceptance,
   suite/matrix/results and real installed behavior/H4 proof. Check current operator
   authority, profile compatibility, accepted baseline, observed semantic state,
   rollback eligibility and fresh health. UNKNOWN, public-page HTTP success,
   source tests or scheduler SUCCEEDED cannot stand in for installed behavior.
   Missing evidence resolver/producer keeps apply blocked.
5. Evaluate checkProfileRepairApprovalBinding with post-lock server time, then
   atomically compare-and-swap the exact assignment revision and intended percentage.
   Publishing a profile does not itself claim assignment or consume the separate
   initial assignment result. Assignment success stores its exact operation result.
6. A retried already-committed operation returns that stored result; do not resend
   or create another assignment because the response was lost. A conflicting
   mutation, revoked/expired approval or changed proof fails closed.
7. Cover direct publish/assign/start/percentage/resume/complete/rollback paths for
   registered repairs as applicable. Existing safety pause remains an authenticated
   restrictive operation. Do not turn pre-approved rollback references into a
   general permission to select arbitrary profiles or increase exposure.
8. Preserve narrowly authorized existing catalog provisioning as its own operation,
   without a generic SYSTEM/environment-variable bypass. Ordinary unrelated
   P7 records do not become retroactively approved repair candidates.
9. Pin active/baseline/rollback/release-linked evidence during GC. Apply the existing
   bounded case/history policy; do not archive every observation in approval rows.

Required disposable DB tests: registration/duplicate idempotency, identical retry,
changed body, changed candidate/matrix/suite/observed state, operator revocation,
expired approval after lock wait, concurrent compare-and-swap, direct endpoint
bypass attempt, commit-then-lost-response replay, and GC of unpinned evidence
without deleting an active approval or usable rollback proof.

## C service and release follow-up

C connects real proof producers, the protected manual action and B's atomic gate.
The actor completing manual acceptance must be an actual authorized operator.
Until that path exists, a valid schema/hash is only preparation, never APPROVED
or permission to deploy. No synthetic installed evidence may fill the missing
live session. Current owner-only actions remain deferred during manual mode.

The rollback reference must still be usable for the present scope. A historically
good profile that is now broken is not a valid rollback merely because it has an
old acceptance record. If no usable rollback/safe restriction exists, this profile
rollout remains blocked; an ordinary store-code repair is a separate supported
path. Do not silently invent an execution-level H5 restriction: existing H5 signals
are advisory.

After an admitted rollout, H5 and actual application readback are still required
before closing the incident or promoting the working baseline. PUBLISHED,
ASSIGNED, OBSERVED_ACTIVE and RECOVERED remain distinct states.

## Candidate verification — 2026-09-28

Base: 555452f8fa59a0006c25d164afc779569ef93c46, after the verified consumer
contract chain62da3d71 ->555452f8. No DB file is changed by this candidate.
Contracts78/78 and Health177/177 tests passed (255 total), including43 approval
binding cases. Package typechecks, changed-file ESLint/Prettier and docs passed.
The tests invalidate approval on26 distinct binding changes, check exact clock
boundaries, rejection/revocation and caller authority-field injection. They use
synthetic immutable fixtures; no real approval, actor session or publication ran.
Supervisor9f44906823824bf5b166b699310ded0a exited0, peak695 MiB, OOM0,
cleanup verified. Logs: /root/octoport-control/logs/controller/manual-repair-admission-20260928/.
B's atomic DB enforcement and C's protected/manual/real-evidence wiring are next.
