# Alisa platform · AL-S00 source candidate

Independent product workspace. Matrix and marketplace execution are owned by another executor.
Canonical plan: [START_HERE v0.5](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/service-platform/v0.5/START_HERE.md).

**Status: IN_PROGRESS / NOT_ACCEPTED.** DNS/TLS setup is not an installed platform.
No OIDC, registration, customer reports or payments are implemented at AL-S00.

## Toolchain and source checks

Python 3.12; Node 24.22.1; pnpm 10.34.5; Next 16.4.5 / React 19.3.1;
Django 5.2.19 LTS, psycopg 3.3.8, gunicorn 26.2.0. Runtime and dev Python dependencies
are hash-locked. The two service lockfiles are intentionally identical at this step.
No root workspace/lockfiles are modified.

From this directory:

```sh
./bin/alisa bootstrap --locked
./bin/alisa test --scope foundation
./bin/alisa build
./bin/alisa package --source FULL_COMMITTED_HEAD_SHA
```

`test` runs SOURCE/negative boundary checks. A separate disposable PostgreSQL and
packaged-browser qualification is defined in CI; it is **not real stage/release acceptance**. Missing integration evidence remains open in `FOUNDATION_PROGRESS.md`.
Build does not load secrets or alter a database. Package refuses dirty source and embeds
source, toolchain, locks, contract hashes, migration hashes and file checksums; Next standalone
bundles and an offline wheelhouse are included. This is not a claim of byte-reproducible builds.

## Data ownership and process boundary

Web/admin have no DB credentials. BFF forwards only validated foundation UUID/kind to a fixed
loopback URL with its own service token. Browser headers do not become service identity.
Engineering access requires Basic-over-TLS plus an ingress IP allowlist; POST also requires
the exact allowed Origin. Production always returns 404 for the probe.

Platform and identity each own a separate PostgreSQL database, migration role, runtime role,
secret key and configuration. UUID identity model is selected before auth migrations.
There is no cross-database access, email merge, imported Octoport backend, matrix database,
marketplace credentials or live provider call. RuntimePort returns RUNTIME_NOT_CONNECTED.

Probe + job are created in one transaction, keyed by UUID. Worker locks a job and persists
one effect in the same transaction. Retries are safe. Probe rows expire after 24h; the worker
cleans expired rows. An independent hourly cleanup timer continues after write-probe shutdown. Safe release receipts belong outside probe tables.

## Stage installation and current qualification

ENV-00 requires CPU/RAM/disk admission, own users/directories, PostgreSQL and a private engineer
access path. The target currently runs r2 `alisa-29c99f6d9d00f19e` from the qualified
immutable package; installation, restart and r1-r2-r1 facts are recorded in
[stage execution evidence](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/service-platform/execution/AL_S00_STAGE_2026-11-04.json).
Independent case acceptance is still pending. The owner upgraded the target to 4 CPU/8 GB on 2026-11-04; verify current capacity
before installation. Build on the separate CI runner. Do not copy old secrets.

1. Provision `/opt/alisa-platform/stage/releases`, `/etc/alisa-platform/stage`, own service
   users `alisa-{web,admin,platform,identity,worker}-stage` and the corresponding private
   configuration. See `.env.example`; identity uses distinct DB/secret and no service token.
   Worker uses platform runtime DB permissions. Migration configs are explicitly `/etc/alisa-platform/stage/platform-migration.env` and
   `/etc/alisa-platform/stage/identity-migration.env`. They use the matching migration DB
   role instead of the runtime role; all Django required config names still apply.
   `doctor --env stage` checks these two files as well as all four runtime config files.
   Its ready flag covers only local tools/config presence, not INFRA_READY or installation admission.
2. From an approved private admin DSN create **new** databases using `infra/db/provision.py`.
   Input JSON is mode 0600; it contains `platform` and `identity` objects, each with
   `migration_password` and `runtime_password`. The script stops if a name already exists.
3. Install only this workspace's `infra/systemd/alisa-*@.service`; no existing unit is edited.
   Run `systemctl daemon-reload`, then `systemctl enable --now alisa-probe-cleanup@stage.timer`
   after the first compatible migration and activation. Install nginx config only for the three new stage names;
   run `nginx -t` before reload. Production remains setup-only.
4. `./bin/alisa deploy --env stage --artifact PATH --sha256 EXPECTED_HASH` verifies/extracts
   immutable bytes and installs wheels offline. It **does not activate** an unmigrated release.
5. `./bin/alisa migrate --env stage --release RELEASE_ID --plan`, then the corresponding
   `--apply`. Read back migration heads with the migration role; runtime roles cannot DDL.
6. `./bin/alisa rollback --env stage --release RELEASE_ID` switches current code and restarts
   only Alisa units, checking all four readiness/version responses. It never restores old DB data.
7. Open `/__engineering`, create a UUID and verify PROCESSED. `verify --env stage --scope
   foundation` supplies an additional HTTP roundtrip, not browser acceptance. Record restart,
   concurrent repeats, DB failures and r1→r2→r1 with a compatible expand-only migration.
8. `evidence --env stage --step AL-S00` prints safe installed metadata, always NOT_ACCEPTED
   until an independent reviewer records all 18 cases. See probe shutdown below;
   a code switch does not restore or change the external configuration flags.

CI retains each qualified immutable tarball and its SHA256 as an Actions artifact for
14 days; download those exact bytes for installation, then keep both admitted rollback
releases on the target. Do not rebuild a published release on the target.

Target author qualification has installed both immutable packages, applied and repeated
the compatible pending-job index migration, and read the same one-effect probe through
r1 → r2 → r1 → r2. This is not independent acceptance of all 18 cases.
Do not advance to AL-S01 until FOUNDATION_READY. SMTP is a separate AL-S01 input.

For disposable qualification only, see `tests/integration/run_postgres.py --help`.
It refuses any target except the explicit alisa_ci_admin user/database on127.0.0.1:55480
with ALISA_TEST_DB_ALLOW=1. Never point it at a shared or live PostgreSQL. CI creates
a fresh job-local PostgreSQL16.15 service; credentials are synthetic, and no live secrets
are provided. The safe JSON receipt reports its own scope and FOUNDATION_READY=false.


## Probe shutdown and acceptance receipt

After the finite acceptance run, stop `alisa-web@stage.service` and run
`systemctl disable --now alisa-worker@stage.service` to close the ingress and drain
this worker. Disabling it also prevents a reboot from starting it with the probe off. In the private
files `/etc/alisa-platform/stage/web.env` and `/etc/alisa-platform/stage/platform.env`,
set the existing `FOUNDATION_PROBE_ENABLED` key to `0`, keeping mode 0600 and ownership.
Restart only `alisa-platform@stage.service` and `alisa-web@stage.service`. Verify an
authenticated POST to `/api/engineering/probes` and GET `/__engineering` return 404,
and that the probe row count does not increase. Keep
`alisa-probe-cleanup@stage.timer` enabled/active; identity/admin and existing lab/runtime
services are unaffected. Reopening the engineering probe requires the reverse explicit
stage maintenance operation; never enable it in production.

`evidence` prints safe installed metadata with NOT_ACCEPTED; it is not the 18-case
receipt. The independent reviewer records each AL-T00-01 through AL-T00-18 result,
exact source/artifact/release, config fingerprints without values, migration heads,
actual observations and remaining failures in a separate safe execution JSON under
`docs/alisa/service-platform/execution/`. The original v0.5 TEST_PLAN remains an
immutable specification, not a mutable test log. FOUNDATION_READY requires the complete
reviewed receipt, not a count of source tests.
