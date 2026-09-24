# Controller review — 23 September 2026

Status: controller review completed; A/B/C remain STOPPED until a new explicit owner resume.
This is permission to resume bounded development after owner resume, not release/deployment approval.

## Reviewed identities and evidence

- A: `655baafdc07246be672040d07819275f1cee3723`, clean.
- B: `4261b77053842364c5b3c54e59cbe61d2bbc3f33`, clean.
- C: `9c53f17363689823cbbac699f1b114ea88a78d51`, clean.
- Fetched main: `5d160f8711c795f71fc4212782813a64bb439513`.
- Controller browser-test correction: `4ade3a44028af9650bf48c4ea51d06b905c755a4`.
- Operational evidence root:
  `/root/octoport-control/incidents/controller-audit-20260923-1138/`.
- No live service restart, live migration, historical deletion, or stream resume was performed.
- Existing dirty child worktrees and the two dirty preprod files were preserved.

The controller inspected current source and requested review findings, verified the live
owner role/admission state read-only, reran the missing A06 full gate, reproduced a new
B06 runtime defect, and exercised actual browser credential transfer after recipient
profile restart. Existing broad integration/CI evidence was retained, not replaced by
claims about test counts. This is not a claim that every product requirement is accepted.

## Server and resource disposition

Fresh host observations after the owner's upgrade/reboot:

- 15,988 MiB total RAM: nominal **16 GiB**, eight logical CPUs.
- Before audit jobs: about 13,953 MiB MemAvailable; swap used zero of 1,101 MiB.
- No OOM event in the current boot; memory PSI zero at the initial check.
- About 28 GiB disk free and 3.8 million free inodes.
- No residual Chrome/Chromium/Opera/Yandex/Firefox or API harness processes at entry.
- No old `octoport-test-*` group at entry.
- Three owner-test services are up. They still run as root from a mutable source
  worktree with unlimited MemoryMax: an open B05/C05 deployment gate, not a
  current memory incident.

Measured audit runs, each with verified empty cgroup at completion:

| Run | Budget MiB | Observed peak MiB | Result |
|---|---:|---:|---|
| A06 unchanged full extension_core | 2048 | 168 | PASS, 118 gate processes |
| Original combined transfer harness | 4096 | 2030 | FAIL at fixture device limit |
| Corrected transfer with recipient restart | 4096 | 1823 | PASS, both package variants |
| Worker retention failure probes | 512 | 16 | Defects reproduced |
| Frozen offline controller dependencies | 2048 | 402 | PASS |

The admission policy permits multiple groups concurrently. A/B/C STOP states remained
unchanged while the controller ran these explicitly requested audit jobs. The existing
C disposable PostgreSQL container was identity-checked, temporarily started, and returned
to its initially stopped state; no live database URL was used for tests.

At the present idle baseline, 16 GiB allows roughly 10–11 GiB of simultaneous requested
job budgets plus the 1 GiB reserve, with headroom. A 12 GiB host could run many combinations
such as a browser, integration and build, but would have less room for two 4 GiB E2E jobs
plus a 2 GiB job and reserve. The previous 8 GiB incident included leaked processes and
swap pressure, so neither an exact RAM-only speedup nor a doubling of throughput can be
inferred. CPU count also increased. Do not buy more RAM based on idle free memory:
recommend the next increase when ready useful work is held in RESOURCE_WAIT or measured
pressure rises. Do not reduce quality or serialize all work to one process.

Storage inventory: control/evidence/worktrees about 2.41 GiB, installed Playwright browser
about 0.93 GiB, server npx installations about 0.56 GiB. These are inventory categories,
not an approved garbage list; several child worktrees contain uncommitted work. Delete
none merely because it is old. Two RDC launchers were observed, but their obsolescence
was not established and neither was killed.

## Owner access and marketplace inputs

The normal OTP/admin transfer receipt is TRANSFERRED_VERIFIED. Independent current
read-only DB verification confirms the new principal has ADMIN_OWNER and the old principal
has no current admin grants. Admission is CLOSED, capacity 2, admitted 2, revision 6.
Admin role grant/revoke and session revoke audit events exist. The temporary Nginx/network
maintenance barriers were removed; API live/ready and portal login returned HTTP 200.

No new OTP request or second transfer is needed. Never use the previous resume receipt
or previous owner account for new credential installation.

