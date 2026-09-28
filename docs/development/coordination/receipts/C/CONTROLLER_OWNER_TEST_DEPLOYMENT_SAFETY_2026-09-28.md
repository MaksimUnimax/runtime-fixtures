# Bounded owner-test deployment safety

Assignment before implementation, 2026-09-28.

Controller owns only these new paths on base c2e715501161d421b1641bb697c7ee7786d84960:
- `tooling/operations/deploy_owner_test.py`
- `tooling/operations/test_deploy_owner_test.py`
- `tooling/operations/check_owner_test_migration_prefix.ts`
- `docs/development/coordination/receipts/C/CONTROLLER_OWNER_TEST_DEPLOYMENT_SAFETY_2026-09-28.md`

C owns acceptance, integration and any authorized deployment. The prepared C wrapper is the starting implementation; its active original is not edited. Schema/DB authorship remains B. No live deployment, login, provider request or store acceptance is claimed.

## Why this task is on the manual-version path

The prepared backend candidate already exists. Safe switching and recovery were the available independent engineering boundary before normal reviewer login and the useful STORE flow. Controller did not add a new product feature, change authentication, edit B migrations or interrupt C integration.

The original local R7 wrapper could restart the old application after a successful migration followed by readback failure, or after the backup restoration itself failed. Both were reproduced as old application + new database state. The old wrapper also lacked an exclusive invocation/unfinished-operation fence and ignored stop failures when switching to the recovery application.

## Implementation

The tracked successor is `tooling/operations/deploy_owner_test.py`; C's active local original was not edited. This is deliberately a pinned operation, not a generic deploy platform:
- backend `62024d192a8572c11aafab91653330d1f996699f`, canonical 40 migrations through 0051;
- compatible forward-schema application floor `d24838669c54f21dc161dc48a7e71e0e288384c2`;
- only the existing owner-test API, worker and portal;
- same separately required owner authority as R7; no controller invocation supplied it;
- STORE 0.2.6 bytes, monitor services and production remain outside apply.

Explicit schema states distinguish verified legacy, unknown and verified forward schema. The old application may start only after a fresh-backup restoration AND canonical history validation. If recovery cannot be proved, all three product stop operations are attempted and the failure is retained for C; there is no optimistic restart. A verified forward schema recovers only to the previously rehearsed compatible floor.

An OS lock rejects concurrent apply. Atomic, fsynced evidence records unfinished mutation before the write boundary; a killed invocation blocks a later apply pending C recovery. Corrupt or unfinished state is not reset automatically. C must inspect the referenced receipt, prove the actual database/application state, and record recovery before clearing this fence; do not delete it merely to retry. Missing owner authority fails before acquiring the apply guard.

The canonical migration checker imports B's validator/runtime from the immutable backend release, not moving main. It executes only SELECT checks, consumes the supplied private connection through process environment and emits only count/latest metadata. It is used before mutation, on the isolated restored database, after forward migration and after backup restoration. No schema or migration is authored here.

Partial stop failures do not prevent attempting the remaining two stops; actual inactive state is required before changing paths. A recovered floor returns a distinct result and CLI exit 2, not successful candidate deployment. Exceptions cannot copy raw database/subprocess output into receipts.

## Verification and limits

- Original two regression tests: both FAIL by reproducing old application started on new schema. Supervisor `c6b3846e9f2c4174af3327d82ff7da3d`, exit 1, cleanup verified.
- Final failure matrix: **20/20 PASS**, supervisor `66710b895be74763b43811d459087a67`, exit 0, peak 23 MiB, OOM 0, cleanup verified.
- Cases include readback loss, failed/verified restoration, compatible floor, failed floor/old health, failed stop, missing authority, concurrency, corrupt/unfinished journal, disk-write failure, error privacy, nonzero rollback CLI and real child SIGKILL at the migration boundary. Service, database and network mutations are mocked. The child kill proves the journal survives process death after the OS lock is released.
- Real server **read-only preflight PASS**, supervisor `c45a09697c4a4e14a12e2e5dae09fa5c`, exit 0, peak 375 MiB, OOM 0, cleanup verified. Both immutable releases verify, live DB has the exact 22-migration prefix, API live/ready and portal login return 200. Existing product paths remain `/root/runtime-fixtures-preprod-r1`. This does not prove forward deployment or authenticated controls.
- TypeScript helper formatted; Python syntax and `git diff --check` pass. No new dependency, no DB write, service switch, registration, OTP, provider request or Telegram send by this task.
- One test admission briefly deferred due to measured memory pressure; it was retried after pressure subsided without lowering the budget or bypassing the supervisor.

Evidence directory: `/root/octoport-control/logs/controller/owner-deploy-safety-20260928/`.
Original wrapper SHA256: `267e94ecb15383499e2af6cdef5444966c268a7d99c9fb0121a85bae604c63ab`; preserved as `original-deploy-owner-test.py`, paired with `original-two-repro-tests.py` and `red.log`. Final tests: `final-tests-r2.log`; read-only evidence: `read-only-preflight.log`.

## C handoff

Independently review the exact candidate and these failure branches; integrate only the four reserved paths through the normal C gates. Retire the old local wrapper from the executable runbook after acceptance and name this tracked tool's exact commit. The immutable application/DB migration bytes and prior C05 runtime rehearsal are unchanged; do not invent a fresh app candidate to deploy current monitoring work.

Only after this correction is accepted is the already prepared bounded owner-test deployment ready for its separate specific owner authorization. Then C alone performs the R7 backup/restore/migration/switch operation, followed by normal reviewer login and the exact STORE useful-flow acceptance under their existing scope. A passive login-page HTTP 200 is not ordinary authenticated login. Do not block this path on completion of B19/monitoring-all-AI work.

Controller worktree role guard returns ROLE_LOCATION_MISMATCH by design (it binds C to /root/octoport-main). The guard was not changed or bypassed with a fake role. Manual exact-path audit matches the precommitted four-path assignment, and C must run its normal guard during integration.
