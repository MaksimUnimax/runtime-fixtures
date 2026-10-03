# A03 0.2.12 branded Opera transition target reconciliation — 2026-10-03

Task: `A03-0212-BRANDED-OPERA-TRANSITION-TARGET-RECONCILIATION-20261003`

## Verdict

**PASS_SOURCE_TARGET_RECONCILIATION_ONLY.** The previously reviewed Opera 0.2.12
catalog-transition target remains structurally valid, but its source/package identity is
superseded. Future read-only live inspection must use the strict-DONE branded successor,
not the older stale-brand package.

This receipt authorizes no admin request, catalog mutation, authentication, operator
readiness transition, deployment, or production action.

## Exact current target identity

- Published source: `1616a88e35766a1d17055216d1348def50989b9f`
- Source tree: `2a9a5fca393eee6d8768989dd499461a5f642cb7`
- B1 manifest authority SHA256:
  `a5b83a0a83d32803ba6ba585f3dfc377cff6a4012af276901cc880b22b8c6367`
- Product version: `0.2.12`
- Contract: `control_plane_v2`
- Migration level: `56`
- Chromium STORE file: `OCTOPORT_v0.2.12_CHROMIUM_STORE.zip`
- Artifact SHA256:
  `44870cd7260dd109168680d6aa17252fafef7e894c0d9b48a8ceff90b29265df`
- Artifact bytes: `2253835`
- ZIP manifest: MV3, version `0.2.12`, name `Octoport — Ozon + Wildberries`.

## Superseded identity and invariant fields

The accepted historical target used source `c7650401024ab3dd09d3495166627e62c43376a5`,
tree `c11f9bdce52d2b8136a5e22bf656af1c8187fcc8`, and Chromium artifact
`383fdebae07fafe9ccfe68481b411520a7f0f839099b68bd5f4b6c9442182982`
(`2253951` bytes). It remains evidence of the pre-branding target only.

Old and branded B1 manifests are identical for:
`schemaVersion=b1_release_candidate_v2`, product version `0.2.12`,
`control_plane_v2`, migration level `56`, Chromium filename, inventory count `43`,
and browser class `chromium`. Only the source/tree and rebuilt package byte identity
change for this reconciliation.

The current transition analyzer and Store-1 authority constants are byte-identical
between source `1616a88e` and current main at this check. The target therefore keeps:

- browser family `opera`;
- minimum browser version `136`;
- policy key `store1.opera.v2`;
- adapter/surface `chatgpt/web`;
- profile `chatgpt-web-opera-v1`;
- profile content SHA256
  `cab55851bd2d571c19de5d44f3f8b3c40ff0ba3eb44e346307a2578894b1b2c1`;
- profile minimum extension version `0.2.7`.

## Eight future read-only checks

A legitimate future admin preflight must still prove, with GET-only readback:
release, policy, signed config, adapter, surface, profile identity, exact published
profile revision, and exact DIRECT Opera ACCOUNT assignment.

READY requires release artifact SHA to equal the branded
`44870cd7260dd109168680d6aa17252fafef7e894c0d9b48a8ceff90b29265df`
and policy minimum/recommended extension version `0.2.12`, browser minimum `136`.

## Current authority boundary

The R12 readiness reconciliation records that a protected technical portal session
may still be time-valid, but it is **not** current admin authority. The last normal
admin elevation returned HTTP 403 `ADMIN_REAUTH_REQUIRED`; no admin session was issued.
A fresh technical portal-session operation was separately platform-blocked before
execution and must not be retried through an alternate route.

Therefore this task performs zero live GETs and zero mutations. When legitimate current
admin authority exists, use the existing transition preflight with the branded B1
manifest and branded Chromium ZIP. If any adapter/surface/profile/revision/assignment
check is not exact, fail closed and open a separately reviewed repair; never create or
reassign implicitly.

## Evidence

- Historical reviewed target:
  `/root/octoport-control/logs/A/a03-successor-0212-opera-transition-target-20261003/TARGET.json`
- Historical read-only runbook:
  `/root/octoport-control/logs/A/a03-successor-0212-opera-transition-target-20261003/READ_ONLY_PREFLIGHT_RUNBOOK.json`
- Strict branded B1 manifest:
  `/root/octoport-control/logs/A/a03-0212-branding-health-authority-successor-20261003/b1-candidate/B1_RC_MANIFEST.json`
- Branded package readback:
  `/root/octoport-control/logs/A/a03-0212-branding-health-authority-successor-20261003/PACKAGE_READBACK.json`
- Current readiness map:
  `/root/octoport-control/logs/C/c06-readiness-r12-20261003/RESULT.json`
- Analyzer:
  `tooling/server/store-release-transition-preflight.ts`
- Canonical Opera authority constants:
  `tooling/server/store1-opera-admin-activation.ts` and
  `tooling/server/store1-operator-authority.ts`

Evidence level: **SOURCE + SAVED ACCEPTED PACKAGE EVIDENCE** only.
Not claimed: live catalog compatibility, authenticated Work, READY_FOR_OPERATOR,
browser-store submission, LIVE_OWNER, DEPLOYMENT, or PRODUCTION.
