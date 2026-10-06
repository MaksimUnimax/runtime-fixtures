# C05 journal-46 candidate → floor → candidate rehearsal — B successor R2 (2026-10-06)

## Verdict

**PASS_DISPOSABLE_POSTGRESQL_REAL_APP_RECOVERY — exact execution-time evidence.**

The accepted rehearsal was executed against exact source `d7f26119d4e1e73d6f45ea6127951583a1ae28e0` at journal 46. It restored the accepted journal-40 seed, migrated forward to journal 46, performed an upgraded backup/restore, and served real API/worker/portal in the exact sequence candidate → accepted rollback floor → candidate. All three application phases and cleanup passed.

This receipt is reconstructed on fresh repository base `a6c14193a1d17d14261651978570cb1fdc5de941` to preserve the already-reviewed recovery evidence through the governed publication/strict-completion route. The earlier accepted reconstruction `c7c5602810aa533ca783501804bcb36186172ecc` on base `ecae32277f2a0b6935884ce27e823fffbbebf4b5` remains historical publication provenance only. This successor does **not** relabel the old execution target as today's current server.

## Currentity boundary at publication

Fresh publication base:

- repository main at this reconstruction: `a6c14193a1d17d14261651978570cb1fdc5de941`;
- repository migration level: **58**;
- repository journal entries: **47**;
- repository journal head: `0058_extension_release_browser_artifacts`.

Those migration58/journal47 facts were **not** exercised by the journal-46 rehearsal below. Therefore this evidence does not prove current-main migration58 restore, current owner-test restore, deployment, production recovery, RPO/RTO, or any live rollback. A later C05/current-release recovery result must test those boundaries independently if required.

## Exact execution-time identities

- Rehearsed candidate: `d7f26119d4e1e73d6f45ea6127951583a1ae28e0`; tree `fb57c9cacc07b48adae0f41e45818f2fa363975e`.
- Rollback floor: `d24838669c54f21dc161dc48a7e71e0e288384c2`; tree `5e3530ca38970a6487aa73b7297aa1953012eb7e`.
- C05 harness blob used by the accepted run: `0e1dcb154937b631ec353a15da4aa2bdddd52321`.
- Runtime-identity helper blob used by the accepted run: `b0df0b27cd85214e10c0f128b0bbd00f5f40f3b5`.
- Candidate source archive SHA-256: `8d7cf2234267aaa6b30193f8757e992a7bb713f873c92c6cca334d1dbbaa0c73`.
- Candidate lockfile SHA-256 observed by the harness: `e0be2cd7574eaa5eddd8e7450260f949406498e05b92bfc9f8a181d48682040a`.
- Floor source archive SHA-256: `a5c314d139ef26320a70c9a3ccc25d0d7830ef5f19c832b9fd2dd9010942ff9e`.
- Floor lockfile SHA-256: `f80c6e6a3d90d43536d71269ab68f4a6326fcc39f32f68ada69f445bf34f5fdc`.

## Migration / backup proof from the accepted run

- Restored source journal: **40**.
- Rehearsal target journal: **46**.
- Forward migration 40 → 46: PASS.
- Upgraded custom backup/restore at journal 46: PASS.
- Backup SHA-256: `97711fc62d776acbb0d99edc688b8634963d150f150a8657728e659cc306da82`.
- Backup bytes: **503935**; retained evidence mode **0600**.

## Three real application phases

Each phase passed API live/ready, portal login/proxy, present/withheld N2, identified and privacy-neutral Ed25519 bootstrap checks, plus worker-ready evidence.

1. Candidate phase 1 — `d7f26119…`: nine HTTP/application checks returned 200 and worker-ready was true; synthetic forget returned 200 as the intentional state transition.
2. Rollback-floor phase — `d2483866…`: the same bounded checks passed; synthetic state was already withheld.
3. Candidate phase 2 — `d7f26119…`: the same bounded checks passed again after rollback-floor execution; synthetic state remained withheld.

Journal count remained 46 throughout the accepted rehearsal. The first phase intentionally changed only the synthetic-forget protected hash; protected hash invariants stayed stable across the floor and final candidate phases.

## Resource and cleanup evidence

Successful supervised heavy job:

- resource job `66eaf0c439464c498ff9a743838b4ab0`;
- profile `e2e`;
- MemoryMax **4096 MiB**;
- peak **1391460352 bytes**;
- OOM kills **0**;
- exit **0**;
- `cleanup_verified=true`.

The disposable rehearsal database, transient runtime state, task-local source/build material, and temporary dependency symlinks were removed. No database beginning `octoport_c05_` remained in the accepted B readback.

The first supervised attempt is preserved as environment evidence only: it passed restore/migration/backup/floor preparation, then stopped before service phases because the isolated task worktree could not resolve `drizzle-orm`. Its cleanup completed with OOM kills 0. The successful attempt fixed only task-local dependency visibility and changed no tracked product bytes.

## Immutable evidence bindings

- Accepted run evidence:
  `/root/octoport-control/logs/B/c05-journal46-b-successor-r2-20261006/evidence/c05-three-service-rollback-evidence.json`
  — SHA-256 `e2a1d5489ae663408178d68df3afa1b9a4518f45ccbda9bf1ac89a95588c3050`.
- Upgraded backup:
  `/root/octoport-control/logs/B/c05-journal46-b-successor-r2-20261006/evidence/c05-current-schema-backup.dump`
  — SHA-256 `97711fc62d776acbb0d99edc688b8634963d150f150a8657728e659cc306da82`.
- Successful resource receipt:
  `/root/octoport-control/resource-jobs/66eaf0c439464c498ff9a743838b4ab0/receipt.json`
  — SHA-256 `0d1fd148692d3046417bfbf420e6ec76b6f503c4f418eebc23f769db5350bf78`.
- Original independent review of exact run evidence and the original receipt:
  `/root/octoport-control/logs/B/C05-JOURNAL46-B-SUCCESSOR-R2-REVIEW-R2-20261006-result.md`
  — SHA-256 `c36df80573dfbc3c64dd3c5e9d02a15a4f0463e99190ccaac6e4543bb7ade243`, PASS with P0/P1/P2 empty.
- Original strict-schema completion evidence:
  `/root/octoport-control/logs/B/c05-journal46-b-successor-r2-20261006/COMPLETION.json`
  — SHA-256 `46f465c5daac7e4d761d27d01520e1cecf1fb94455b7d9fdbbf0bdefc5779db9`.
- Currentity-unblock record:
  `/root/octoport-control/logs/B/c05-journal46-b-successor-r2-20261006/UNBLOCK_CURRENTITY_RECONCILE_20261006.json`.

No heavy rehearsal is rerun by this fresh-main reconciliation.

## Boundaries / non-claims

Evidence level remains **DISPOSABLE_POSTGRESQL_REAL_APP_RECOVERY for exact d7f26119/journal46 only**.

This result does not establish migration58/journal47 recovery, LIVE_DB_RESTORE, owner-test deployment, production, RPO/RTO, marketplace/provider behavior, SMTP/TG delivery, browser behavior, or production capacity. No live DB/service/provider/browser/credential mutation is performed by this currentity reconciliation.

Before publication/strict DONE, this revised one-file candidate itself requires fresh independent read-only review and the ordinary governed exact-CI publication path.
