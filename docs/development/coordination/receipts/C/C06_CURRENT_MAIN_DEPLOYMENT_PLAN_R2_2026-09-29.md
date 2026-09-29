# C06 exact current-main deployment plan R2 — 2026-09-29

Status: **PLAN READY FOR CURRENT MAIN / NO LIVE APPLY / C07 EXPLICIT-LIVE GATE**

This R2 supersedes only the identities and migration target in the earlier
`C06_CURRENT_MAIN_DEPLOYMENT_PLAN_2026-09-29.md`. The historical plan remains
unchanged as evidence of its earlier boundary.

This document performs no live migration, service switch, DB restore, store
submission, audience expansion or notification.

## Exact current source

Current accepted main:
- source SHA: `d7f9e108f992c3395b3084f1ae664dfc78a956b9`;
- tree: `bbb95d70d710ac4f30ad80ace4857d5681085919`;
- source archive SHA-256:
  `81153ff4f7c049e2ad4d650fcca67869680ce15dd2f7b3009fc014a753c39676`;
- lockfile SHA-256:
  `e0be2cd7574eaa5eddd8e7450260f949406498e05b92bfc9f8a181d48682040a`;
- migration journal: 44 entries;
- highest tag: `0055_api_watch_document_scope_persistence`.

Required main workflows on this exact SHA are 5/5 SUCCESS.

## Frozen client release remains separate

Current frozen STORE successor:
- product version: `0.2.9`;
- contract: `control_plane_v2`;
- package source:
  `74882ec31433ef1840cdea111f2ac6246d5ce3bb`;
- package tree:
  `63c4e76e4d1bb2f8b29a585ca2d46b105b5dd19e`;
- package migration authority: 54.

Chromium/Opera:
- file: `OCTOPORT_v0.2.9_CHROMIUM_STORE.zip`;
- SHA-256:
  `f409e35fb714139cc5eefd6c3b390d5d2ca89fb9567a58cb3b68157e1f62eeae`;
- bytes: 2273193.

Firefox:
- file: `OCTOPORT_v0.2.9_FIREFOX_STORE.zip`;
- SHA-256:
  `be2d603f34c43c5c95aa4e7e83b5c842d39b5ac7590ebb49464fec46f2396542`;
- bytes: 4214684.

Backend/main movement must not silently rebuild or replace these package bytes.

STORE0.2.9 compatibility is already activated on the bounded owner-test catalog:
signed config 5 reports extension/Opera SUPPORTED and ChatGPT web RESOLVED with
the accepted profile revision 2. That does not equal store publication or
production deployment.

## Current recovery proof

C05 R2 current-main evidence:
- receipt:
  `C05_CURRENT_D7_IMMUTABLE_RECOVERY_ROLLBACK_2026-09-29.md`;
- source journal restored: 40;
- exact candidate forward-migrated to journal 44;
- post-upgrade custom backup SHA-256:
  `ce23ea24cdfdec1c0af4be99895bf7a5c89115bb9a9be32b7e249f1d240a25f2`;
- tested rollback floor:
  `d24838669c54f21dc161dc48a7e71e0e288384c2`;
- exact sequence:
  `d7f9e108... -> d248386... -> d7f9e108...`;
- API + worker + portal checks PASS on the same forward journal-44 DB;
- independent verdict:
  `PASS_C05_CURRENT_DISPOSABLE_RECOVERY`.

No down migration is a supported rollback action.

## Current live-line facts that must not be conflated with C07

The existing bounded owner-test runtime is a split historical line:
- API is currently on exact `ec99b58b29f0ae51463e197a28aa784a93a45eb2`;
- worker and portal remain on exact
  `62024d192a8572c11aafab91653330d1f996699f`;
- their current database remains journal 40;
- live migration 0055 has **not** been applied;
- monitoring services and the retention timer are independent units and are not
  part of a product API/worker/portal switch.

A future C07 current-main rollout must therefore be treated as a new exact
source deployment, not as an in-place extension of the historical 620/ec99
helper.

## C07 mandatory read-only preflight

Before any live mutation, for the exact target C must:

1. Fetch and verify the authorized final source SHA/tree and a clean source
   boundary. If the authorized target is no longer `d7f9e108...`, stop and
   revalidate the changed runtime.
2. Materialize a new immutable release directory from Git/archive with Node
   `24.20.0`, pnpm `10.34.5`, frozen lockfile and recorded build hashes.
3. Read the target DB identity and migration journal read-only. The current
   owner-test lineage is expected to be canonical journal 40 before this
   current-main rollout. Any different prefix or DB identity is fail-closed.
