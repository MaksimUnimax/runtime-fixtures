# B05 owner-test runtime hardening preflight — 2026-10-01

Status: **PASS — SOURCE + READ_ONLY_HOST_OBSERVATION; HARDENING NOT APPLIED; CAPACITY NOT PROVEN**.

Task: `B05-OWNER-TEST-RUNTIME-HARDENING-PREFLIGHT`.
Role: C.
Parent working revision before task commit: `191442e1217b6b1d4307184301223372c59d010f`.

This closes only the B05 preflight/evidence gap for service identity and resource hardening. It does not change systemd, users/groups, files, permissions, services, databases or network authority.

## Exact source

- `tooling/operations/owner_test_runtime_hardening.py`
  SHA-256: `87eb57f745a14fb3efbee2e525c033214f407d6600ba42e78d3fa067b9166c04`.
- `tooling/operations/test_owner_test_runtime_hardening.py`
  SHA-256: `4d6ba605cbbbe770b535ad5559fcca2aa72b7c0283a29acea81d73f8f93b5020`.

The audit command surface is fixed to the three owner-test API/worker/portal unit names and allowlisted `systemctl show` properties. It has no apply/start/stop/restart/daemon-reload/set-property mode and does not request `Environment` or `EnvironmentFiles`.
## Fail-closed and privacy boundary

The parser rejects missing/duplicate/unknown properties, unknown service states, malformed booleans/names/protection modes, invalid resource limits, invalid systemd CPU timespans, counter regressions and configuration drift during the observation window.

Finite memory/task values are normalized to positive integers; `infinity` remains explicitly unbounded. CPU quota accepts validated timespan tokens, including compound forms such as `1min 30s`, and normalizes them to microseconds.

Output does not expose raw service user/group or WorkingDirectory. It reports bounded classifications such as `ROOT_OR_UNSET`, `EXPLICIT_NON_ROOT`, `PINNED_OPS_RELEASE`, booleans, normalized resource values and observed counters.

Every result carries `mutationPerformed=false`, `secretMaterialRead=false` and `capacityProof=NOT_PROVEN_SHORT_WINDOW`.

## Current host observation

Canonical sanitized evidence:
`/root/octoport-control/logs/C/b05-runtime-hardening-preflight-20261001/host-observation.json`

SHA-256:
`4e588f5aac7624a39791636f8907037a7a02ffb64d10a6433e6383c8cb60d849`.

All three units were active/running and used pinned ops-release working directories. Each was classified `ROOT_OR_UNSET`, with no configured service group, weak `ProtectSystem/ProtectHome`, unbounded `MemoryHigh`, unbounded `MemoryMax` and unbounded CPU quota.
Observed current-memory maxima during the three-sample window were approximately 153 MB API, 111 MB portal and 105 MB worker; observed task maxima were 34, 19 and 34 respectively. These are short-window observations only. They are **not** accepted capacity ceilings and must not be converted directly into MemoryHigh/MemoryMax/CPUQuota/TasksMax.

The existing `TasksMax=19045` is technically finite, so the tool does not falsely label it infinite. This receipt does not claim it is an intentionally measured Octoport limit.

## Verification

Parent checks on the final source:
- Python unittest: **11/11 PASS**.
- `py_compile`: PASS.
- explicit trailing-whitespace/text check: PASS.
- no live mutation or service restart performed.

Independent read-only Luna reviews:
1. `b05-runtime-hardening-review-20261001`: **REWORK_REQUIRED** — malformed security/resource values and raw output.
2. `b05-runtime-hardening-review-r2-20261001`: **REWORK_REQUIRED** — state enums and compound CPU timespans.
3. `b05-runtime-hardening-review-r3-20261001`: **PASS** on the final exact files.

Final PASS:
`/root/octoport-control/logs/C/b05-runtime-hardening-review-r3-20261001-result.md`.

## Remaining B05 hardening boundary
This receipt does **not** create a service account or choose final production resource ceilings. Before any hardening apply, a separate task must provide:
- a representative workload envelope rather than an idle three-second sample;
- a non-root service identity plus exact read/write permission rehearsal for immutable releases, protected config and bounded runtime paths;
- staging API/worker/portal startup, readiness, auth and bootstrap proof under the proposed sandbox controls;
- rollback/failure evidence for the hardening configuration;
- independent review and a separate live authority before mutating owner-test units.

No owner-test unit, database, store candidate, monitoring service, Telegram destination, provider, marketplace, payment or production state was changed by this task.

Disposition: **B05_HARDENING_PREFLIGHT_PASS / LIVE_HARDENING_OPEN**.