Marketplace files were previously prepared privately, format/checksum validated by the
production importer, and their three provider authentication probes returned HTTP 200.
Installed owner-profile import is still a separate gate: use ordinary owner login in a
dedicated profile and the supported import flow. Do not copy these secrets into Git,
logs, backend configuration, synthetic accounts, or another user's session.

## A: review disposition and next work

A01 bounded race repair is accepted at its recorded source/package/installed-synthetic
scope. Source serializes pending-map writers with the existing binding queue and preserves
the unlocked internal helper for already-locked paths. The receipt contains deterministic
RED-to-GREEN and actual Opera evidence. Browser-family release acceptance remains separate.

A06 at exact A HEAD now has the previously missing **full extension_core PASS**, 118 gate
processes, source and extracted package, no live provider calls. The old RAM owner request
is resolved. After owner resume A should record this evidence and submit exact 655baaf...
through the normal queue; do not substitute a newer untested tail.

A02 recipient vault and B03 relay were reviewed together. The corrected real Chromium
151.0.7922.34 harness used the API-generated trust bundle for its own package. Both source
and extracted variants transferred fixture credentials successfully after closing and
reopening the recipient's same profile between request creation and delivery. Provider
and AI business requests were zero. Earlier deterministic crash-window/ACK and relay
quota/TTL tests remain relevant. This closes the pending combined synthetic integration
block, not LIVE_OWNER or branded-browser release acceptance.

The harness correction assigns pre-created fixture account one to the source variant
and account two to the extracted variant. Each still uses two devices. Product limits,
signature verification and authorization are unchanged. Restart mode is explicitly
enabled by `D3S2_R1_RESTART_RECIPIENT=1`.

Remaining A work: Chrome/Yandex legitimate installation route, Firefox functional matrix,
supported Windows/Linux install/update, owner-authenticated Ozon/WB import and scoped live
acceptance. No browser inherits another browser's PASS. Safari remains deferred under
the owner's Windows/Linux scope, not tested or supported by inference.

## B: decisions and required corrections

### B01 migration lineage

Accept the fail-closed source guard and documented read-only/disposable evidence.
The active owner-test database was recorded as a canonical prefix. The archived hybrid
database is a different lineage and its clone had catalog damage; keep it quarantined.
Do not rewrite its ledger, run the canonical migrator on it, repair the source in place
or delete the archive. Any future use requires preserved source, fresh disposable restore,
explicit mapping and retained-data proof. This does not block development against fresh
canonical test databases and is not live legacy migration authorization.

### B02 profile compatibility — shared path assignment to C

The existing schema fixes profile compatibility to control_plane_v1 while the current
extension requests control_plane_v2. The bootstrap equality check is correct; bypassing
it or relabeling immutable published profiles is prohibited.

Controller decision: C is the single author for the backward-compatible shared extension
of `ProfileCompatibilityConstraintsV1Schema` to explicitly represent v1 or v2. Preserve
v1 serialized semantics/fingerprints; accept v2 only when explicitly declared, and reject
unknown versions or cross-version selection. No automatic default upgrade.

Assigned base: C 9c53f173... . Reserved C paths:
`packages/server/adapter-registry/src/index.ts`, its directly related tests, and necessary
shared compatibility documentation. B supplies/validates bootstrap and DB consumer tests;
A validates the current client. C must use a small exact candidate and hand it to B before
B authors new catalog data. Existing profile rows are not mutated. Real selectors/browser
support must still come from verified A input, never fabricated fixtures.

### B05 operations

Accept B's bounded disposable pg_dump -> restore -> AuthService/account/readiness proof
as server-side recovery evidence only. C owns the remaining dedicated service user,
clean pinned artifact, effective measured limits, staging deployment and rollback proof.
Preserve `packages/server/email/src/index.ts` and
`packages/server/remote-config/src/index.ts` in the live dirty worktree; reconcile their
meaning into an independently reviewed artifact. This review does not authorize replacing
the running owner-test services.

### B06 retention — release-blocking defect and policy decision

**NEEDS_FIX before C publishes the current server candidate.**

In `apps/worker/src/feedback-retention-runner.ts`, the interval calls
`void this.tick()` without handling rejection or tracking in-flight work. An actual
Node 24.20.0 probe reproduces process exit 1 on the second purge rejecting. A slow-purge
probe reached maxActive=4 and activeAfterStop=4. This can crash the composite worker or
leave DB work active while shutdown closes its connection.

Also, `purgeExpired()` deletes every eligible row and returns every ID in one transaction;
it is not bounded by row count/time despite the existing receipt's wording.

