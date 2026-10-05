# B02 — 0.2.12 Opera compatibility-policy canonical input R1

Status: SOURCE CANDIDATE / NO LIVE AUTHORITY

Task: B02-0212-OPERA-POLICY-CANONICAL-INPUT-R1-20261005

## Purpose

The accepted 0.2.12 Chromium package is present in the owner-test release
catalog, but the latest live store1.opera.v2 policy still has minimum and
recommended extension version 0.2.11. This source contract supplies the
missing current-version input for the early Opera slice only. It does not
publish a policy and does not claim a complete four-browser beta policy.

## Canonical source input

beta_opera_policy_canonical_inputs_v1 binds:

- product version 0.2.12;
- contract control_plane_v2;
- policy key store1.opera.v2;
- browser family opera;
- minimum extension 0.2.12;
- recommended extension 0.2.12;
- minimum Opera version 136;
- maintenance disabled with no maintenance code;
- no blocked extension versions.

The writer-owned policy id, revision and publication time remain dynamic
publication outputs. No administrator identity, signing material, credentials,
database identity, or live mutation authority is present in this contract.

## Deliberate boundary

This contract does not choose browser minimums for Chrome, Yandex Chromium,
or Firefox and does not claim a complete multibrowser compatibility-policy
manifest. Observed browser versions are not silently promoted into product
authority. The separate multibrowser artifact-persistence work and any later
four-browser policy decision remain independent prerequisites for broader beta
readiness.

## Evidence basis

- B01-BETA-COMPATIBILITY-POLICY-CANONICAL-INPUT-BOUNDARY-R1-20261004
  established that the exact current beta policy input was missing and that
  observed Chrome/Yandex/Firefox versions must not be invented as policy
  minima.
- A03-BROWSER-VERSION-SEMANTICS-CURRENT-MAIN-SUCCESSOR-20261003 strict
  completion (SHA-256
  c75cb51a60d31caab223716cf4cd72b104d9c010051f3a61d92d7ac31ebe6485)
  passed independent review, exact-five CI, publication and post-main CI and
  records: only the Opera minimum 136 is approved; observed product versions
  and the Firefox carrier floor are not policy minima.
- B02 canonical-policy authority crosscheck (SHA-256
  b5dd29812f079c3d5e4e9f03ce877a33c9d7c0c8e048b9fdcdfe2472c29e2e63)
  records Opera minimumBrowserVersion 136 as APPROVED with source task
  A03-BROWSER-VERSION-SEMANTICS-CURRENT-MAIN-SUCCESSOR-20261003, while
  Chrome/Yandex/Firefox remain DECISION_REQUIRED.
- B02-MAINTENANCE-LIVE-CATALOG-PROFILE-READBACK-R1-20261005
  read back live store1.opera.v2 revision 5 and found the exact mismatch:
  extension minimum/recommended 0.2.11 instead of the accepted early Opera
  target 0.2.12; Opera minimum 136 was unchanged.
- C06-READINESS-DELTA-R27-LIVE-OWNER-CURRENT-MAIN-RECONCILE-20261005
  preserved the policy/config mismatch as an open readiness gate and granted
  no live mutation authority.

The first independent review of this task correctly rejected the original
candidate because it labeled Opera 136 as approved without naming the separate
accepted approval source. R2 preserves the same value and narrow Opera scope
but binds that provenance explicitly; it does not derive approval from the
live revision or from the older 0.2.11 predecessor policy.

## Nonclaims

No database, service, browser, provider, marketplace, package, operator record,
GitHub setting, catalog, policy revision, signed config, deployment or
production mutation is performed by this source task. Source acceptance still
requires independent exact-diff review and the normal guarded publication
sequence.
