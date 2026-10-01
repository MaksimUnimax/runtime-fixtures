# B05 non-root service resource envelope — 2026-10-01

Status: **SOURCE + DISPOSABLE_FUNCTIONAL_RESOURCE_ENVELOPE PASS AFTER REWORK; NOT CAPACITY / NOT LIVE / NOT DEPLOYMENT**.

Task: `B05-NONROOT-SERVICE-RESOURCE-ENVELOPE`.
Role: B.
Fresh main integrated before final runtime acceptance: `2d1fa64b5fa82862154b95a8755cd9a75e98ffb7`.
Final runtime candidate exercised exactly: `efef87e40c3351d159cbb2318f7b6657d02bf90a`.

## Purpose

B05 already proved disposable PostgreSQL recovery and API/worker/portal execution under an explicit non-root identity. This slice measures a bounded, privacy-safe per-service resource envelope during that same current → rollback-floor → current functional rehearsal.

It does **not** choose production or owner-test `MemoryHigh`, `MemoryMax`, `CPUQuota`, or `TasksMax`.

## Implementation

Task paths:

- `tooling/coordination/c05-service-resource-envelope.mts`;
- `tooling/coordination/c05-service-resource-envelope.test.mts`;
- `tooling/coordination/c05-three-service-rollback-rehearsal.mts`;
- this receipt.

The sampler:

- reads only Linux `/proc/<pid>/stat` for process identity/parent/CPU ticks and `/proc/<pid>/status` for RSS/HWM/thread count;
- never reads `environ`, `cmdline`, sockets, file descriptors, DB rows, account/store payloads, tokens or credentials;
- constructs the service descendant tree from PID/PPID relationships, but emits no PID, uid/gid, command line or process name in public evidence;
- binds root and descendant PIDs to process start-time ticks;
- after each status read, re-reads stat and rejects PID/start-time reuse, parent change or CPU regression before accepting the counters;
- rejects malformed/missing proc counters and aggregate CPU regression;
- records only aggregate RSS, aggregate HWM, process count, task/thread count and CPU tick delta;
- samples once before the existing readiness/auth/bootstrap functional smoke and once after it for each runtime phase.

Measurement is opt-in with exact value `C05_CAPTURE_SERVICE_RESOURCE_ENVELOPE=1` and requires the already-accepted explicit non-root service identity. With the flag absent, prior rehearsal behavior is unchanged.

The rehearsal DB guard accepts only an explicit two-entry disposable allowlist:

- B: `octoport-b-test-pg`, loopback port `15542`, DB `octoport_b_test`, B evidence roots;
- C: `octoport-c-test-pg`, loopback port `15543`, DB `octoport_c_test`, C evidence roots.

No arbitrary DB/container/evidence-root environment override exists. Any other database URL or mismatched evidence root fails closed.

## Focused verification after review fix and fresh-main merge

On exact source preceding final heavy acceptance:

- resource-envelope helper: **8/8 PASS**;
- preserved non-root identity helper: **7/7 PASS**;
- runner Node syntax check: PASS;
- Prettier: PASS;
- `git diff --check`: PASS;
- task delta against `2d1fa64…`: exactly the four declared task paths.

The helper suite includes an explicit regression for PID reuse **between the first stat read and status/resource accounting inside one capture**.

## Rehearsal and review history

### R1 — safe harness failure, not acceptance

Resource job:
`/root/octoport-control/resource-jobs/dfbe295ead5544bb8e7e68d51443a0fd/receipt.json`.

It stopped before disposable DB creation because one historical port check still required C port 15543. The guard was corrected to use the already-selected allowlisted disposable target. Cleanup was verified; OOM = 0.

### R2 — useful preliminary PASS, not exact-source acceptance

Resource job:
`/root/octoport-control/resource-jobs/4e959c7a1c81433889ff4d26724d5f43/receipt.json`.

The B disposable current → floor → current run passed, but the sampler/runner bytes were still uncommitted. It is preliminary evidence only.

### R3 — exact-source run later superseded by independent REWORK_REQUIRED

Runtime candidate:
`40d2c7daa510a4f206f8c91f865e7ea4e82fed3f`.

