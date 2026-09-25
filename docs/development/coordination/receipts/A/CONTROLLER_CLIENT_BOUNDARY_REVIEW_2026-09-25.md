# Controller client boundary review — 2026-09-25 07:26 UTC

Baseline: 891b89f198f89e52eef78d6da89a28641e7dcdce.
Owner requested workstream audit and fixes only, excluding server resources/disk.
Status: REPRODUCED / ISOLATED REPAIR / NOT IN MAIN / NOT DEPLOYED.

## P1 — current identified profile rejected

Current server BootstrapService passes control_plane_v2 to its AI resolver.
checkCompatibility requires the profile's contract to match that request.
Current extension validateAccountProfile instead required control_plane_v1 for every identified payload.

The exact extracted current STORE carrier rejected correctly signed RESOLVED v2 profiles
in Opera and Firefox grant mode with BOOTSTRAP_PROFILE_INCOMPATIBLE.
Signature verification passed. This is a real module/contract mismatch, not a live-server acceptance result.
Existing synthetic fixtures used legacy v1 profiles and masked this boundary.

Repair: match current profile to the signed payload contract, retaining previously supported
identified legacy v1 profiles. Privacy-neutral authority remains strictly v2.
Signature, profile fingerprint, browser/version, account/session/cache validation are unchanged.

## P2 — redundant clearing while optional technical data is denied

Five sequential acquireSignedHealthAuthority calls with Firefox permission denied
sent five bodyless metadata-forget POSTs, despite every earlier clear succeeding.
The implementation had single-flight protection only while a request was outstanding.

Repair: persist a tiny device-scoped successful-clear receipt; reuse it across worker restart.
An actual subsequent identified technical request invalidates it before sending.
A generation/consent epoch prevents a late clearing response from acknowledging a newer identified send.
Failed clears retain the existing private pending marker; ordinary activity retries at most once
per minute in the same worker. No new timer, polling loop or background service was added.
All requests still use the existing authenticated bearer/refresh path.

## Validation

Actual-module reproductions:
 /root/octoport-control/incidents/streams-only-audit-20260925T0726Z/client-boundary-repro.log

New permanent regression:
 tests/regression/extension-core/client-i1/client-profile-contract-and-forget.mjs
Registered in tooling/checks/extension_core.py for source and extracted checks.

13 cases PASS on repaired test carrier:
- Opera/Chrome/Firefox each: identified legacy v1, current v2 with restore, unsupported v3 rejected;
- clear dedup across local checks + worker restart + regrant;
- offline retry cooldown;
- late clear racing newer identified send;
- device-scoped acknowledgement.

The same test FAILS on original exact STORE carrier at current v2 profile acceptance.
Existing Firefox privacy suite completes all 16 assertions on both original and repaired carriers,
but both processes remain alive after PASS and hit the diagnostic timeout.
Those runs are not recorded as exit-zero suite PASS; original and repaired traces are preserved.
This pre-existing test-lifecycle behavior does not demonstrate a regression introduced here.

The test carrier is an existing extracted package with the exact source client module replaced
in a separate directory. It is in-process fixture evidence, NOT a new release build, installed/live
acceptance or a store-ready artifact. C must build the final package and run ordinary required gates.

## Integration

Only these source/test boundaries changed: client.js, the focused regression, its existing gate registration,
and this receipt. No DB, shared wire, production or owner credentials changed.
Controller worktree is outside assigned stream paths; no hook bypass or controller commit is attempted.
C receives a content-hashed patch, reviews the exact diff, commits/integrates normally.
A owns subsequent real-browser/current disposable API acceptance, without duplicating reserved edits.
