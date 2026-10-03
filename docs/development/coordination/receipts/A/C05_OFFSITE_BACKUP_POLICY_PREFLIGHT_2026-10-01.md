# C05 off-host backup policy preflight — 2026-10-01

Status: **SOURCE POLICY PREFLIGHT CANDIDATE / INDEPENDENT REVIEW PENDING**.

Task: `C05-OFFSITE-BACKUP-POLICY-PREFLIGHT`.
Role: A.

## Basis

C05 already proves disposable PostgreSQL restore, forward migration, application startup and a compatible rollback floor. Separately, accepted C04/C05 ops source contains `backup_postgres_independent.py`, which provides a verified custom-format backup on an independent mounted filesystem with seven-success retention.

The remaining readiness gap is whole-host failure-domain independence plus explicit RPO/RTO and a later restore drill from the owner-selected destination.

This task does not change the backup runtime.

## New source

- `tooling/operations/offsite_backup_policy.py`;
- `tooling/operations/test_offsite_backup_policy.py`;
- `docs/product/readiness/OFFSITE_BACKUP_POLICY_TEMPLATE.json`;
- `docs/product/readiness/OFFSITE_BACKUP_POLICY.md`;
- this receipt.

## Contract

The validator has two source states:

- `OWNER_DECISION_PENDING` -> `OWNER_DECISION_REQUIRED`;
- `OWNER_DECISION_RECORDED` -> at most `READY_FOR_OFFSITE_REHEARSAL`.

Recorded state requires an owner-selected `OFF_HOST_MOUNTED_FILESYSTEM`, explicit host-failure-domain independence/source-host-loss survivability, the fixed non-secret sentinel `destinationReference=OWNER_SELECTED_OFFHOST_DESTINATION_1`, positive integer RPO/RTO targets, exact existing retention/timer semantics, and the complete future restore-gate list. Failure-domain independence is a destination-decision prerequisite; it is intentionally not an additional restore gate.

The restore-gate list is exactly:

1. `ARCHIVE_HASH_AND_BYTES_VERIFIED`;
2. `PG_RESTORE_LIST_VERIFIED`;
3. `SELECTED_DESTINATION_ARCHIVE_READBACK_VERIFIED`;
4. `DISPOSABLE_DATABASE_RESTORE_VERIFIED`;
5. `MIGRATION_JOURNAL_READBACK_VERIFIED`;
6. `PROTECTED_STATE_INVARIANTS_VERIFIED`;
7. `APPLICATION_HEALTH_AND_BOOTSTRAP_VERIFIED`;
8. `COMPATIBLE_ROLLBACK_FLOOR_VERIFIED`;
9. `BACKUP_AGE_WITHIN_RECORDED_RPO_VERIFIED`;
10. `MEASURED_RESTORE_DURATION_WITHIN_RECORDED_RTO_VERIFIED`.

No state emitted by this tool has `productionAccepted=true`; restore evidence is required to remain `NOT_RUN` in the policy preflight.

## Parent source verification so far

- `python3 -m unittest tooling.operations.test_offsite_backup_policy`: **15/15 PASS**;
- `py_compile`: PASS;
- `git diff --check`: PASS;
- repository pending template is parsed by the same validator and remains `OWNER_DECISION_REQUIRED`;
- repository source-drift guard verifies the existing backup helper still declares seven-success retention, `octoport-postgres-backup-v1`, independent-mount verification and `pg_restore`, and the timer still declares `daily / Persistent=yes / RandomizedDelaySec=30m / AccuracySec=5m`.

The tests cover:

- pending template;
- complete recorded decision;
- partial pending owner data rejection;
- same-host/non-offhost rejection;
- fixed non-secret destination sentinel plus rejection of path/URL/key/token-like arbitrary replacements;
- missing/zero/negative/non-integer RPO/RTO;
- exact seven-success/current-timer retention contract;
- missing/extra/reordered restore gates, including the exact `SELECTED_DESTINATION_ARCHIVE_READBACK_VERIFIED` gate;
- prohibition on predeclared restore PASS;
- recursive secret-field rejection;
- duplicate JSON-key rejection before validation, including credential-like first value plus accepted sentinel second value;
- unknown fields;
- symlink policy-file rejection.

Combined with the unchanged existing backup-helper suite: **26/26 PASS**.

## Existing backup behavior retained

This source policy relies on, but does not modify:

