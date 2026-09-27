# C05 three-service disposable rollback rehearsal — 2026-09-27

Status: **DISPOSABLE API + WORKER + PORTAL ROLLBACK PASS / NOT LIVE / NOT DEPLOYMENT**

## Scope and identities

This closes the worker/portal gap left by the earlier API-only C05 rollback proof.

Latest canonical rehearsal evidence:
- evidence: `/root/octoport-control/logs/C/c05-three-service-rollback-a7bf2538-r2/c05-three-service-rollback-evidence.json`;
- evidence SHA-256: `2424ddb0a08e020749f6528a89a254ef225ccfad12e1614e09cc0b25a797d58a`;
- reviewed runner: `tooling/coordination/c05-three-service-rollback-rehearsal.mts`;
- runner SHA-256: `42774711b0d61ded8114c7dde9ca4ab3e72a610cfec4443c0692bf825e3f7aed`;
- accepted restore dump SHA-256: `5a95e34431baa6d64159ea5cf912a719ad0e35fe78807c15d9380ea6dc175fc9`, mode 0600.

Three phases used one freshly restored C-only forward-schema database, with no down migration and no migration between source switches:

1. candidate `a7bf253839372a18f14a619e64093fa0e8c70b0e`;
2. rollback floor `d24838669c54f21dc161dc48a7e71e0e288384c2`;
3. candidate `a7bf253839372a18f14a619e64093fa0e8c70b0e` again.

Candidate source identity:
- tree: `c93a7c21a77e212b5d50545fe6d3354f162d651a`;
- source archive SHA-256: `aaf372d380aefb58dc991f0acded73c37881bcaa529630298a49cdbbcef53e08`;
- lockfile SHA-256: `e947b55bf62341da18963663545d5fe91e243d83560d40e709a3361350ac34e5`;
- portal build SHA-256: `652e2dc891791644d8473252604aa0dc7f651014ec4ae48f0525775929d63cce`.

Rollback-floor source identity:
- tree: `5e3530ca38970a6487aa73b7297aa1953012eb7e`;
- source archive SHA-256: `a5c314d139ef26320a70c9a3ccc25d0d7830ef5f19c832b9fd2dd9010942ff9e`;
- lockfile SHA-256: `f80c6e6a3d90d43536d71269ab68f4a6326fcc39f32f68ada69f445bf34f5fdc`;
- portal build SHA-256: `fba5c1935aa32c4b8703da18b593f2bcfc16d5a44e1858e9fa3e3ec9bd7267c1`.

Both revisions used Node `24.20.0`, pnpm `10.34.5`, tsx `4.20.5`, Next `15.5.21`, and React `19.1.1`. Each revision received its own frozen offline install and portal build. The tested launch forms remain source/tsx and Next-start, not substituted dist server entrypoints.

The earlier `61bb49f3 → d248386 → 61bb49f3` r7 rehearsal remains valid historical disposable evidence. It is superseded as the **canonical current rollback binding** by the later a7bf-r2 rehearsal above; both used the same reviewed runner and rollback floor.

## Rehearsal result

Every a7bf-r2 phase passed:
- API `/health/live` = 200;
- API `/health/ready` = 200;
- worker emitted `Worker ready` and remained live;
- portal `/login` = 200;
- authenticated portal proxy `GET /api/control-plane/v1/accounts` = 200;
- PRESENT-device N2 read = 200;
- WITHHELD-device N2 read = 200;
- identified `control_plane_v2` bootstrap = 200 and Ed25519 verification PASS;
- privacy-neutral `control_plane_v2` bootstrap = 200 and Ed25519 verification PASS.

The first candidate phase used a dedicated synthetic PRESENT device for `POST /v1/devices/current/client-metadata/forget`; it returned 200 and persisted WITHHELD metadata. The rollback floor and second candidate phase preserved that exact synthetic WITHHELD state. The protected baseline PRESENT and WITHHELD devices were never used for the irreversible write probe.

Across every source switch:
- migration journal remained 40/40 with identical journal hash;
- protected PRESENT device hash remained identical;
- protected WITHHELD device hash remained identical;
- protected session authority hash remained identical;
- synthetic session authority remained preserved;
- portal synthetic session authority remained preserved;
- config-release authority hash remained identical;
- signing-key authority and signing-event hashes remained identical;
- `sync_entities` remained 0.

The worker was allowed to run its ordinary disposable jobs; the acceptance condition was preservation of the protected authority/data invariants above, not a false claim that the worker performs zero writes.

## Outbound and cleanup boundary

The runner fails closed on inherited SMTP/mail/email, Telegram, payment, provider, or marketplace environment variables.

During each phase:
- portal receives no database/auth/signing private material and binds to loopback only;
- worker receives only its required disposable DB/auth environment;
- worker SMTP points to a deliberately unbound loopback port;
- Telegram variables are absent, not serialized as the string `"undefined"`;
- no marketplace/provider destination is configured.

Successful cleanup is part of the acceptance:
- disposable rehearsal DB dropped;
- transient private rehearsal state removed;
- temporary source/install/build workspace removed.

No production service, live DB, store dashboard, marketplace API, payment provider, SMTP server, Telegram destination, or owner credential was used or changed.

## Current accepted runtime binding

Controller review and parent C independently compared the proven a7bf candidate with accepted backend source `22473b416949892d66e5d8e204805ea84347c329` and found **zero delta** across:
- `apps/api`;
- `apps/worker`;
- `apps/portal`;
- `packages/server`;
- `packages/contracts/src`;
- `packages/shared`;
- `package.json`;
- `pnpm-lock.yaml`.

Therefore the exact a7bf-r2 rehearsal is the current runtime-equivalent disposable rollback evidence for accepted backend source `22473b416949892d66e5d8e204805ea84347c329`. This equivalence is limited to the compared runtime/dependency paths. It does not turn the rehearsal into live deployment/rollback evidence, and later runtime-affecting changes require normal release-specific revalidation.

## Private-state provenance disposition

The historical C05 runtime-state file remains mode 0600. Existing C05 receipts establish that its auth/signing material and device/session state were generated for the C-only disposable C05 database and synthetic authority flow. It is not evidence of a live or owner credential.

A child source-review process previously reported that a read-only search accidentally surfaced lines from that private test-state file in tool output. Do not reproduce those values. Based on the recorded generation provenance and disposable-only use, this is not treated as evidence that a reusable/live credential was exposed, and no unrelated production credential rotation is warranted from this event alone.

## Acceptance boundary

This proves the exact a7bf/floor/a7bf three-service sequence above on one restored forward-schema disposable database and binds it, by zero runtime/dependency delta, to accepted backend source `22473b416949892d66e5d8e204805ea84347c329`.

It does **not** prove:
- production or live deployment/rollback;
- future arbitrary source revisions;
- live backup/RPO/RTO;
- reviewer/store submission;
- live commercial enablement.

After this proof, `d24838669c54f21dc161dc48a7e71e0e288384c2` is a tested rollback floor for the exercised API + worker + portal paths on the proven forward schema. Any later runtime-affecting candidate requires normal release-specific revalidation.
