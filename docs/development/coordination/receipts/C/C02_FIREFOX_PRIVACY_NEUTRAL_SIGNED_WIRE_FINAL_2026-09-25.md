# C02 Firefox privacy-neutral signed wire — final source integration

Date: 2026-09-25
Role: C
Status: **SOURCE + DISPOSABLE POSTGRESQL + PACKAGE REGRESSION PASS / NOT DEPLOYED**

## Integrated authority

This integration consumes bounded/effective handoffs only:

- B device-metadata Slice 1: `7fc52da28791f191b7b03694bc79179d6e561597`;
- B bootstrap/local-authority Slice 2: `509845f0e07907f2a5b0e174aca39b41e2156e81`;
- B admin WITHHELD projection follow-up: `892596c58f47c4a7e7faea5967d3f9fbb1cb57fc`;
- A privacy-neutral client code: `174d8d0386f963ab6796a7ca4e2a05f802f69521`;
- A installed Firefox evidence: `ee1e6a8effaa08fb90ce930e7a32f935ad131f8e`.

C did not merge cumulative A/B historical tails. Effective files were applied content-only and checked against candidate blob identities where applicable.
## Shared signed-wire bridge

The existing `control_plane_v2` negotiation now has two strict request variants:

- identified: existing `extensionVersion + browser` pair, unchanged;
- privacy-neutral: both technical fields absent.

Partial, placeholder or one-sided technical metadata is invalid. The client must not fall back from privacy-neutral to identified after denial.

The signed `bootstrap_snapshot_v2` is also a strict union:

- identified requests retain the existing `compatibility / features / ai` payload shape;
- privacy-neutral requests contain signed `localClientAuthority.schemaVersion = local_client_authority_v1` and omit those three legacy server-evaluated fields.

The Ed25519 envelope and existing 32768-character payload bound are unchanged.
The privacy-neutral server path:

- does not invoke the legacy compatibility resolver with fabricated local versions;
- materializes bounded compatibility/releases/policies/features through B's existing repositories;
- preserves account/device identity, access basis, subscription, TTL/offline grace and entitlements;
- forwards detected AI to local-authority materialization only when the account is beta/commercial eligible;
- keeps privacy-neutral Health acquisition fail-closed instead of creating another technical metadata channel.

The production API constructs one shared `BootstrapAiResolutionService` and one `LocalClientAuthorityMaterializer`; no parallel resolver architecture was introduced.
## Admin / portal compatibility

A legal WITHHELD device is now preserved end-to-end:

- DB and ordinary device repositories keep the all-NULL technical tuple;
- public preview/device-list expose authoritative `clientMetadata`;
- portal renders WITHHELD as `Not shared` and does not invent browser/version data;
- admin repository fails closed on partial tuples and never produces `String(NULL)`;
- admin HTTP projection omits legacy browser/version fields for WITHHELD rows.

The current-device metadata forget operation remains bodyless, bearer-derived and active-session/device/account scoped.
## C verification

Node 24.20.0 / pnpm 10.34.5.

Disposable PostgreSQL combined gate:

- job `dbc5751a679e46529da8bd3ab8d32cb2`;
- `p3-4-bootstrap.integration`: 15/15 PASS, including real HTTP privacy-neutral v2 signed snapshot;
- `p6-2-admin-operations.integration`: 108/108 PASS;
- total 123/123, exit 0, peak ~444 MiB, OOM 0, cleanup verified.

Combined extension/package regression:

- job `57bbb234f91c48ccb8b8fe4fef41b83d`;
- `extension_core`: 129/129 PASS;
- Firefox-specific gates: 8/8 PASS;
- `firefox-privacy-neutral-client` PASS on source runtime and extracted package;
- `live_provider_calls = 0`;
- exit 0, peak ~184 MiB, OOM 0, cleanup verified.
Final source/static gate:

- job `412bd9aa03a047dfbe8d8078a1908f4d`;
- contracts / remote-config / bootstrap / admin-ops / DB / API / portal typechecks PASS;
- contracts, remote-config, bootstrap, admin-ops and portal units PASS;
- tracked OpenAPI check PASS;
- docs check PASS;
- Prettier and ESLint PASS;
- exit 0, OOM 0, cleanup verified.

Focused OpenAPI regression:

- job `46825447afd9422f989b24838f7204ef`;
- OpenAPI tests 6/6 PASS;
- `/v1/bootstrap` documents exact identified and privacy-neutral v2 branches;
- tracked artifact check PASS.
Additional focused source evidence:

- contracts privacy-neutral tests: 4/4 PASS;
- remote-config tests: 53/53 PASS;
- bootstrap tests: 65/65 PASS;
- B admin own disposable PostgreSQL handoff: 108/108 PASS;
- A code parent `extension_core`: 129/129 PASS.

A installed evidence records Firefox 155.0.1 consent Deny -> Allow -> Revoke PASS and exact installed-synthetic wire neutral -> identified -> neutral after revoke. That evidence does not use a deployed privacy-neutral Octoport backend.
## Acceptance boundary

This is not deployment acceptance.

Still separate:

- live forward migration 0051 and application deploy;
- proving the reachable backend serves this exact privacy-neutral/N2-compatible line;
- fresh C05 immutable-artifact recovery rehearsal on the final Firefox server candidate;
- ordinary Opera reviewer backend E2E/dashboard receipt;
- AMO/store submission readiness beyond the evidence explicitly recorded above.

No live database, production service, marketplace payload, payment, owner secret or store dashboard was mutated by this integration.
