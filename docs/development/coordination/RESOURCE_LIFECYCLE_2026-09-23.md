# Resource lifecycle correction — 2026-09-23

Owner-authorized scope: preserve useful A/B/C concurrency, prevent leftover test processes and resource exhaustion, proactively recommend RAM upgrades for speed without reducing quality. Historical cleanup is a separate owner-reviewed action.

## Change

`control.py heavy` now supervises each job with a systemd cgroup and capacity admission. Concurrent jobs are allowed within their measured/estimated budgets and a 1024 MiB reserve. There is no CPU quota and no one-process/one-job host limit. Same-role destructive DB jobs remain exclusive. MemoryMax, zero test swap and bounded runtime isolate runaway tests. Per-run ownership checks handle controller death; unit teardown handles detached descendants. No historical files, containers or processes are swept.

`status` includes fresh memory/disk/inode/pressure readings. Runtime receipts retain peak usage, result and cleanup proof without argv/environment secrets. Full A/B/C prompts, AGENTS, WORK_METHOD, PROTOCOL and RESOURCE_POLICY carry the owner's speed-first RAM rule and cleanup disclosure/approval boundary.

## Validation before publication

- 31 coordination/resource tests PASS on Easyscript (Python 3.11, systemd 249, cgroup v2).
- Seven real systemd lifecycle tests cover success with a detached child and an unrelated process left alive, nonzero exit, three concurrent roles, timeout, killed controller, SIGTERM cancellation, and a bounded 64 MiB cgroup OOM.
- All temporary groups created by these tests were stopped; synthetic fixtures only.
- Documentation check PASS: 457 relative links, 26 requirements, 32 acceptance scenarios.
- Git diff whitespace check required before commit.
- CI additionally executes the systemd cases on the hosted runner; all five exact-candidate push workflows remain required for main.

Local sanitized evidence: `/root/octoport-control/incidents/resource-recovery-2026-09-23T09-41-07Z/runner-tests-final.log`. Product tests, browser acceptance and deployment acceptance are separate; none is inferred from these operational tests.

## Capacity recommendation

The incident showed seven older browser roots consuming approximately 1.45 GiB PSS and two test Next processes reaching approximately 2.35 GiB RSS together on an 8 GiB host. 16 GiB is a reasonable initial upgrade to enable overlap of useful test workloads with reserve; no measured speedup factor is claimed. Historical browser/container review is still required separately. Do not use purchased RAM to excuse missing lifecycle management.
