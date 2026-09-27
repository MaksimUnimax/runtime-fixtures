# C05 three-service disposable rollback rehearsal — 2026-09-27

Status: **DISPOSABLE API + WORKER + PORTAL ROLLBACK PASS / NOT LIVE / NOT DEPLOYMENT**

## Scope and identities

This closes the worker/portal gap left by the earlier API-only C05 rollback proof.

Canonical rehearsal evidence:
- evidence: `/root/octoport-control/logs/C/c05-three-service-rollback-61bb49f3-r7/c05-three-service-rollback-evidence.json`;
- evidence SHA-256: `90f6da9e5067da7e3f5cfcc80a6801f081458b79049a793e949de6267ef0f55f`;
- reviewed runner: `tooling/coordination/c05-three-service-rollback-rehearsal.mts`;
- runner SHA-256: `42774711b0d61ded8114c7dde9ca4ab3e72a610cfec4443c0692bf825e3f7aed`;
- accepted restore dump SHA-256: `5a95e34431baa6d64159ea5cf912a719ad0e35fe78807c15d9380ea6dc175fc9`, mode 0600.

Three phases used one freshly restored C-only forward-schema database, with no down migration and no migration between source switches:

1. candidate `61bb49f3553fd217a9a2c8d8ff8d9f92419f0184`;
2. rollback floor `d24838669c54f21dc161dc48a7e71e0e288384c2`;
3. candidate `61bb49f3553fd217a9a2c8d8ff8d9f92419f0184` again.

Candidate source identity:
- tree: `8cf42d1e755ccadcc2b9fc119ad19ef370048ce0`;
- source archive SHA-256: `707938196e25af6f1b2bf4cc2ab8e20fc5862165fd664fcba658230d7d97c627`;
- lockfile SHA-256: `e947b55bf62341da18963663545d5fe91e243d83560d40e709a3361350ac34e5`.

Rollback-floor source identity:
- tree: `5e3530ca38970a6487aa73b7297aa1953012eb7e`;
- source archive SHA-256: `a5c314d139ef26320a70c9a3ccc25d0d7830ef5f19c832b9fd2dd9010942ff9e`;
- lockfile SHA-256: `f80c6e6a3d90d43536d71269ab68f4a6326fcc39f32f68ada69f445bf34f5fdc`.

Both revisions used Node `24.20.0`, pnpm `10.34.5`, tsx `4.20.5`, Next `15.5.21`, and React `19.1.1`. Each revision received its own frozen offline install and its own portal build. The tested launch forms remain source/tsx and Next-start, not substituted dist server entrypoints.

## Rehearsal result

Every phase passed:
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

## Private-state provenance disposition

The historical C05 runtime-state file remains mode 0600. Existing C05 receipts establish that its auth/signing material and device/session state were generated for the C-only disposable C05 database and synthetic authority flow. It is not evidence of a live or owner credential.

A child source-review process previously reported that a read-only search accidentally surfaced lines from that private test-state file in tool output. Do not reproduce those values. Based on the recorded generation provenance and disposable-only use, this is not treated as evidence that a reusable/live credential was exposed, and no unrelated production credential rotation is warranted from this event alone.

## Acceptance boundary

This proves the exact candidate/floor/candidate three-service sequence above on one restored forward-schema disposable database. It does **not** prove:
- production or live deployment/rollback;
- future arbitrary source revisions;
- live backup/RPO/RTO;
- reviewer/store submission;
- live commercial enablement.

After this proof, `d24838669c54f21dc161dc48a7e71e0e288384c2` is a tested rollback floor for the exercised API + worker + portal paths on the proven forward schema. Any later runtime-affecting candidate requires normal release-specific revalidation.

At the time this receipt is integrated, `origin/main` has advanced beyond `61bb49f3...` only through site/design/nginx-site changes. Those changes were preserved by normal merge and are outside this C05 runtime proof.
