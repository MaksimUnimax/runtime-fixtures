# C05 immutable application-artifact recovery rehearsal

Date: 2026-09-25
Role: C
Status: **DISPOSABLE IMMUTABLE-ARTIFACT RECOVERY PASS / NOT LIVE**

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