B owns the fix in its normal worker/DB paths:

1. Single in-flight purge per runner; no interval overlap.
2. Initial failure keeps startup fail-closed; later failure is handled and safely reported
   without unhandled rejection or a tight retry loop.
3. Stop cancels future work and awaits/settles in-flight work before DB shutdown.
4. Bound each repository batch and total tick work/time, report counts rather than loading
   an unbounded RETURNING list, and resume remaining eligible work on a later tick.
5. Meaningful regressions: post-start rejection, slow overlap, stop during purge, bounded
   many-row cleanup, remaining-row continuation, and configured retention boundaries.
6. Coordinate `apps/worker/src/main.ts` with C's uncommitted C04 child; B is sole writer
   of the retention fix and DB changes. C rebases/intakes it before combining notification
   wiring. Do not overwrite either child worktree.

Policy conflict is resolved: the existing administrative-audit **90-day technical beta
default** governs that category. Append-only means no editing existing events and no
arbitrary/early deletion; expiration is a separate audited retention operation. It does
not turn all rows in audit_events, financial records or every state-transition history
into a universal 90-day delete target. B must implement explicit category selection,
bounded batches, recent/protected-event preservation, and safe deletion-count audit
without copying expired content. Production policy remains a separate gate.
**No historical/live purge is authorized by this review.** Before first live cleanup,
present the concrete eligible categories/counts and configured windows for approval.

Support transaction-time permission checks and audit sanitization changes are present.
Sanitization is defense in depth, not proof that arbitrary secrets can never be entered.
Pending device-authorization preview precedes account binding; keep its limited metadata
and the separate user-code/owner authorization, rather than inventing a prior account
binding that breaks activation.

### C04 -> B persistence assignment

The exact request `/root/octoport-control/logs/C/C04_B_PERSISTENCE_REQUEST_2026-09-23.md`
is approved and must be prioritized after the worker defect; B does not wait for B07.

C first provides the pure shared no-session observation/metadata contract in its
`packages/server/health/**` authority with compatibility re-exports for the runner.
B alone authors `packages/server/db/**`, migrations and integration evidence.
Do not import browser/app execution into the DB package, duplicate the classifier,
invent UUIDs in configuration, use a second scheduler/store, or coerce observations into
BASELINE_CONTRACT_FIXTURE.

Persist the already validated no-session HealthState with stable machine-key lookup through
DB authority, fail closed on missing/ambiguous/inactive identity, and enforce scheduled-run
uniqueness, crash reconciliation and incident/outbox compatibility. If existing schema
cannot represent the truth, B may introduce the smallest typed additive migration,
numbered against fresh canonical main and checked by C. Approved provider/surface keys
must come from the existing no-session target authority; create no fictional usable DOM
profile. Required integration cases are the nine-item request's bootstrap/lookup,
success, restart/idempotency/reconcile, fail-closed authority and incident compatibility.

## C: order after owner resume

1. Intake/review this exact controller candidate and the A06 exact candidate at clean
   boundaries. Retain the new worker-retention publication block.
2. Provide the two small shared-contract handoffs above while B fixes retention.
3. Intake B's corrected worker/DB candidate and resolve the C04 child overlap explicitly.
4. Run affected consumers and all five required workflows for the resulting integration
   SHA before ready-main. Old green CI is not acceptance of the new combined tree.
5. Continue C04/C05 independent runtime/recovery work in their existing child worktrees.
   Main publication and deployment are different gates; do not deploy automatically.

C01's input bounds and regular-file checks are present in the current candidate; its
existing negative-test evidence covers oversized/nonregular inputs. The old controller
candidate 129faa1... is already an ancestor of main, so duplicate intake instructions
are obsolete. Its remaining B01/C01 questions are superseded by the dispositions here.

## Resuming and control state

The controller has answered the outstanding review requests and records remaining work
as concrete assignments, not an indefinite request for the same review. Product gates
above remain open until their own evidence exists.

All three roles may resume useful work concurrently once the owner explicitly lifts STOP
in their existing chats. There is no new blanket one-job rule and no need to replace the
permanent prompts for this task update. The resource/speed/cleanup policy remains in
AGENTS.md, WORK_METHOD.md, RESOURCE_POLICY.md and all three full prompts.

The Windows HP device is no longer in the connected-device inventory. Revocation does not
delete its local npm files. HP cleanup awaits an exact local inventory; do not run the
server cleanup against the PC or remove Node.js/global npm cache indiscriminately.