4. Read exact API/worker/portal unit and drop-in identity plus independent
   monitoring unit identity. Product deployment must not stop, replace or
   duplicate monitoring pollers.
5. Create a fresh protected custom-format **rehearsal backup** before mutation;
   record path, SHA-256, bytes, mode0600, server/DB identity and pre-apply
   journal.
6. Restore that rehearsal backup into an isolated disposable DB and run the
   exact candidate's own migration command. Require journal 44 through 0055 and
   the expected post-migration schema.
7. Verify the exact d248 rollback-floor archive/dependency/build identity remains
   available and matches C05.
8. Run bounded disposable candidate readbacks and persist an immutable
   pre-apply receipt binding source/tree/release dir/DB prefix/backup/unit
   identities/rollback floor.
9. If any precondition differs, stop. Do not repair live state ad hoc.

## C07 apply — only after separate exact live authorization

1. Quiesce only the target product API/worker/portal units. Monitoring units
   remain untouched.
2. Re-read target DB identity and require the same journal-40 pre-apply prefix.
3. **After product writes are quiesced and before migration**, create the final
   protected custom-format PostgreSQL backup.
4. Verify the final backup format with `pg_restore --list` (or equivalent),
   bind its path/SHA/bytes/mode/server/DB identity to the exact pre-apply
   journal and unit identities, and persist a durable
   `FINAL_PRE_MIGRATION_BACKUP` receipt.
5. If that final backup or receipt cannot be verified, keep product services
   quiesced and abort before schema writes.
6. Run the exact candidate's own migration command. Require ordered journal 44
   through `0055_api_watch_document_scope_persistence`; no direct-SQL shortcut.
7. Switch API/worker/portal drop-ins only to the exact immutable candidate
   release directory.
8. Start API and require `/health/live=200` and `/health/ready=200`.
9. Start worker and require normal ready state with no restart loop.
10. Start portal and require `/login=200`.
11. Run bounded protected readbacks: account/device authority, current signed
    config, exact ChatGPT web profile/assignment, N2 reads and signed
    `control_plane_v2` bootstrap verification.
12. Require stable product `NRestarts`, unchanged monitor executable/argv and
    monitor restart counts, no unexpected `sync_entities` creation and no
    protected-authority hash drift outside the planned migration.
13. Persist the deployment receipt before calling the operation successful.

No provider business mutation, payment, Telegram send, store upload/submission
or audience expansion belongs in this deployment smoke.

## Fail-closed recovery

### Failure before live migration

Keep existing source/services unchanged and retain preflight evidence. No DB
restore is needed.

### Migration failure or uncertain DB state

Keep product services quiesced. Do not run old or new application code against
an uncertain partial schema. The only candidate DB restore source is the exact
verified post-quiesce `FINAL_PRE_MIGRATION_BACKUP`. A destructive live restore
requires a separate explicit recovery decision; it is never automatic.

### Migration succeeds but current candidate application fails

Use the tested forward-schema application rollback:
1. retain journal 44; do not down-migrate;
2. quiesce product API/worker/portal;
3. switch all three to exact tested floor
   `d24838669c54f21dc161dc48a7e71e0e288384c2`;
4. require API live/ready, worker ready/liveness, portal login/proxy, N2 and
   signed bootstrap checks;
5. require migration/protected-authority hashes stable;
6. persist rollback evidence and halt rollout.

If the tested floor fails, re-quiesce and escalate to the exact final backup
recovery procedure. Do not improvise another historical source.

## Readiness boundaries still outside C06 source/disposable proof

The following remain distinct and must not be upgraded by this plan:
- authenticated H3 needs a legitimate dedicated ChatGPT Standard session from
  the owner; no auth injection or credentials in chat;
- natural Russian Telegram delivery has not been observed in the current
  periodic-maintenance acceptance window;
- store reviewer/dashboard submission and actual store publication remain
  external gates;
- Chrome real-target availability remains an environment gate where no real
  target was observed;
- WB live-value gold-set validation remains an external dependency where the
  readiness manifest says so;
- AI-surface columns previously marked `NOT_RUN` remain `NOT_RUN` unless new
  exact evidence is produced.

## Authority boundary

C06 is source/disposable planning and readiness evidence only.

This plan does **not** authorize:
- live migration 0055;
- API/worker/portal live switch;
- destructive DB restore;
- provider or marketplace mutation;
- Telegram send;
- store upload/submission;
- payment or audience expansion.

C07 still requires a separate exact live authorization for the concrete
operation and target.
