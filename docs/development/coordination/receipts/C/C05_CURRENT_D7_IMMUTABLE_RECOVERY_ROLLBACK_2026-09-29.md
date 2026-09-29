# C05 current-main immutable recovery and three-service rollback — 2026-09-29

Status: **DISPOSABLE CURRENT-MAIN RECOVERY PASS / NOT LIVE**

## Exact boundary

Current source under rehearsal:
- source: `d7f9e108f992c3395b3084f1ae664dfc78a956b9`;
- tree: `bbb95d70d710ac4f30ad80ace4857d5681085919`;
- source archive SHA-256: `81153ff4f7c049e2ad4d650fcca67869680ce15dd2f7b3009fc014a753c39676`;
- lockfile SHA-256: `e0be2cd7574eaa5eddd8e7450260f949406498e05b92bfc9f8a181d48682040a`.

Rollback floor:
- source: `d24838669c54f21dc161dc48a7e71e0e288384c2`;
- tree: `5e3530ca38970a6487aa73b7297aa1953012eb7e`;
- source archive SHA-256: `a5c314d139ef26320a70c9a3ccc25d0d7830ef5f19c832b9fd2dd9010942ff9e`;
- lockfile SHA-256: `f80c6e6a3d90d43536d71269ab68f4a6326fcc39f32f68ada69f445bf34f5fdc`.

Runner:
- `tooling/coordination/c05-three-service-rollback-rehearsal.mts`;
- SHA-256: `c255d7dd5c6d7ad4b09acef757ad6c212cf1488328a8ad25fd136b6bf1303763`;
- resource job: `4ce6d229764c4effbfab2b545898ed26`;
- result: exit 0, OOM kills 0, peak 1,407 MiB, cleanup verified.

Canonical evidence:
- `/root/octoport-control/logs/C/c05-three-service-rollback-d7f9e108-r1/c05-three-service-rollback-evidence.json`;
- independent read-only review:
  `/root/octoport-control/logs/C/c05-current-d7-recovery-review-20260929-result.md`;
- review verdict: `PASS_C05_CURRENT_DISPOSABLE_RECOVERY`.

## Real database recovery boundary

The rehearsal used only C's disposable PostgreSQL endpoint and created a random
rehearsal database inside it.

It restored the accepted journal-40 seed:
- dump SHA-256: `5a95e34431baa6d64159ea5cf912a719ad0e35fe78807c15d9380ea6dc175fc9`;
- protected file mode: 0600.

The exact current candidate then ran its own canonical migration command:
- source journal: 40;
- target journal: 44;
- highest current tag: `0055_api_watch_document_scope_persistence`.

After migration, the runner created a new PostgreSQL custom-format backup,
dropped/recreated only the disposable rehearsal database, and restored that
backup before any rollback-source phase:
- upgraded backup SHA-256:
  `ce23ea24cdfdec1c0af4be99895bf7a5c89115bb9a9be32b7e249f1d240a25f2`;
- bytes: 493960;
- evidence file:
  `/root/octoport-control/logs/C/c05-three-service-rollback-d7f9e108-r1/c05-current-schema-backup.dump`;
- mode: 0600.

No down migration is part of application rollback.

## Immutable application phases

Each revision was materialized from its own exact `git archive`, received its
own frozen offline install, and received its own portal build.

Both revisions used:
- Node `v24.20.0`;
- pnpm `10.34.5`;
- API/worker tsx `4.20.5`;
- Next `15.5.21`;
- React `19.1.1`.

Current candidate portal build SHA-256:
`0db45710923faf4adf52bdbb61bac12ba42103bc28b162a3dee9fb15b33841c7`.

Rollback-floor portal build SHA-256:
`a5b7b9696684871dd511bae7a683ca52bf7d781d2ff182ca576434f9ffd88a07`.

The exact sequence on one restored forward journal-44 database was:
1. current `d7f9e108...`;
2. rollback floor `d248386...`;
3. current `d7f9e108...` again.

Every phase passed:
- API `/health/live` = 200;
- API `/health/ready` = 200;
- worker ready log plus process liveness;
- portal `/login` = 200;
- authenticated portal proxy account read = 200;
- PRESENT-device N2 read = 200;
- WITHHELD-device N2 read = 200;
- identified v2 bootstrap = 200 with Ed25519 verification;
- privacy-neutral v2 bootstrap = 200 with Ed25519 verification.

The first candidate phase used only a dedicated synthetic device for the
irreversible client-metadata forget probe. Its WITHHELD state persisted through
rollback and the second candidate phase.

## Preserved state and outbound isolation

Across every source switch:
- migration journal remained 44 with the same journal hash;
- protected PRESENT device hash remained identical;
- protected WITHHELD device hash remained identical;
- protected extension-session authority hash remained identical;
- protected portal-session authority hash remained identical;
- config-release authority hash remained identical;
- signing-key and signing-event hashes remained identical;
- `sync_entities` remained 0.

The runner rejects inherited SMTP/mail/email, Telegram, payment, provider and
marketplace destinations. The worker receives only disposable DB/auth data and
an intentionally unbound loopback SMTP endpoint. Telegram variables are absent.
The portal receives no DB/auth/signing private material and binds only to the
disposable loopback API.

Successful cleanup was verified:
- disposable rehearsal database dropped;
- transient private rehearsal state removed;
- temporary source/install/build workspace removed;
- no rehearsal process remained.

## Acceptance boundary

C05 now proves current-main source/disposable recovery and application rollback
for the exact `d7f9e108... -> d248386... -> d7f9e108...` sequence on forward
journal 44, including API, worker and portal.

It does **not** prove or authorize:
- a live/production migration, backup restore, deploy or rollback;
- live RPO/RTO;
- a destructive live DB restore;
- store publication;
- provider, payment, SMTP or Telegram business activity;
- owner/reviewer UX acceptance.

Any later runtime-affecting candidate requires normal release-specific
revalidation. C07 still needs an operation-specific live authority and must
create its own final post-quiesce pre-migration backup before any live schema
write.
