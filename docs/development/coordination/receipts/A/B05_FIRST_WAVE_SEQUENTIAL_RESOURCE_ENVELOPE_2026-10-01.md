# B05 first-wave sequential resource envelope — 2026-10-01

Status: **PASS — DISPOSABLE FIRST-WAVE COUNT-EQUIVALENT ENVELOPE; NOT CONCURRENCY / NOT LIVE / NOT PRODUCTION CAPACITY**.

Task: `B05-FIRST-WAVE-SEQUENTIAL-RESOURCE-ENVELOPE`.
Role: A.
Fresh base before the task merge: `00500602bdd2d1f5d49ed29a9313be44e9ebbcdb`.
Exact runtime candidate exercised: `2d5d9ac8f95d5395f2a8ac51192391a4baeb7bac`.
Rollback floor: `d24838669c54f21dc161dc48a7e71e0e288384c2`.

## Purpose and boundary

The accepted B05 non-root recovery rehearsal still required a workload envelope before finite service limits can be proposed. The current beta policy defines a first wave of 100 users, but no accepted simultaneous-concurrency model exists. This task therefore measures exactly **100 sequential normal functional cycles with concurrency=1** on the final-current phase and does not reinterpret that count as 100 concurrent users.

The existing current → rollback-floor → current PostgreSQL recovery path, explicit non-root child identity and resource sampler are reused. Default rehearsal behavior is unchanged unless both resource capture and the exact first-wave count flag are enabled.

Changed implementation paths:
- `tooling/coordination/c05-service-resource-envelope.mts`;
- `tooling/coordination/c05-service-resource-envelope.test.mts`;
- `tooling/coordination/c05-three-service-rollback-rehearsal.mts`.
## Exact workload

Opt-in workload value: `C05_FIRST_WAVE_SEQUENTIAL_CYCLES=100`; any other non-empty count fails closed.
The workload executes only on the second/final current phase after current→floor recovery.
Each cycle performs eight existing safe functional probes in sequence:
1. API readiness;
2. API liveness;
3. portal login;
4. authenticated portal proxy account read;
5. PRESENT sync read;
6. WITHHELD sync read;
7. identified signed bootstrap;
8. privacy-neutral signed bootstrap.

No SMTP, Telegram, marketplace provider, external AI or live product service is called.
Resource samples are taken before smoke, after every 10 cycles, and after smoke. The series summarizer preserves the old two-sample API while taking maxima across every sample and requiring monotonic CPU/root identity.

The staged workload record is:
- cycles: **100**;
- concurrency: **1**;
- requests per cycle: **8**;
- total functional requests: **800**;
- sample cadence: every **10** cycles;
- resource samples: **12**;
- capacity claim: `NOT_CONCURRENCY_CAPACITY_PROOF`.

## Focused verification

On exact merged source `2d5d9ac8…`:
- resource-envelope and non-root identity tests: **19/19 PASS**;
- Prettier: PASS;
- `git diff --check`: PASS;
- task delta against fresh main contains only the three implementation paths before this receipt.
## Supervised disposable run

Supervisor unit: `octoport-test-a-88bb812776dc4863b9493d1d6671df8d.service`.
Resource receipt: `/root/octoport-control/resource-jobs/88bb812776dc4863b9493d1d6671df8d/receipt.json`.
Profile: e2e, 4096 MiB MemoryMax, A-owned disposable PostgreSQL.
Exit code: **0**. OOM kills: **0**. Cleanup verified: **true**.
Outer cgroup peak: **1,832,910,848 bytes** (~1748 MiB).

Sanitized runtime evidence:
`/root/octoport-control/logs/A/b05-first-wave-sequential-envelope-20261001/run-r1/c05-three-service-rollback-evidence.json`
SHA-256: `ba8dac5aa66bb38efcb1b07e46571318e093b496c080ae9db5b28af10d9e2a48`.

The run passed restore, forward migration, upgraded backup/restore, current phase 1, rollback-floor phase, final-current phase and cleanup. All three runtime phases were `EXPLICIT_NON_ROOT_TEST`.

Final-current 100-cycle series maxima:
| Service | RSS max bytes | HWM max bytes | Process max | Task/thread max | CPU ticks delta |
|---|---:|---:|---:|---:|---:|
| API | 462,643,200 | 462,643,200 | 2 | 23 | 771 |
| worker | 373,473,280 | 373,473,280 | 2 | 23 | 291 |
| portal | 251,604,992 | 252,018,688 | 1 | 19 | 280 |

Protected final-current counts were unchanged across the workload: accounts=1, devices=3, sessions=3, portalSessions=2, config=1, signing=1, signingEvents=2, sync_entities=0, migration journal=44.
Cleanup confirms disposable database dropped, transient private state removed and temporary worktree removed.
## Evidence boundary and remaining B05 work

This result proves a bounded **sequential count-equivalent** workload on the accepted disposable non-root recovery runtime. It does **not** prove representative simultaneous beta traffic, production capacity, final MemoryHigh/MemoryMax/CPUQuota/TasksMax, owner-test systemd sandbox behavior, deployment or production operation.

Before finite service controls or live hardening are selected/applied, B05 still requires:
1. an accepted representative concurrency/load model and staged envelope for that model;
2. startup/readiness/auth/bootstrap under proposed finite systemd controls and service sandbox;
3. explicit failure/rollback proof for those proposed controls;
4. independent review of the exact candidate and separate live-mutation authority before any live unit change.

No live unit, service limit, DB, Telegram, provider or production configuration was mutated by this task.
