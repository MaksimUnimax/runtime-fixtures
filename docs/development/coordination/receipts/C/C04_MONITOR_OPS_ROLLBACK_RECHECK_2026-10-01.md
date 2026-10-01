# C04 monitor ops rollback recheck — 2026-10-01

Status: **PASS — OFFLINE_ROLLBACK_REHEARSAL + LIVE_UNIT_READBACK / LIVE SWAP NOT AUTHORIZED**.

Task: `C04-MONITOR-OPS-ROLLBACK-RECHECK`.

Prepared immutable monitor release:

`ef363662150b31704227b19f7b7ec4d2d8e248d6`

Release verifier:

- status: PASS;
- files: 25,402;
- symlinks: 917;
- Telegram built entry SHA-256:
  `e80e8e8d0e2f71398ac0709ff184cf1206d8c4ea6ddfb16c8f2360a820e1a0b0`.

## Current live baseline

Telegram operator:

- release: `c2e715501161d421b1641bb697c7ee7786d84960`;
- active/running at recheck;
- `NRestarts=0`;
- live unit SHA-256:
  `216297169b472efa028f32311663c2f83d6c9671999f7ddd5928e0a737ebff25`.

Health notifications:

- release: `c2e715501161d421b1641bb697c7ee7786d84960`;
- active/running at recheck;
- `NRestarts=0`;
- live unit SHA-256:
  `90407adf6a0ea18747c2c06caeeaf5321e70078d529f27c093963f5f7c963ef3`.

Retention:

- release: `fe3b4aeb9bcd41a038f79d7c233a6866b314a0fc`;
- timer active/waiting;
- service unit SHA-256:
  `4c39d69b8bb2cfb069709f12e64f7ab2f7263a0e3b150506c30cd5df10ab81bf`;
- timer SHA-256:
  `c5dc665b8f4bc4b4c7aa1a3669199e158443f4fa1a14510f03959e5ad89a54ab`.

Current rollback release verifiers also PASS:

- `c2e71550...`: 25,208 files / 1,152 symlinks;
- `fe3b4aeb...`: 25,283 files / 917 symlinks.

No protected EnvironmentFile contents were read.

## Why the final swap is Telegram-only

The first rehearsal deliberately tested an overbroad three-unit candidate and proved that it was syntactically restorable. It is retained only as evidence and is **not** the recommended live plan.

### Retention

The actually executed retention chain is byte-identical between live
`fe3b4aeb...` and candidate `ef363662...`, including:

- `tooling/operations/monitor_pilot_retention_runner.py`;
- `tooling/server/monitor-pilot-retention.ts`;
- `tooling/server/monitor-pilot-authority.ts`;
- DB index and health-retention repository;
- P7 command/profile repositories;
- adapter registry;
- remote config/shared modules;
- no-session target authority and strategies.

The new release contains unrelated later source/migration/test material, but there is no accepted reason to replace the live retention service/timer merely to obtain the already-identical retention runtime.

**Disposition: keep retention on `fe3b4aeb...`.**

### Health notifications

The health business runtime is also unchanged between live `c2e71550...` and
candidate `ef363662...`:

- DB schema;
- health notification runner/runtime;
- Telegram health delivery;
- health notification repository.

The DB index gained additional exports, while the
`createDatabaseRuntime` implementation block remains byte-identical.

Changing health would therefore create an unnecessary new wrapper/module graph without closing an identified health gap.

**Disposition: keep health notifications on `c2e71550...`.**

### Telegram operator

Telegram is the actual changed runtime:

- live built entry SHA-256:
  `0be3377d637381c2a27b02d2465f316d48ca739b2599fb3408c8138d7d5b5681`;
- candidate built entry SHA-256:
  `e80e8e8d0e2f71398ac0709ff184cf1206d8c4ea6ddfb16c8f2360a820e1a0b0`.

The source delta includes Telegram monitoring explanation/runners/main changes.

The accepted staged Telegram candidate unit is exactly the current live unit with only the release SHA changed from `c2e71550...` to `ef363662...`.

Candidate unit SHA-256:

`b44371d26063d8a4faba5439ca185321e6dc40da2ab8fe1cb111be2a5777e561`.

`systemd-analyze verify`: PASS.

## Rollback rehearsal

The exact current Telegram unit was captured as the rollback copy.

On a disposable filesystem:

1. the candidate unit replaced the rollback unit;
2. its candidate SHA was verified;
3. the exact rollback unit was restored;
4. the final SHA exactly matched the original live-unit SHA.

Result: **PASS**.

A broader exploratory rehearsal also verified:

- staged health wrapper imports all exist;
- wrapper `node --check`: PASS;
- staged candidate units `systemd-analyze verify`: PASS;
- five-file disposable restore: PASS.

That broader candidate is explicitly classified
`VALID_SYNTAX_BUT_OVERBROAD_NOT_RECOMMENDED`.

## No live mutation in this recheck

This work did **not** perform:

- `systemctl daemon-reload`;
- service start/stop/restart/enable/disable;
- writes under live `/etc/systemd/system`;
- wrapper installation under `/opt/octoport/monitor-pilot`;
- DB migration or maintenance apply;
- Telegram send;
- provider operation;
- authenticated H3 enablement;
- product API/worker/portal change.

Final readback still showed the existing live unit hashes and Telegram
`c2e71550...` active/running with `NRestarts=0`.

## Future authorized live plan

The prepared plan is:

`/root/octoport-control/logs/C/c04-monitor-ops-rollback-recheck-20261001/FUTURE_LIVE_SWAP_PLAN.json`

SHA-256:

`06acc4fcd8a596227f74c4b7e6253da9859456c95255a3dcb5267b9c9fb68c25`.

It is explicitly `PREPARED_NOT_AUTHORIZED`.

A future live apply must first have a **current task-bound sole-writer deployment authority** for this exact Telegram-only scope and must re-read the live hashes/states immediately before mutation.

Only then may it:

1. re-capture and verify the current Telegram rollback unit;
2. install only the accepted Telegram candidate unit;
3. daemon-reload;
4. restart only the Telegram operator;
5. verify the ef363662 working directory/ExecStart and healthy runtime;
6. prove health/retention/timer stayed unchanged.

Any failed postcondition restores the freshly captured Telegram unit, daemon-reloads and restarts only Telegram.

## Independent review

Control result:

`/root/octoport-control/logs/C/c04-monitor-ops-rollback-recheck-20261001/RESULT.json`

SHA-256:

`b18541dfec3667f4c275e97d4e733fa7e84ffcc41c4bfcc141e574885144aeae`.

Independent review:

`/root/octoport-control/logs/C/c04-monitor-ops-rollback-recheck-review-20261001-r1-result.md`

Verdict: **PASS**.

The reviewer confirmed that narrowing the future swap to one Telegram unit is technically justified and the offline rollback evidence is sufficient to close the rollback-recheck portion.

## Limits

This receipt grants **no live deployment authority** and proves no post-swap behavior.

A unit rollback cannot retract:

- a natural Telegram message already emitted while a future candidate was running;
- an ordinary compatible runtime DB observation written during that period.

The remaining live blocker after this receipt is the separate current
task-bound sole-writer authority plus the mandatory fresh pre-mutation readback.
