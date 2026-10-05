# B01 — Beta release canonical-input contract R1

Status: **SOURCE CANDIDATE / NO LIVE AUTHORITY**

Task: B01-BETA-RELEASE-CANONICAL-INPUT-CONTRACT-R1-20261005

## Why this exists

The accepted B01 release-channel boundary proved that the exact accepted 0.2.12
Chromium/Firefox release inputs had no canonical releaseChannel. The existing
multibrowser successor preflight emitted stable, but only as read-only
SOURCE_PREFLIGHT output and therefore could not authorize catalog publication.

This source result makes that intended channel an explicit versioned input for
the exact accepted release identity. Free-beta admission remains a separate
product/access boundary; it is not inferred to be the release-channel machine
identifier.

## Canonical release identity

beta_release_canonical_inputs_v1 binds:

- product version 0.2.12;
- contract control_plane_v2;
- release channel stable;
- browsers chrome, opera, yandex_chromium, firefox;
- Chromium package SHA-256
  90f6d67a5c3f3a2650886e32411f076349d7f429b3d4ed8ac1aa617e61ac77d7
  for Chrome, Opera and Yandex Chromium;
- Firefox package SHA-256
  a29ad0de5f91fdcf6fbd09a6443f31a754af7248e41ec8429dc74ed26e76dd9c
  for Firefox.

The two package digests remain distinct.

## R26 boundary remains fail-closed

This contract does **not** pretend the current persistence/admin model can store
that two-carrier integrity mapping. Current extension_releases semantics have
one unique version and one release-level artifact digest, so exact multi-carrier
binding remains false and requires the separately governed R26 persistence and
admin-contract migration.

Selecting either carrier digest as the single release digest would leave the
other accepted carrier unbound and is therefore explicitly excluded.

## Authority boundary

This source contract grants no DB/catalog/admin/live publication authority and
no package-build authority. It carries no DB identifiers, publication
timestamps, administrator identity or authorization, signing material, or live
state.

stable is an explicit reviewed source value for this exact release identity; it
is not derived from semver, filename, Store1 inheritance, a historical release
row, or runtime state.

## Verification

Author precheck on base `334223b77dac7e58da4924965f039434b48bb422`:

- `@product/compatibility` full unit suite: **12/12 PASS**;
- `@product/compatibility` TypeScript `tsc --noEmit`: **PASS**;
- Prettier check on all four task paths: **PASS**;
- local runtime: installed Node `v24.21.0`; this is only a source precheck. The
  governed Server CI and Coordination workflows remain authoritative for their
  declared Node `24.20.0`, and all five exact-candidate workflows are still
  required before publication.

These checks prove strict schema behavior, exact carrier hashes and browser
mapping, stable channel validity, deep immutability, no privileged authority,
and continued fail-closed handling of the two-digest R26 boundary. They do not
prove DB/catalog/live publication readiness.

Publication of this source result still requires independent review, fresh-base
reconciliation, the five exact-head CI workflows, governed non-force main
publication/readback, and strict queue completion.
