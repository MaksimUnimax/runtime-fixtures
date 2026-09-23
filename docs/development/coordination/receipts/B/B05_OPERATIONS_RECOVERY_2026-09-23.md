# B05 operations / recovery handoff — 2026-09-23

Role: B
Task: B05
Status: B-owned recovery proof complete; C-owned deployment hardening remains open.
Evidence levels: SOURCE + disposable PostgreSQL recovery rehearsal + read-only host/runtime observation.
DEPLOYMENT / PRODUCTION acceptance: NOT CLAIMED.

## Exact B revision and base

- B branch candidate base before this receipt: `dcf9800bc5a2e6c090a1768dfa3062ebd16ce557`.
- Current canonical main observed before publication: `de45ce6c6b9dc99c79c4140e28043e17f10fdda5`; it is an ancestor of the B branch.
- No live/preprod database mutation, service restart, systemd edit, deploy, or production action was performed.

## Disposable PostgreSQL backup -> restore -> application proof

The rehearsal used only B's marked disposable PostgreSQL container `octoport-b-test-pg` and two explicitly named disposable databases:
- source: `octoport_b_recovery_source`;
- restore target: `octoport_b_recovery_restore`.

Procedure:
1. Fresh source/restore databases were created inside B's disposable container.
2. The canonical migrations were applied to the source DB.
3. A fully synthetic account/session was created through the real `AuthService` path using synthetic test-only OTP material and idempotent verification.
4. PostgreSQL 18 `pg_dump -Fc` produced a real custom-format archive.
5. The archive was copied out of the container, mode forced to `0600`, hashed, copied back independently, then restored with `pg_restore --exit-on-error --no-owner` into the fresh restore DB.
6. Restored structure and application behavior were verified:
   - migration journal retained exactly 38 rows, latest `1790071015000`;
   - restored DB contained one synthetic user, one account, one portal session;
   - the same idempotent auth verification replay succeeded after restore;
   - `AuthService.authenticate()` succeeded against restored state;
   - `AuthService.listOwnedAccounts()` returned the restored ACTIVE synthetic account;
   - API `/health/ready` against the restored DB returned HTTP 200.
7. No session token, OTP, DB credential, connection string, secret, or private mailbox data was written to Git or receipt output.

Archive evidence:
- SHA-256: `b40cd576ef602d9a09ef19302eca6c3fe8d884e903f4a3443d86c35971eb1db3`
- size: `383724` bytes
- mode: `0600`
- host evidence path: `/root/octoport-control/backups/B/b05-disposable-recovery.dump`
- `pg_restore -l` readback succeeded.

Final rehearsal log:
`/root/octoport-control/logs/B/b05-recovery-rehearsal-v3.log`

Earlier rehearsal attempts failed only in disposable harness orchestration:
- shell quoting around a synthetic UUID;
- a temporary TS smoke file using top-level await under a CJS transform;
- one nested-shell quoting error before process launch.
None touched live/preprod DB or services. The final v3 rehearsal above is the accepted local evidence.

## Read-only current owner-test runtime observation

Current owner-test services observed:
- `seller-agents-owner-test-api.service`: active;
- `seller-agents-owner-test-worker.service`: active;
- `seller-agents-owner-test-portal.service`: active.

Effective systemd properties for all three:
- `User=root`;
- `DynamicUser=no`;
- `MemoryHigh=infinity`;
- `MemoryMax=infinity`;
- `CPUQuotaPerSecUSec=infinity`;
- `NoNewPrivileges=yes`;
- `PrivateTmp=yes`;
- no effective `ProtectSystem` or `ProtectHome` hardening.

Runtime commands execute directly from the source worktree `/root/runtime-fixtures-preprod-r1` through Node/tsx/Next, not from an immutable deploy artifact.

Observed runtime worktree identity:
- HEAD: `d31a59a95cf9fa908b3410db200cf9dbadaa3209`
- tree: `d9a70fb69a3a042d129bdb5d9afe06d999cc2dfd`
- worktree is dirty:
  - `packages/server/email/src/index.ts`
  - `packages/server/remote-config/src/index.ts`

Therefore the current runtime cannot be considered a clean pinned artifact even though its Git HEAD is known.

Observed systemd unit file hashes:
- API: `f417064517c096892a0a27b19867cd6dffeac50ef706d5413975c1cafc8e0245`
- worker: `1c7e416b3cb4213db60ce49c5743118971ee2fd7bb211a9bd82187d0d36b602c`
- portal: `ff08186c62eeda3ff9fc174b6a2f3ddd12b97d63392acfd182ed434e4f5ce205`

The unit files themselves are mode `0600 root:root`. No environment-file contents were read or recorded.

## C-owned deployment hardening handoff

These paths/actions are outside B ownership and require C integration/deployment work:

1. **Dedicated service identity**
   - install API/worker/portal under a dedicated non-login Octoport service account/group;
   - remove ordinary runtime dependence on `root`;
   - verify the account can read only the required immutable artifact/config and write only bounded runtime directories.

2. **Measured resource limits**
   - set and verify effective systemd resource ceilings for API, worker and C-owned health runner;
   - at minimum establish finite memory and CPU/task boundaries derived from measured load, not arbitrary numbers;
   - preserve DB/API responsiveness while health or large jobs run.

3. **Clean pinned artifact**
   - build from a clean exact source revision;
   - record source HEAD/tree plus actual deployable artifact SHA-256/size;
   - deploy immutable bytes, not a mutable source worktree;
   - service command must point at that immutable identity.

4. **Staging rollback rehearsal**
   - stage both candidate and previous compatible immutable artifacts;
   - deploy candidate to isolated staging;
   - induce a bounded health failure without corrupting DB;
   - restore exact previous artifact + service config;
   - re-run ready/auth/bootstrap/account/device isolation checks;
   - keep forward-compatible DB schema; no destructive down migration.

5. **Recovery coordination**
   - C may reuse this B disposable restore proof as server-side backup evidence;
   - staging rollback must additionally prove the chosen pinned artifact can start against the restored/forward schema.

## What B05 does and does not prove

Proven:
- a real PostgreSQL custom archive can be created from the canonical schema and application-created synthetic state;
- that archive can be restored into a fresh DB;
- migration history survives;
- restored auth/session/account data is usable by actual application services;
- API readiness succeeds against the restored DB;
- current owner-test runtime has concrete service-user/resource-limit/artifact-identity gaps.

Not proven:
- scheduled daily backup automation or seven-day retention;
- achieved production RPO/RTO;
- dedicated service user or resource limits on a target host;
- immutable staging artifact deployment;
- staging rollback;
- production recovery or deployment.

B05 therefore has a completed B-owned recovery candidate and an explicit C-owned operations dependency.