Resource job:
`/root/octoport-control/resource-jobs/8f5f56a75f064749ad7076b234f27c10/receipt.json`.

The run itself exited 0 with OOM 0 and cleanup, but independent Luna review:
`/root/octoport-control/logs/B/b05-resource-envelope-review-r1-20261001-result.md`
returned **REWORK_REQUIRED**.

Blocking finding: a descendant PID could theoretically be reused after the initial stat scan but before status accounting, allowing RSS/HWM/task counters from the replacement process to be combined with the old identity. Therefore **R3 is not acceptance evidence** even though its execution completed successfully.

Correction commit:
`1cde14086f9813f46384fed7b6e8237333772413`.

The correction re-reads stat after status and fails closed if PID/start-time changed, parent changed or CPU regressed. A focused same-capture PID-reuse regression was added.

### R4 — final post-rework, fresh-main exact-source PASS

Fresh main `2d1fa64b5fa82862154b95a8755cd9a75e98ffb7` was merged before the run. That main delta was coordination-only and did not alter API/worker/portal/server/product runtime inputs.

Exact runtime candidate:
`efef87e40c3351d159cbb2318f7b6657d02bf90a`.

Resource receipt:
`/root/octoport-control/resource-jobs/e27438919994498d8d0ff7a2ab3b789d/receipt.json`
SHA-256 `d5cb7a34f0bc04a8429c32e44ee06cbe56f90baeb5deb7fd7aea6569ba3511de`.

Sanitized evidence:
`/root/octoport-control/logs/B/b05-resource-envelope-r4/c05-three-service-rollback-evidence.json`
SHA-256 `049c29ae45ddc33cf3f4d6e5f06ed85f1a4763fc7b831acb450d04a18ba7e506`.

R4 result:

- command/systemd exit 0;
- OOM kill 0;
- cleanup verified;
- outer test-job cgroup peak: **1,641,021,440 bytes**;
- restored journal 40, forward target journal 44;
- PostgreSQL custom backup/restore PASS;
- all three runtime phases remained `EXPLICIT_NON_ROOT_TEST`;
- API live/ready, worker ready, portal login/proxy, N2 present/withheld and both signed bootstrap branches PASS;
- disposable B database dropped;
- transient private state removed;
- temporary source/install tree removed;
- no failure evidence file remained.

## Observed R4 functional envelope

These values describe only the bounded functional smoke.

| Phase | Service | RSS max bytes | HWM max bytes | Process max | Task/thread max | CPU ticks delta | Window ms |
|---|---|---:|---:|---:|---:|---:|---:|
| current-1 | API | 433,680,384 | 433,836,032 | 3 | 35 | 499 | 4,532 |
| current-1 | worker | 382,681,088 | 383,545,344 | 3 | 35 | 374 | 4,532 |
| current-1 | portal | 200,196,096 | 200,196,096 | 1 | 19 | 96 | 4,532 |
| rollback floor | API | 401,346,560 | 401,924,096 | 3 | 34 | 481 | 4,075 |
| rollback floor | worker | 375,455,744 | 376,508,416 | 3 | 34 | 342 | 4,075 |
| rollback floor | portal | 200,384,512 | 200,384,512 | 1 | 19 | 70 | 4,075 |
| current-2 | API | 387,424,256 | 387,424,256 | 2 | 23 | 376 | 3,364 |
| current-2 | worker | 360,177,664 | 360,177,664 | 2 | 23 | 275 | 3,364 |
| current-2 | portal | 200,798,208 | 200,798,208 | 1 | 19 | 102 | 3,364 |

The outer cgroup peak includes build/install/orchestration and is intentionally separate from the service-only envelope.

## Evidence boundary and next B05 proof

The evidence level is exactly **DISPOSABLE_FUNCTIONAL_RESOURCE_ENVELOPE**.

It does **not** prove:

- representative production or controlled-beta load;
- final service resource ceilings;
- owner-test/live systemd sandbox behavior;
- a live dedicated service account;
- deployment or production capacity.

Before choosing finite service limits, B05 still requires:

1. a representative staged workload envelope;
2. startup/readiness/auth/bootstrap under the proposed systemd sandbox and finite controls;
3. rollback/failure proof for those proposed controls;
4. independent review and separate live mutation authority before any live unit change.
