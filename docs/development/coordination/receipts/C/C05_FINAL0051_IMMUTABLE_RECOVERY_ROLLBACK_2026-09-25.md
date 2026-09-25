# C05 final0051 immutable recovery and rollback rehearsal

Date: 2026-09-25
Role: C
Status: **DISPOSABLE FINAL0051 RECOVERY PASS / ROLLBACK FLOOR ESTABLISHED / NOT LIVE**

## Authority and scope

Final source under rehearsal:

- main: `6e442755c514803a8bc6e04ce40a58bed2883c77`;
- five branch CI: PASS;
- five post-main CI: PASS;
- production/live DB mutation: not performed.

Accepted recovery seed:

- B source0049 archive: `/root/octoport-control/backups/B/b05-current0049-recovery-13520ae7baba.dump`;
- SHA-256: `e3a6fb1bb00609a9bf986545a9afb6277c7b1972d98c5a0fc83660642ded6fd8`;
- mode: 0600;
- source0049 journal: 39/39.
## Forward recovery to final0051

C restored the accepted B archive into a new C-only disposable PostgreSQL database and migrated it with exact final main.

Migration resource job:

- `4a7112647cc54a27b7a6dfb48b58c404`;
- exit 0;
- cleanup verified.

Post-migration state:

- migration journal: 40/40;
- `devices.browser_family`: nullable as required by 0051.

Synthetic authority and device state were then created only through existing product services/repositories, never by fixture SQL for the application state:

- one PRESENT device with complete Opera technical metadata;
- one WITHHELD device with browser family/version/extension version all NULL;
- beta access and active extension sessions;
- signed bootstrap/config authority.

Seed resource job:

- `0509fe0313ae4bc2b1641dd875c4610a`;
- exit 0;
- cleanup verified;
- runtime keys/tokens retained only in a private mode-0600 C state file.
## Backup and restore after 0051 data exists

C took a new PostgreSQL custom-format backup **after** migration and after both PRESENT/WITHHELD rows existed.

Backup:

- path: `/root/octoport-control/backups/C/c05-final0051-state.dump`;
- SHA-256: `5a95e34431baa6d64159ea5cf912a719ad0e35fe78807c15d9380ea6dc175fc9`;
- bytes: 406256;
- mode: 0600.

It was restored into a second C-only disposable database.

Restore readback:

- migration journal: 40/40;
- WITHHELD all-NULL client-metadata rows: 1;
- PRESENT complete client-metadata rows: 1.
## Immutable runnable application artifacts

Artifacts were built from separate exact `git archive` snapshots with their own frozen offline install.

The first plain ESM single-file bundle was correctly rejected as rehearsal evidence because bundled `pg` required CommonJS `require()` and failed startup with `Dynamic require of "events" is not supported`.

A CJS bundle was also rejected because the API entrypoint legitimately uses top-level await.

The runnable immutable format therefore remains ESM and adds only a build-time Node `createRequire(import.meta.url)` banner so bundled CommonJS dependencies use Node's normal require bridge. Product source was not patched for this packaging bridge.

Final artifact:

- source: `6e442755c514803a8bc6e04ce40a58bed2883c77`;
- SHA-256: `006051ebef9ca058a076b1db13f81ed0f5e7b07a8be3165561e6538f4c23084d`;
- bytes: 3905969.

Pre-Firefox rollback artifact:

- source: `7945d62854e135421c3db003c603187b9f37866b`;
- SHA-256: `7a0c2d1a1857b0042c63ec8b4cedd7032f4e2a65553ac268fca2155e1e092866`;
- bytes: 3882095.

Tested rollback-floor artifact:

- source: `d24838669c54f21dc161dc48a7e71e0e288384c2`;
- SHA-256: `e61e51e2dbbf531c1dde53fbd9a001d2499c0c696c5a51ff8382f0dd337c47a2`.

All three runnable artifact files passed `node --check`.
## Real HTTP smoke on restored final0051 DB

Final artifact result:

- `GET /health/ready`: 200;
- PRESENT-device N2 read: 200;
- WITHHELD-device N2 read: 200;
- identified v2 bootstrap: 200;
- identified bootstrap Ed25519 verification: PASS;
- privacy-neutral v2 bootstrap: 200;
- privacy-neutral bootstrap Ed25519 verification with `localClientAuthority`: PASS.

Pre-Firefox rollback `7945d628...` on the **same restored forward DB and same saved sessions/devices**:

- ready: 200;
- PRESENT N2 read: 200;
- WITHHELD N2 read: 200;
- identified bootstrap: 200 / signature PASS;
- privacy-neutral bootstrap: **400**;
- privacy-neutral signature: not available.

Therefore database readability alone does not make this rollback safe. Once a client/device is operating under privacy-neutral opt-out, rolling the server back to `7945d628...` would require a protocol downgrade that the client must not perform.
Tested rollback floor `d248386...` on the same restored final0051 DB:

- ready: 200;
- PRESENT N2 read: 200;
- WITHHELD N2 read: 200;
- identified bootstrap: 200 / signature PASS;
- privacy-neutral bootstrap: 200 / signature PASS.

Final artifact / legacy rollback / rollback-floor comparison resource job:

- `7dc27b67c6364c8aa6faa6485c323333`;
- exit 0;
- peak about 291 MiB;
- cleanup verified.

Post-smoke database readback remained:

- migration journal: 40/40;
- WITHHELD rows: 1;
- PRESENT rows: 1;
- `sync_entities`: 0 after read-only N2 smokes.
## Deployment rule produced by C05

For any deployment that can create or serve privacy-neutral/WITHHELD state:

1. schema stays forward at 0051; no down migration is part of rollback;
2. `7945d628...` and other pre-privacy-neutral server artifacts are **not valid rollback targets**;
3. `d24838669c54f21dc161dc48a7e71e0e288384c2` is a tested compatible rollback floor for the exercised API paths;
4. the exact release plan must retain a tested artifact at or above that floor;
5. a rollback must preserve the privacy-neutral contract; the client must never be forced to re-disclose technical metadata to make rollback work.

This establishes a tested floor, not a mathematical proof that every intermediate commit below/above it is safe. Only explicitly tested artifacts may be named as rollback targets.
## Acceptance boundary

C05 now proves, on disposable infrastructure:

- source0049 backup restore;
- forward migration to final0051;
- preservation and restore of real saved PRESENT + WITHHELD rows;
- startup of immutable application artifacts;
- real HTTP authentication/N2/bootstrap reads after restore;
- an explicit compatible rollback artifact on the forward schema;
- explicit rejection of the old pre-Firefox rollback target.

It does **not** authorize or prove:

- live0051 migration;
- production backup/restore;
- production deploy/rollback;
- RPO/RTO or scheduled backup retention;
- reachable `api.octoport.ru` is already on this line;
- Opera reviewer dashboard submission;
- AMO/store publication.

No live DB, production service, marketplace payload, payment, store dashboard or owner secret was changed.
