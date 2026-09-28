# C05 current-schema three-service recovery rehearsal — 2026-09-29

Status: **DISPOSABLE CURRENT-0054 RECOVERY + ROLLBACK PASS / NOT LIVE / NOT DEPLOYMENT**

## Exact identities

Accepted runtime candidate:
- source SHA: `21fecf30cfa58d64d7b60984e508f2acfae8ecc3`;
- tree: `6f5cfdd2f97f652146eb6cadddece28a9040b4c4`;
- source archive SHA-256: `459fd00369b6a810d5353f6256937821428cbd38645a5f13e03f944377e01d77`;
- lockfile SHA-256: `e0be2cd7574eaa5eddd8e7450260f949406498e05b92bfc9f8a181d48682040a`;
- branch and post-main required workflows: 5/5 SUCCESS before this rehearsal.

Tested rollback floor:
- source SHA: `d24838669c54f21dc161dc48a7e71e0e288384c2`;
- tree: `5e3530ca38970a6487aa73b7297aa1953012eb7e`;
- source archive SHA-256: `a5c314d139ef26320a70c9a3ccc25d0d7830ef5f19c832b9fd2dd9010942ff9e`;
- lockfile SHA-256: `f80c6e6a3d90d43536d71269ab68f4a6326fcc39f32f68ada69f445bf34f5fdc`.

Reviewed rehearsal runner:
- source checkpoint: `d9fee2e4943e77219203d80075f532f469ba3269` (NOT_ACCEPTED until this run);
- runner SHA-256 after formatting: `c255d7dd5c6d7ad4b09acef757ad6c212cf1488328a8ad25fd136b6bf1303763`;
- Luna read-only verdict: `READY_FOR_REHEARSAL`;
- review: `/root/octoport-control/logs/C/c05-current-schema-review-r1-result.md`.

## Real disposable migration and backup/restore

The accepted protected C05 seed backup remained mode 0600 and restored at canonical journal count 40 (through 0051).

The runner then:
1. built the exact accepted candidate from a git archive with frozen offline install;
2. read the candidate's own Drizzle journal;
3. ran the candidate's own `@product/db db:migrate` against only the C loopback disposable database;
4. proved journal count advanced from **40 to 43**, through 0054;
5. created a PostgreSQL custom-format backup after the current migration;
6. dropped/recreated only the disposable rehearsal database;
7. restored the post-upgrade backup;
8. proved the restored database remained at journal 43 before any source switch.

Post-upgrade backup:
- path: `/root/octoport-control/logs/C/c05-current-schema-21fec-r1/c05-current-schema-backup.dump`;
- SHA-256: `e9699e6900192f806bafa5987531befdc9818ef50bc613846c9e8e0c67f62bbc`;
- bytes: 493522;
- mode: 0600.

Sanitized evidence:
- path: `/root/octoport-control/logs/C/c05-current-schema-21fec-r1/c05-three-service-rollback-evidence.json`;
- SHA-256: `03b0bfb06873a69eca0a4b7117e5742f33c756b3dde3355d174f0a9d7be14792`;
- mode: 0644;
- schema: `c05-three-service-rollback-v2`.

## Candidate -> rollback -> candidate result

All three phases used the same restored **forward journal43 database**. No phase ran a migration or down-migration.

For candidate phase 1, rollback floor, and candidate phase 2:
- API `/health/live` = 200;
- API `/health/ready` = 200;
- worker reached ready state and remained live;
- portal `/login` = 200;
- authenticated portal proxy accounts read = 200;
- protected PRESENT-device N2 read = 200;
- protected WITHHELD-device N2 read = 200;
- identified `control_plane_v2` bootstrap = 200 and Ed25519 verification PASS;
- privacy-neutral `control_plane_v2` bootstrap = 200 and Ed25519 verification PASS.

The first candidate phase executed the existing synthetic-only metadata-forget probe and received 200. The floor and second candidate phase observed the same synthetic device already WITHHELD. Protected baseline devices were never used for that irreversible probe.

Across every source switch:
- journal count remained 43;
- complete ordered migration-journal hash remained identical;
- protected PRESENT device hash remained identical;
- protected WITHHELD device hash remained identical;
- protected session-authority hash remained identical;
- protected portal-session-authority hash remained identical;
- config-release authority hash remained identical;
- signing-key authority hash remained identical;
- signing-event authority hash remained identical;
- `sync_entities` remained 0.

The rollback floor therefore remains compatible with the exercised API + worker + portal behavior on the current forward schema through 0054. This is an explicitly tested floor, not a claim about arbitrary historical commits.

## Resource and cleanup evidence

Resource supervisor:
- unit: `octoport-test-c-25a7002a17524509ba1cf7ecb0ba0752.service`;
- exit: 0;
- peak memory: 1457 MiB under a 4096 MiB cap;
- cleanup verified.

Post-run readback:
- no `c05_rehearsal_*` database remains;
- temporary source/install/build workspace removed;
- transient private rehearsal state removed;
- protected current-schema backup intentionally retained mode 0600;
- sanitized evidence retained mode 0644.

Outbound safety remained fail-closed: inherited SMTP/mail/email, Telegram, payment, provider and marketplace variables are rejected; services bind/use loopback-only disposable dependencies for this rehearsal.

## Acceptance boundary

C05 now has fresh disposable evidence for the exact accepted runtime line through migration 0054:
- real 0051-state restore;
- real 40->43 migration using exact candidate source;
- real post-upgrade PostgreSQL backup and restore;
- exact git-archive candidate build;
- exact tested rollback-floor build;
- candidate -> floor -> candidate API + worker + portal launches;
- real HTTP/auth/bootstrap/signature checks;
- protected-data and migration invariants across rollback;
- deterministic cleanup.

This does **not** prove or authorize:
- applying migration 0054 to the live/product database;
- production or owner-test deployment/rollback;
- production backup retention, RPO or RTO;
- Telegram delivery;
- H3 authenticated ChatGPT acceptance;
- store-reviewer/manual store acceptance;
- payment/commercial publication.

No live database, production service, marketplace payload, payment provider, Telegram destination, store dashboard or owner credential was changed.
