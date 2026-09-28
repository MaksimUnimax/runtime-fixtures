# C06 exact current-main deployment plan — 2026-09-29

Status: **PLAN READY / NO LIVE APPLY / C07 AUTHORITY STILL REQUIRED**

This document closes only PLAN C06's requirement for a precise deployment plan.
It is not deployment authority and does not execute migration 0054, switch a
service, expand beta admission, publish a package or send a notification.

## Exact current reconciliation line

Current accepted main before this plan:
- source SHA: `62da374e3e5e2b1383325473ece79445535f1655`;
- tree: `9356ae330b9113e88dbd43a6e190b812f273ce89`.

The product API/worker/portal/runtime bytes on this line are unchanged from the
C05-tested runtime source:
- runtime source SHA: `21fecf30cfa58d64d7b60984e508f2acfae8ecc3`;
- tree: `6f5cfdd2f97f652146eb6cadddece28a9040b4c4`;
- source archive SHA-256:
  `459fd00369b6a810d5353f6256937821428cbd38645a5f13e03f944377e01d77`;
- lockfile SHA-256:
  `e0be2cd7574eaa5eddd8e7450260f949406498e05b92bfc9f8a181d48682040a`.

The only 21fec -> 62da repository changes are the C05 rehearsal runner and C05
receipt. A C07 release must nevertheless record its own final exact source/tree/
archive/lockfile before any mutation; it may not silently substitute a later
runtime-changing descendant.

Frozen client artifact remains a separate immutable release identity:
- Chromium/Opera 0.2.6 SHA-256
  `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`;
- Firefox 0.2.6 SHA-256
  `b5de9b4f0773c08a705fbad050e77d382f265aa34fd2ca8d3657553bad577305`.
Do not rebuild these store bytes merely because backend/main moves.

## Tested recovery identities

Current forward schema:
- candidate migration journal: 43 entries, through 0054.

Tested rollback floor:
- source SHA: `d24838669c54f21dc161dc48a7e71e0e288384c2`;
- tree: `5e3530ca38970a6487aa73b7297aa1953012eb7e`;
- source archive SHA-256:
  `a5c314d139ef26320a70c9a3ccc25d0d7830ef5f19c832b9fd2dd9010942ff9e`;
- lockfile SHA-256:
  `f80c6e6a3d90d43536d71269ab68f4a6326fcc39f32f68ada69f445bf34f5fdc`.

C05 proved candidate -> floor -> candidate application compatibility while
keeping the same forward journal43 database. No down-migration is part of
rollback.

The existing owner-test deploy helper is pinned to the historical backend620
operation and must **not** be repurposed as a generic current-main release tool.
Current retained helper:
- `tooling/operations/deploy_owner_test.py`;
- SHA-256
  `bed51791106254b78f612dc23319e30e035abc9e1d0a63724ee521b7feb0d036`.

## C07 preflight — mandatory before live mutation

For the exact authorized target environment, C must:

1. Re-fetch and verify the final authorized source SHA/tree. Worktree must be
   clean; no uncommitted deployment bytes.
2. Materialize source from Git/archive into a new immutable release directory;
   use the pinned Node/pnpm toolchain and frozen lockfile. Record artifact/build
   hashes.
3. Read target DB identity and migration journal using read-only credentials.
   For the existing owner-test/preprod lineage, canonical prefix 40 is the
   expected pre-0054 state. Any unexpected DB/role/prefix is FAIL_CLOSED.
   Never repeat the old 22->40 operation on a forward-verified database.
4. Read current API/worker/portal unit/drop-in identity and monitor unit identity.
   Monitoring pollers are independent and must not be replaced/restarted by the
   product deployment.
5. Create a fresh protected PostgreSQL custom-format backup before mutation.
   Record path, SHA-256, size, mode0600 and server/DB identity.
6. Restore that fresh backup into an isolated disposable database and run the
   exact final candidate's own migration command. Require canonical journal43,
   expected tables/indexes/guards and no raw business/evidence leakage.
7. Verify the exact rollback-floor source/artifact remains available and its
   hashes equal the tested C05 floor.
8. Record an immutable pre-apply receipt containing exact source/tree, release
   directory, DB identity/prefix, backup hash, unit identities and rollback floor.
9. If any precondition differs, stop. Do not “repair” live state ad hoc.

## C07 apply — only after separate exact live authorization

1. Quiesce only the target product API/worker/portal using the reviewed deployment
   runner/procedure. Do not stop or duplicate monitoring pollers.
2. Re-check that the live DB is still the preflight DB and still has the exact
   pre-apply journal prefix. This is the final stale-preflight fence.
3. Run the final candidate's own migration command against the target DB.
   No direct SQL shortcut. Require the exact ordered journal through 0054.
4. Switch API/worker/portal service/drop-in source to the exact immutable release
   directory. Do not mix independent live-service changes into this transaction.
5. Start API and require:
   - `/health/live` = 200;
   - `/health/ready` = 200.
6. Start worker and require its normal ready state without restart loop.
7. Start portal and require `/login` = 200.
8. Run bounded protected readbacks:
   - account/device authority read;
   - current config release/signing authority;
   - exact `chatgpt/web/null` catalog/profile/assignment;
   - signed `control_plane_v2` Bootstrap verification.
9. Require product service `NRestarts` stability and unchanged monitor
   executable/argv + restart counts.
10. Require no unexpected `sync_entities` creation and no protected authority
    hash drift outside the planned migration.
11. Persist the deployment receipt before calling the operation successful.

No provider business mutation, payment, Telegram send, store upload or audience
expansion belongs in this deployment smoke.

## Fail-closed recovery / rollback

### Failure before live migration
Keep the current services/source unchanged; no recovery mutation is needed.
Retain the fresh backup/evidence.

### Migration failure or uncertain DB state
Keep product services quiesced. Do not start old or new application code against
an uncertain partial schema. Record exact migration/journal state and require an
explicit recovery decision. A destructive live DB restore is not automatic.

### Migration succeeded, candidate application fails
Use the tested **forward-schema rollback**:
1. keep journal43; never down-migrate;
2. stop/quiesce target product units;
3. switch only API/worker/portal source/drop-ins to exact tested floor
   `d24838669c54f21dc161dc48a7e71e0e288384c2`;
4. start and require API live/ready, worker ready, portal/login;
5. repeat protected read/bootstrap/signature checks;
6. require migration/protected-authority hashes stable;
7. persist rollback receipt and halt rollout.

C05 already proved candidate -> floor -> candidate on a restored journal43
database. C07 must still verify the actual live target; disposable proof is not
live acceptance.

### Rollback-floor failure
Re-quiesce product services. Do not improvise another historical source or DB
down-migration. Escalate to the exact fresh backup/recovery procedure under a
separate explicit recovery action.

## Post-apply observation

After a successful switch, keep the exact release and rollback floor immutable
for the observation window and verify:
- API/worker/portal remain active without restart churn;
- normal auth/bootstrap remains valid;
- beta/admission state is unchanged unless separately authorized;
- monitoring remains single-instance and healthy;
- no raw secrets/business payload are emitted to logs/evidence.

Store publication and client rollout remain separate operations. The frozen
0.2.6 store package is not automatically published by backend deployment.

## Authority boundary

This plan is ready for C06. It does **not** authorize:
- live migration 0054;
- API/worker/portal production/preprod switch;
- DB restore;
- Telegram send;
- provider business mutation;
- store Upload/Submit;
- payment or audience expansion.

Those actions remain C07 / explicit-live gates.
