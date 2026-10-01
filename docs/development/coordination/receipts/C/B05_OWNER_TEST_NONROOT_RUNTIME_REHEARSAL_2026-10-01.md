# B05 owner-test non-root runtime rehearsal — 2026-10-01

Status: **PASS — DISPOSABLE_NONROOT_RUNTIME; NOT LIVE / NOT DEPLOYMENT**.

Task: `B05-OWNER-TEST-NONROOT-RUNTIME-REHEARSAL`.
Role: C.
Parent source revision before this task: `087a06623444f505562205488d15d53dbca94aab`.
Runtime candidate exercised: `ff4a83a453b405feb259b2370bb7b146582bf65e`.
Rollback floor: `d24838669c54f21dc161dc48a7e71e0e288384c2`.

The later `origin/main` advanced to `7d239b5b653c158a338587d9a5e7ae2b087ef0ec`.
A path-scoped diff from the exercised candidate to that main is empty for
API, worker, portal, server packages, contracts, control client, marketplaces
and `pnpm-lock.yaml`; the intervening changes are admin repair UI/docs only.

## Implementation boundary

The existing C05 three-service recovery runner gained an opt-in service identity
mode controlled by both `C05_SERVICE_UID` and `C05_SERVICE_GID`.
With neither variable set, the prior inherited-parent mode remains selected.
Root, zero, partial and malformed identities fail closed.
Only API, worker and portal child runtime processes receive the requested
uid/gid. Build/install, migration, backup/restore and orchestration remain in
the supervised parent.

Before a spawned service is accepted, the runner reads
`/proc/<pid>/status` and verifies all real/effective/saved/fs UID/GID columns
plus supplementary groups. Any unexpected supplementary group fails closed.

The prepared source/runtime trees are made readable/traversable, then checked
against the selected child identity. Real files/directories that the child can
write are rejected. Internal symlink mode `0777` is not treated as writable
by itself; dangling or escaping symlinks are rejected. Only disposable
`HOME` and `TMPDIR` directories are chowned/writable by the child.

Public evidence records only
`{"mode":"EXPLICIT_NON_ROOT_TEST","nonRoot":true}`; numeric uid/gid values
are not emitted.

Changed source/test paths:
- `tooling/coordination/c05-three-service-rollback-rehearsal.mts`;
- `tooling/coordination/c05-service-runtime-identity.mts`;
- `tooling/coordination/c05-service-runtime-identity.test.mts`.

No product runtime, schema, migration, live unit, service account or
configuration file was changed.
## Verification

Focused helper tests: **7/7 PASS**.
Node syntax check: PASS.
Prettier: PASS.
`git diff --check`: PASS.

The full rehearsal used `control.py C heavy --db`, profile `e2e`,
a 4096 MiB cgroup cap, the C disposable PostgreSQL service and canonical
`pnpm exec tsx` execution.

Final resource receipt:
`/root/octoport-control/resource-jobs/6d484f160e0d43cb8d198ad140a82ede/receipt.json`.

Final result:
- command exit 0;
- OOM kills 0;
- peak cgroup memory 1,584,398,336 bytes;
- cleanup verified;
- disposable database dropped;
- transient private state and temporary workspace removed.

Sanitized runtime evidence:
`/root/octoport-control/logs/C/b05-nonroot-runtime-r3/c05-three-service-rollback-evidence.json`
(SHA-256 `75ecc43fa7d23fd46ad3819560f790db82ad7212ad652120841b5996291014c6`).
The run restored the accepted journal-40 seed, migrated the exact current
candidate to journal 44, created and restored a real PostgreSQL custom backup,
then ran current -> rollback floor -> current on the same restored forward DB.

All three phases record `EXPLICIT_NON_ROOT_TEST` and pass:
- API live = 200 and ready = 200;
- worker ready;
- portal login = 200 and authenticated proxy account read = 200;
- PRESENT and WITHHELD N2 reads = 200;
- identified and privacy-neutral v2 Bootstrap = 200 with Ed25519 verification;
- protected journal/device/session/config/signing invariants remain stable;
- the synthetic metadata-forget state survives floor and second-current phases.

Post-upgrade backup:
`/root/octoport-control/logs/C/b05-nonroot-runtime-r3/c05-current-schema-backup.dump`;
SHA-256 `834a3539c63f62de8855417519dde56326ab21a3386ffe38924e50e1c2e43a6b`;
493,962 bytes; mode `0600`.

## Failed attempts retained as evidence

R1 resource job `b8fcfdb6ae774ca78366ab29120b7b05` failed safely because
the first guard incorrectly treated normal pnpm symlink mode `0777` as a
world-writable runtime entry. OOM = 0 and cleanup was verified.
R2 resource job `13754d62c2604386818750a2c41183eb` failed safely because
the parent invocation used plain `node` instead of the runner's required
`tsx` loader; the error was module resolution for a TypeScript server import,
not a product/non-root failure. OOM = 0 and cleanup was verified.

Neither failed attempt is acceptance evidence.

## Independent review

R1 review:
`/root/octoport-control/logs/C/b05-nonroot-runtime-review-r1-20261001-result.md`
= **REWORK_REQUIRED** because source-tree write isolation did not account for
group/supplementary-group and symlink paths.

R2 review:
`/root/octoport-control/logs/C/b05-nonroot-runtime-review-r2-20261001-result.md`
= **PASS**. The reviewer confirmed the R1 blocker is closed by effective
permission checks, supplementary-group verification and symlink fencing, and
that the identity change remains limited to the three service children.

## Remaining B05 boundary

This does **not** create the final owner-test service account, choose final
Memory/CPU/Tasks limits, change systemd hardening, or prove LIVE_OWNER,
DEPLOYMENT or PRODUCTION operation.
The existing read-only hardening preflight still requires, before any live
apply:
- a representative workload envelope rather than a short idle sample;
- exact service-user read/write permission rehearsal for immutable release,
  protected config and bounded runtime paths;
- staging startup/readiness/auth/bootstrap under proposed systemd sandbox and
  finite resource controls;
- rollback/failure proof for those controls;
- independent review and separate live mutation authority.

Disposition: **B05_DISPOSABLE_NONROOT_RUNTIME_PASS / LIVE_HARDENING_OPEN**.
