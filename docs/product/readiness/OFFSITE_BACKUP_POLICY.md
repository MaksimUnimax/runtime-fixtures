# Off-host PostgreSQL backup policy

Status: **SOURCE POLICY PREFLIGHT / OWNER DECISION AND OFF-HOST REHEARSAL NOT RUN**.

This document closes only the policy ambiguity around the existing Octoport independent PostgreSQL backup tooling. It does not choose or purchase a storage provider, does not configure credentials, and does not claim production RPO/RTO.

## What already exists

Accepted source already provides `tooling/operations/backup_postgres_independent.py` and production unit/timer templates.

The existing backup runtime:

- writes PostgreSQL custom-format archives;
- publishes through a private incomplete directory and atomic rename;
- records exact archive SHA-256 and byte count;
- requires a non-empty `pg_restore --list` result;
- revalidates manifest/hash/size/archive listing before an archive counts toward retention;
- keeps **7 verified successful archives**;
- rejects a backup destination that is the same mount source or the same device as the PostgreSQL data mount;
- uses a daily persistent systemd timer with up to 30 minutes randomized delay and 5 minutes accuracy;
- does not enable/start itself during source preparation.

These controls protect against several local-storage failure modes. They do **not** by themselves prove survival of complete source-host loss.

## Remaining disaster-recovery decisions

Before off-host backup can be rehearsed, the owner must explicitly decide:

1. a destination that is genuinely outside the source host failure domain and is exposed to the existing backup runtime as a mounted filesystem;
2. a maximum acceptable data-loss objective (**RPO**, minutes);
3. a maximum acceptable restore-time objective (**RTO**, minutes).

The source project deliberately does not invent these values or select a paid provider.

The selected destination is represented in the policy only by the fixed non-secret sentinel `destinationReference=OWNER_SELECTED_OFFHOST_DESTINATION_1`. The real provider, account, bucket/share, mount path, access keys and credentials stay outside Git and are mapped to that sentinel only in protected runtime configuration. Arbitrary reference values are rejected.

## Policy states

### OWNER_DECISION_PENDING

The repository template is intentionally in this state.

- destination class/reference are unset;
- off-host/failure-domain claims are unset;
- RPO/RTO are unset;
- result is `OWNER_DECISION_REQUIRED`.

Partial owner input fails closed instead of being treated as a usable policy.

### OWNER_DECISION_RECORDED

A decision can pass source validation only when all of the following are explicit:

- `destinationClass=OFF_HOST_MOUNTED_FILESYSTEM`;
- `runtimeAccess=EXISTING_MOUNTED_FILESYSTEM_BACKUP`;
- `ownerSelected=true`;
- `hostFailureDomainIndependent=true`;
- `sourceHostLossSurvivable=true`;
- the exact non-secret sentinel `destinationReference=OWNER_SELECTED_OFFHOST_DESTINATION_1`;
- positive integer RPO minutes;
- positive integer RTO minutes;
- the exact existing retention/schedule contract;
- the exact restore-drill gate list.

Even then the status is only `READY_FOR_OFFSITE_REHEARSAL`.

It is **not** backup acceptance, RPO proof, RTO proof or production readiness.

## Retention semantics

Gold policy v1 binds the existing source behavior exactly:

- model: `KEEP_VERIFIED_SUCCESSFUL_COUNT`;
- `keepSuccessful=7`;
- schedule: `DAILY_PERSISTENT`;
- randomized delay: 30 minutes;
- timer accuracy: 5 minutes.

Seven successful archives must not be described as “seven days of retention”. Missed runs, destination outages or host downtime can make the calendar span different.

The daily timer must not be used as proof that any particular RPO is achieved. Actual off-host evidence must later compare the age of the accepted backup used for restore with the recorded RPO target.

## Required off-host restore rehearsal

Before the restore rehearsal, the recorded owner decision must already assert `hostFailureDomainIndependent=true` and `sourceHostLossSurvivable=true`; those are destination-decision prerequisites, not restore gates.

A future authorized rehearsal must satisfy exactly the ten gates below:

1. exact archive hash and byte count verified;
2. `pg_restore --list` verified;
3. the exact archive is read back from the selected destination;
4. restore into a disposable PostgreSQL database;
5. migration journal readback;
6. protected application-state invariants read back;
7. runnable application health and signed-bootstrap checks;
8. compatible rollback-floor check;
9. accepted backup age compared against the recorded RPO;
10. measured end-to-end restore duration compared against the recorded RTO.

The existing C05 recovery evidence remains the source of restore/application/rollback semantics. This policy does not create a second backup format or a second rollback model.

## Privacy boundary

The validator rejects duplicate JSON object keys before schema validation and rejects secret-like fields recursively. This prevents a credential-like duplicate value from being hidden behind a later accepted key. Policy files must not contain:

- password or DATABASE_URL;
- token/credential/secret/access key;
- OTP or cookies;
- marketplace/customer payloads.

The policy also does not need an account ID, store ID or provider account name.

Actual destination access belongs in a protected runtime environment file or platform-specific secret store selected during a later authorized operation.

## Owner input template

The checked-in template is:

`docs/product/readiness/OFFSITE_BACKUP_POLICY_TEMPLATE.json`.

It is deliberately unusable for rehearsal until the owner decision is recorded. It contains no destination path, provider, credential, RPO or RTO.

After owner decisions exist, create a protected non-Git policy instance and run:

`python3 tooling/operations/offsite_backup_policy.py /protected/path/policy.json`

A PASS from this validator means only `READY_FOR_OFFSITE_REHEARSAL`.

## Evidence boundary

This source slice proves:

- the missing owner decisions are explicit;
- same-host/separate-mount is not accepted as off-host disaster recovery;
- retention semantics match the existing backup code;
- RPO/RTO cannot be left unset or non-positive;
- restore acceptance cannot omit a required gate;
- policy metadata cannot contain secret-like fields, and the only free destination-reference value was removed in favor of a fixed non-secret sentinel;
- no source path can auto-claim production acceptance.

It does **not** prove:

- any external/off-host destination exists or is reachable;
- any provider/payment/access is configured;
- a live backup has been written off-host;
- actual RPO/RTO;
- production restore;
- timer/service enablement;
- live database mutation.
