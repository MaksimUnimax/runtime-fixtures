# B05 non-root service resource envelope — 2026-10-01

Status: **PASS — SOURCE + DISPOSABLE_FUNCTIONAL_RESOURCE_ENVELOPE; NOT CAPACITY / NOT LIVE / NOT DEPLOYMENT**.

Task: `B05-NONROOT-SERVICE-RESOURCE-ENVELOPE`.
Role: B.
Feature commit tested exactly: `40d2c7daa510a4f206f8c91f865e7ea4e82fed3f`.
Base before feature: `deb7294b4248af7c8176426899923914bce970af`.

## Purpose

B05 already proved disposable PostgreSQL recovery and API/worker/portal execution under an explicit non-root identity. This slice measures a bounded, privacy-safe per-service resource envelope during that same current → rollback-floor → current functional rehearsal. It does **not** choose production `MemoryHigh`, `MemoryMax`, `CPUQuota`, or `TasksMax`.

## Implementation

Changed runtime/test paths:

- `tooling/coordination/c05-service-resource-envelope.mts`
- `tooling/coordination/c05-service-resource-envelope.test.mts`
- `tooling/coordination/c05-three-service-rollback-rehearsal.mts`

The sampler:

- reads only Linux `/proc/<pid>/stat` for process identity/parent/CPU ticks and `/proc/<pid>/status` for RSS/HWM/thread count;
- never reads `environ`, `cmdline`, sockets, file descriptors, DB rows, account/store payloads, tokens or credentials;
- constructs the service descendant tree from pid/ppid relations, but emits no pid, uid/gid, command line or process name in public evidence;
- binds root and descendant pid values to process start-time ticks so a reused pid fails closed;
- rejects malformed/missing proc counters and aggregate CPU regression;
- records only aggregate RSS, aggregate process high-water memory, process count, task/thread count and CPU tick delta;
- samples once before the existing readiness/auth/bootstrap functional smoke and once after it for each runtime phase.

Measurement is opt-in with the exact value `C05_CAPTURE_SERVICE_RESOURCE_ENVELOPE=1` and requires the already-accepted explicit non-root service identity. With the flag absent, prior rehearsal behavior is unchanged.

The rehearsal DB guard was widened only from C's exact disposable target to an explicit two-entry B/C allowlist:

- B: `octoport-b-test-pg`, loopback port `15542`, DB `octoport_b_test`, B evidence root;
- C: `octoport-c-test-pg`, loopback port `15543`, DB `octoport_c_test`, C evidence root.

No arbitrary DB/container/evidence-root environment override was added. Any other database URL or mismatched evidence root fails closed.

## Focused verification

On the feature source before the final heavy run:

- resource-envelope helper: **7/7 PASS**;
- preserved non-root identity helper: **7/7 PASS**;
- runner Node syntax check: PASS;
- Prettier: PASS;
- `git diff --check`: PASS.

The focused suite also asserts that the helper source contains no `/environ`, `/cmdline`, `/fd` or `/net` reads and that only the exact B/C disposable DB identities are accepted.

## Supervised rehearsal history

### R1 — safe harness failure, not acceptance

Resource job:
`/root/octoport-control/resource-jobs/dfbe295ead5544bb8e7e68d51443a0fd/receipt.json`.

It stopped before disposable DB creation because one historical port check still required C port 15543. The role-safe target check was corrected to use the already-selected allowlisted disposable target. Cleanup was verified; OOM = 0.

### R2 — useful preliminary PASS, not exact-source acceptance

Resource job:
`/root/octoport-control/resource-jobs/4e959c7a1c81433889ff4d26724d5f43/receipt.json`.

The B disposable current → floor → current run passed, but the sampler/runner bytes were still uncommitted. This run is retained only as preliminary evidence.

### R3 — final exact-source PASS

Exact feature commit:
`40d2c7daa510a4f206f8c91f865e7ea4e82fed3f`.

Resource receipt:
`/root/octoport-control/resource-jobs/8f5f56a75f064749ad7076b234f27c10/receipt.json`
SHA-256 `d99262b13768b7df9447da83c19b97fa3b0e0bfd67c12c922c0393b4d01e081a`.

Result:

- command/systemd exit 0;
- OOM kill 0;
- cleanup verified;
- outer test-job cgroup peak: **1,483,735,040 bytes**;
- restored journal 40, forward target journal 44;
- real PostgreSQL custom backup/restore retained;
- all three service phases remained `EXPLICIT_NON_ROOT_TEST`;
- API live/ready, worker ready, portal login/proxy, N2 present/withheld and both signed bootstrap branches PASS;
- disposable DB dropped;
- transient private state removed;
- temporary source/install tree removed;
- no failure evidence file remained.

Sanitized evidence:
`/root/octoport-control/logs/B/b05-resource-envelope-r3/c05-three-service-rollback-evidence.json`
SHA-256 `a637b8f50ccf7a90a68b329697760eb2d6f661b4b07ef7571bb267de33b76be2`.

## Observed functional envelope

These values are observations of the bounded functional smoke only.

| Phase | Service | RSS max bytes | HWM max bytes | Process max | Task/thread max | CPU ticks delta | Window ms |
|---|---|---:|---:|---:|---:|---:|---:|
| current-1 | API | 429,797,376 | 430,735,360 | 3 | 34 | 586 | 4,870 |
| current-1 | worker | 379,293,696 | 380,137,472 | 3 | 34 | 415 | 4,870 |
| current-1 | portal | 199,843,840 | 199,860,224 | 1 | 19 | 88 | 4,870 |
| rollback floor | API | 419,921,920 | 420,589,568 | 3 | 34 | 528 | 4,271 |
| rollback floor | worker | 386,179,072 | 386,838,528 | 3 | 34 | 378 | 4,271 |
| rollback floor | portal | 201,064,448 | 201,068,544 | 1 | 19 | 84 | 4,271 |
| current-2 | API | 414,408,704 | 414,408,704 | 2 | 23 | 409 | 3,395 |
| current-2 | worker | 370,454,528 | 370,454,528 | 2 | 23 | 270 | 3,395 |
| current-2 | portal | 195,268,608 | 195,268,608 | 1 | 19 | 100 | 3,395 |

The outer cgroup peak includes build/install/orchestration and is intentionally kept separate from the service-only envelope.

## Evidence boundary and next B05 proof

The evidence level is exactly **DISPOSABLE_FUNCTIONAL_RESOURCE_ENVELOPE**.

It does **not** prove:

- representative production or beta load;
- final service resource ceilings;
- owner-test/live systemd sandbox behavior;
- a live dedicated service account;
- deployment or production capacity.

Before choosing finite service limits, B05 still requires:

1. a representative staged workload envelope;
2. startup/readiness/auth/bootstrap under the proposed systemd sandbox and finite controls;
3. rollback/failure proof for those proposed controls;
4. independent review and separate live mutation authority before any live unit change.