- `octoport-postgres-backup-v1`;
- custom-format `pg_dump`;
- `pg_restore --list` validation;
- SHA-256/byte manifest;
- atomic publish;
- independent mount-source/device guard;
- retention of seven revalidated successful backups;
- daily persistent timer with randomized delay.

Parent source identities at this check:

- existing backup helper SHA-256: `90917d501ca8062696335b8a863047e3774ed477d349aa4a6648788000012d37`;
- existing backup timer SHA-256: `e24d1579b7b85c9d383cdacaea5502aff021dc070274fb728e7307db3410fafa`;
- new policy validator SHA-256: `f99ff95bd1d2b9a978ca5883ea92a417ec2118cf9efdb20f4e2c721f9e2462c4`;
- new policy tests SHA-256: `b00bdbdc777dbe023276001502f970bd37ff5d16f2759ac1a13f796638689279`;
- pending template SHA-256: `77912f25ffccd1d2ae3a2cf94c4a1dcf4466c60d2df3d990575489fe96d2d8bc`;
- readiness policy doc SHA-256: `766a262106fa29326eec8f2002961a0b6ad614e1d97239aae2a93940b487e0f6`.

A separate verification pass of the existing backup helper remains part of parent acceptance.

## Independent review history

R1 review:

`/root/octoport-control/logs/A/c05-offsite-backup-policy-review-20261001-result.md`

Verdict: **REWORK_REQUIRED**.

Blocking finding: the original free-form `destinationReference` key could structurally carry a credential-like string even though secret-like key names were rejected. R1 correction removes free-form destination identifiers from policy evidence entirely: recorded policy accepts only the constant non-secret sentinel `OWNER_SELECTED_OFFHOST_DESTINATION_1`, while the real provider/path/access identity remains protected runtime evidence outside Git. Regression cases reject filesystem paths, provider URLs, AWS-key-like and token-like replacements.

R2 review:

`/root/octoport-control/logs/A/c05-offsite-backup-policy-review-r2-20261001-result.md`

Verdict: **REWORK_REQUIRED**.

Blocking finding: standard JSON duplicate-key handling could preserve a credential-like first `destinationReference` in the physical file while semantic validation saw only a later accepted sentinel. The current parser now uses a strict object-pairs hook that rejects duplicate keys at every JSON object level with `POLICY_JSON_DUPLICATE_KEY`; a raw duplicate-key regression is included.

Post-R2 combined suite: **26/26 PASS**.

R3 review:

`/root/octoport-control/logs/A/c05-offsite-backup-policy-review-r3-20261001-result.md`

Verdict: **REWORK_REQUIRED**.

Blocking finding: the candidate had added `OFF_HOST_FAILURE_DOMAIN_EVIDENCE_VERIFIED` as an eleventh restore gate even though the task contract requires the exact ten restore gates. The current source removes that extra gate. Failure-domain independence remains mandatory at the owner-decision layer through `hostFailureDomainIndependent=true` and `sourceHostLossSurvivable=true`.

Post-R3 combined suite: **26/26 PASS**. The required restore-gate list is exactly ten entries.

R4 review:

`/root/octoport-control/logs/A/c05-offsite-backup-policy-review-r4-20261001-result.md`

Verdict: **REWORK_REQUIRED**.

Blocking finding: source/template had the correct ten restore gates, but policy/receipt prose still described failure-domain evidence as an additional restore gate. The current docs now make it a destination-decision prerequisite and enumerate exactly ten restore gates.

R5 review:

`/root/octoport-control/logs/A/c05-offsite-backup-policy-review-r5-20261001-result.md`

Verdict: **REWORK_REQUIRED**.

Blocking finding: the receipt referred to the complete ten-gate contract but did not enumerate those ten gates itself. The current receipt now lists the same exact ten identifiers as validator, template and policy doc.

A fresh exact-candidate review is required after all five corrections.

## Limits

Evidence level: **SOURCE_POLICY_PREFLIGHT**.

No filesystem mount, network upload, provider account, payment, credential, live DB backup/restore, systemd enable/start or production RPO/RTO claim is part of this task. Independent review R1 correctly required removal of the free-form destination-reference value; actual destination identity remains outside Git.

Owner input is still required before the later off-host rehearsal: destination/access choice plus explicit RPO and RTO objectives. If that destination requires a new paid resource or external access, that purchase/access remains an owner action.
