# B05 owner-test finite resource guardrail source R1

Task: B05-OWNER-TEST-FINITE-RESOURCE-GUARDRAIL-SOURCE-R1-20261005.

This source slice records finite owner-test safety guardrails that were already
exercised by the accepted disposable non-root systemd sandbox. It does not derive
production capacity from the measurements and it does not apply a live systemd
change.

## Exact source guardrails

| service | MemoryMax | bytes | TasksMax |
|---|---:|---:|---:|
| API | 1G | 1,073,741,824 | 128 |
| worker | 900M | 943,718,400 | 128 |
| portal | 700M | 734,003,200 | 128 |

The accepted sandbox result at
/root/octoport-control/logs/B/b05-nonroot-systemd-sandbox-staging-rehearsal-r1-20261004/RESULT.json
read back these exact MemoryMax values and TasksMax=128 on the three transient
services, with useful control-plane smoke passing. That receipt explicitly
classifies them as staging safety guardrails and keeps production_limits_selected=false.

MemoryHigh and CPUQuota remain unresolved and are intentionally absent.
No other resource directive is authorized by this task.

## Accepted bounded measurements

The validator binds these accepted measurements only to prove that each
observed RSS/HWM/task maximum stays below the already-exercised owner-test
guardrail:

| evidence | API HWM/tasks | worker HWM/tasks | portal HWM/tasks |
|---|---:|---:|---:|
| functional envelope | 433,836,032 / 35 | 383,545,344 / 35 | 200,798,208 / 19 |
| 100 sequential cycles | 462,643,200 / 23 | 373,473,280 / 23 | 252,018,688 / 19 |
| synchronized burst diagnostic final-current | 475,652,096 / 23 | 358,346,752 / 23 | 297,086,976 / 19 |

Sources:
- docs/development/coordination/receipts/C/B05_NONROOT_SERVICE_RESOURCE_ENVELOPE_2026-10-01.md
- docs/development/coordination/receipts/A/B05_FIRST_WAVE_SEQUENTIAL_RESOURCE_ENVELOPE_2026-10-01.md
- /root/octoport-control/logs/A/b05-first-wave-burst-staircase-20261001/run-r1/c05-three-service-rollback-evidence.json

The synchronized diagnostic used stages 1/2/4/8/16/32/64/100, 227 cycles
and 1,816 safe requests. It is explicitly NOT_REPRESENTATIVE_CONCURRENCY_MODEL
and NOT_PRODUCTION_CAPACITY_PROOF. Stage 100 is not 100 representative users,
and that diagnostic is not claimed to have run under the MemoryMax values
published by this source slice.

## Fail-closed source contract

owner_test_resource_guardrails.py accepts only the exact three owner-test
resource templates. Each template must contain one Service section and exactly
two directives: the role-specific MemoryMax above and TasksMax=128.

It rejects missing or extra service templates, duplicate directives, changed
values, wrong sections, noncanonical service roles and every unapproved third
resource directive, including MemoryHigh, CPUQuota, CPUWeight and RuntimeMaxSec.

The evidence validator also requires the exact accepted evidenceLevel and field
schema for functional, sequential and burst slices. Extra claim fields or extra
service-metric fields fail closed. It rejects any bound RSS/HWM/task observation
that is equal to or above its guardrail and rejects widened burst/capacity claims.

## Non-claims and side-effect boundary

This is SOURCE evidence only.

- no representative-user concurrency model is established;
- no production capacity or final production ceiling is established;
- no live owner-test unit, cgroup, service or deployment is changed;
- no systemctl, transient unit, database, provider, browser or network action
  is performed by the validator;
- the separately accepted non-root service identity and maintenance-storage
  cutover boundaries remain independent prerequisites for any future live apply.
