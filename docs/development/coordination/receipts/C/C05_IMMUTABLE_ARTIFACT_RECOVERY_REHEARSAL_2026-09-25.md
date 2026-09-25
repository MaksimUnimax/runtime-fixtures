# C05 immutable application-artifact recovery rehearsal

Date: 2026-09-25
Role: C
Status: **FINAL0051 DISPOSABLE IMMUTABLE-ARTIFACT RECOVERY PASS / TECHNICAL ROLLBACK FLOOR PROVEN / NOT LIVE**

## Inputs

Accepted B recovery archive:
- path: `/root/octoport-control/backups/B/b05-current0049-recovery-13520ae7baba.dump`
- SHA-256: `e3a6fb1bb00609a9bf986545a9afb6277c7b1972d98c5a0fc83660642ded6fd8`
- size: 401109 bytes
- mode: 0600
- recovered canonical migration count: 39 through source0049.

C restored that archive into its own disposable PostgreSQL container/database on the C test port. The accepted B retained target was not mutated by C05.
## Immutable application artifacts

C built two independent API artifacts from exact Git snapshots, each from a separate `git archive` plus its own frozen lockfile and offline install. No source-worktree symlink was used at runtime.

Candidate-side API artifact:
- source: `c520015cfa2a4630d06b3013b9cd78aafde352da`
- file SHA-256: `e69c1e4ba4b20ca2dbc90373d1b758519a7dfd8184f7ff8b3a1a208410faec60`
- bytes: 3804863.

Rollback-side API artifact:
- source: `f11b3d5` (post-N2 server-first compatible baseline)
- file SHA-256: `60509d406f0203c47d7a02109933bcf6288150cb80c4b0b269eb8ea12a6bbffb`
- bytes: 3800972.

Build resource job:
`469f965f6b42479a8cbef2748cc2f92d`, exit 0, peak ~467 MiB, cleanup verified.
## Rehearsal method

The C disposable database was freshly restored from the accepted B archive immediately before the successful run.

Synthetic authority and device identity were created only in that disposable C database through existing product services/repositories:
- signing key lifecycle and config publication through the P3 publication repository;
- synthetic extension device authorization/approval/exchange through the normal device services;
- normal extension access-token verification;
- no owner mailbox, marketplace secret, customer payload or production authority was used.

Each immutable artifact was launched by ordinary Node 24.20.0 as a separate process on the C API test port. Smoke traffic used real HTTP, not Fastify `inject()`.
## Verified behavior

For both candidate and rollback artifacts on the same forward source0049 database:

- `GET /health/ready`: HTTP 200.
- unauthenticated `POST /v1/sync`: HTTP 401.
- authenticated N2 read-only `POST /v1/sync`: HTTP 200.
- missing synthetic entity snapshot: revision 0, state null.
- cross-device installation mismatch: HTTP 403.
- signed `POST /v1/bootstrap`: HTTP 200.
- bootstrap Ed25519 verification: PASS.
- access basis: BETA.
- config version: 1.
- migration count before/after: 39 / 39.
- `sync_entities` before/after read-only smoke: 0 / 0.

Successful resource job:
`d517757f8ca34612b0299e1e11a015cf`, exit 0, peak ~376 MiB, cleanup verified.
## Result and limits

C05 proves an immutable application-code rollback can be performed against a recovered forward schema0049 disposable database without a down migration, while preserving authentication, N2 read-only behavior, isolation and signed bootstrap semantics.

It does **not** prove:
- live0049 migration or production backup/restore;
- production deployment or rollback;
- scheduled backup retention/RPO/RTO;
- Telegram delivery;
- current Firefox privacy-neutral runtime after later API/migration changes;
- store reviewer or store submission readiness.

The Firefox privacy-neutral work added after this rehearsal changes server/API/migration source. Therefore this C05 result remains valid evidence for the accepted pre-Firefox server line, but a fresh immutable-artifact rehearsal is required on the final server candidate before any deployment acceptance.

No live DB, production service, payment, store dashboard or owner secret was changed.
## Superseding final0051 rehearsal

After Firefox privacy-neutral C02 reached exact main `6e442755c514803a8bc6e04ce40a58bed2883c77` and all five post-main workflows passed, C repeated C05 against the final 0051 server line. This section supersedes the pre-Firefox rollback conclusion above for any future deployment decision.

The accepted B source0049 backup remained the starting authority:

- source backup SHA-256: `e3a6fb1bb00609a9bf986545a9afb6277c7b1972d98c5a0fc83660642ded6fd8`;
- source journal: 39/39 through 0049.

C restored it into its own disposable PostgreSQL database and applied the exact final-main migration set:

- migration resource job: `4a7112647cc54a27b7a6dfb48b58c404`;
- journal after migration: 40/40;
- `devices.browser_family` nullable as required by 0051;
- no live database was touched.
Synthetic final-state data was then created only through product services/repositories on the C disposable database:

- one PRESENT device with a complete technical metadata tuple;
- one WITHHELD device with the all-NULL technical metadata tuple;
- normal beta account/device/session authority;
- signed config authority bound to the disposable environment.

Seed resource job: `0509fe0313ae4bc2b1641dd875c4610a`, exit 0, cleanup verified.

C then created a new post-0051 backup after those rows existed:

- backup: `/root/octoport-control/backups/C/c05-final0051-state.dump`;
- SHA-256: `5a95e34431baa6d64159ea5cf912a719ad0e35fe78807c15d9380ea6dc175fc9`;
- size: 406256 bytes;
- mode: 0600.

That backup was restored into a separate C database. Readback proved:

- migration journal: 40/40;
- exactly one WITHHELD all-NULL device tuple;
- exactly one PRESENT device tuple.
### Immutable application artifacts

Three runnable API artifacts were exercised against the same restored forward-0051 database/state. Their exact source and file identities were recorded by the smoke harness:

- final:
  - source: `6e442755c514803a8bc6e04ce40a58bed2883c77`;
  - SHA-256: `006051ebef9ca058a076b1db13f81ed0f5e7b07a8be3165561e6538f4c23084d`;
- pre-Firefox rollback candidate:
  - source: `7945d62854e135421c3db003c603187b9f37866b`;
  - SHA-256: `7a0c2d1a1857b0042c63ec8b4cedd7032f4e2a65553ac268fca2155e1e092866`;
- technical rollback-floor candidate:
  - source: `d24838669c54f21dc161dc48a7e71e0e288384c2`;
  - SHA-256: `e61e51e2dbbf531c1dde53fbd9a001d2499c0c696c5a51ff8382f0dd337c47a2`.

The earlier exact-snapshot build resource job for the final and pre-Firefox artifacts was `df7ed012e51b44be8f3f0bb21e5bc79c`, exit 0, cleanup verified.
### Final artifact result

Resource job `14df80671e644091bc200fdbbd0c63ee` executed the final artifact and both rollback candidates with ordinary Node 24.20.0 processes against the same restored forward-0051 database.

Final `6e442755...` result:

- `GET /health/ready`: 200;
- PRESENT-device N2 read-only sync: 200;
- WITHHELD-device N2 read-only sync: 200;
- identified v2 bootstrap: 200, Ed25519 verification PASS;
- privacy-neutral v2 bootstrap: 200, Ed25519 verification PASS;
- no live/production mutation;
- resource exit 0, peak ~291 MiB, cleanup verified.

This proves the exact final application artifact starts and serves authenticated N2 plus both identified and privacy-neutral bootstrap modes on restored post-0051 state containing real persisted WITHHELD metadata.
### Rollback result and floor

Rollback to `7945d628...` on the same restored forward-0051 database/state produced:

- readiness: 200;
- PRESENT-device N2 read-only sync: 200;
- WITHHELD-device N2 read-only sync: 200;
- identified v2 bootstrap: 200, signature PASS;
- privacy-neutral bootstrap: **400**.

Therefore `7945d628...` is **not a valid rollback target after privacy-neutral clients can exist**. It may remain readable for some legacy paths, but rolling back that far would break the privacy-neutral contract and is prohibited for deployment planning after Firefox opt-out launch.

The `d248386...` rollback-floor artifact on the same restored database/state produced:

- readiness: 200;
- PRESENT-device N2 read-only sync: 200;
- WITHHELD-device N2 read-only sync: 200;
- identified v2 bootstrap: 200, signature PASS;
- privacy-neutral v2 bootstrap: 200, signature PASS.

So C05 proves a **technical application rollback floor at or after `d248386...`** for the final0051 state.
### Deployment boundary

The technical rollback-floor result is not itself release acceptance for historical commit `d248386...`. That SHA predates the later repository-wide consumer/test corrections that were required before exact-main five-CI became green. A production deployment plan must therefore retain a separately release-qualified rollback artifact whose runtime behavior is at least equivalent to the proven `d248386...` floor; it must not use `7945d628...` or any earlier privacy-neutral-incompatible artifact.

C05 final0051 now proves:

- real source0049 restore;
- forward migration to 0051;
- preserved PRESENT and WITHHELD data;
- post-migration backup and independent restore;
- exact final application-artifact startup;
- authenticated N2 and both bootstrap modes on restored state;
- a bounded technical rollback floor without down migration.

It still does **not** prove:

- live migration or production backup/restore;
- production deployment or rollback execution;
- scheduled backup retention/RPO/RTO;
- a separately release-qualified historical rollback package;
- store dashboard submission/reviewer completion;
- owner/live marketplace flows.

No live DB, production service, payment, store dashboard, owner secret or marketplace payload was changed.
