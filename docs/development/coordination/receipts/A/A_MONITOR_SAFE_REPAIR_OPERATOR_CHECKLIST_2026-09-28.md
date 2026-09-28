# A — monitoring safe repair / manual operator checklist — 2026-09-28

Status: **OPERATOR CHECKLIST READY / NO RELEASE OR PRODUCTION AUTHORIZATION**

Authority:
- monitoring architecture `15ca964e56dba9230f520e67a919d5b1136bb847`;
- existing `docs/server/HEALTH_SYSTEM.md`;
- A profile-consumer finding `NOT_WIRED`.

Purpose: ensure an operator tests/approves the exact repair bytes/profile and does not
confuse candidate tests with rollout/recovery.

## Current exact package anchor

Frozen STORE candidate:
- version: `0.2.6`;
- source HEAD: `028d5dd56341719e2061a47b5e82e216256619f7`;
- source tree: `99e12233864a592510032e30bb96668b41682204`;
- Chromium/Opera ZIP:
  `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`;
- Firefox ZIP:
  `b5de9b4f0773c08a705fbad050e77d382f265aa34fd2ca8d3657553bad577305`.

Current evidence for those exact bytes:
- release-preflight PACKAGE PASS;
- A WB changed boundary PASS;
- A exact ZIP byte identity PASS;
- real Opera development-flag signed-out UI PASS;
- no catalog/live/reviewer/production claim.

Historical `0.2.5` ZIP SHA
`33cbf1ad9ec4669abe3a65e24cfbaead4c7c3a1fa711261b2d186d107c33aea1`
is immutable HOLD and must never be relabeled as repaired.

The frozen `0.2.6` bytes are also immutable. Any later package-code DOM repair requires
a new version/artifact; do not rebuild different bytes under `0.2.6`.

## Entry gate — identify the incident and accepted baseline

Before preparing a repair candidate, record:
- incidentId;
- AI family/surface/browser compatibility scope;
- failed contour(s);
- acceptedBaselineId from monitoring authority;
- current installed/assigned package identity if known;
- current assigned profile revision/hash if known;
- latest observation fingerprint and evidence class.

Do not infer `acceptedBaselineId` from a green candidate test.
`CANDIDATE_PASS`, `OPERATOR_APPROVED`, `PUBLISHED`, `ASSIGNED` and
`OBSERVED_ACTIVE` are distinct states.

If current installed/assigned identity is unknown, the repair case remains
`UNKNOWN_CURRENT_CLIENT`; do not claim replacement/rollback safety.

## Delivery-kind decision

Choose exactly one target delivery kind before implementation.

### PROFILE_ONLY

Allowed only when:
- change is expressible entirely in the existing bounded signed profile vocabulary;
- exact client profile→DOM consumer is proven on the target package;
- candidate + rollback profile revisions are both compatible and tested;
- no new primitive/permission/manifest/client logic is required.

Current status: **NOT AVAILABLE END-TO-END** because A proved P7 selector content
`NOT_WIRED` to the DOM runtime.

### PACKAGE_UPDATE

Required when:
- a new packaged DOM primitive/detector/observer/delivery behavior is needed;
- current profile schema cannot safely express the repair;
- permissions/manifest/security boundary changes;
- current package lacks the proven profile consumer.

For the current system, a real DOM repair is PACKAGE_UPDATE until the signed profile
consumer is implemented and accepted.

Package repair rules:
- create a strictly new version;
- preserve old immutable artifacts/evidence;
- exact source/tree and both package hashes recorded;
- deterministic package/repeat identity proven;
- no silent replacement of a prior version.

## Repair-case manifest — required before operator testing

The manifest must bind:
- incidentId and scope;
- acceptedBaselineId;
- observed fingerprint;
- current package/profile identity;
- candidate source HEAD/tree;
- candidate package SHA(s) OR candidate profile revision/hash;
- suite revision + exact test matrix/results;
- target delivery kind;
- rollback pair.

Manifest identity must itself be hashed. The operator approves that exact manifest hash
and exact candidate identity, not a branch name, filename or chat description.

If any bound source/tree/package/profile/suite value changes after testing, previous
approval is stale and the candidate returns to pre-approval state.

## Automated A checks before manual approval

For a PACKAGE_UPDATE that changes ChatGPT DOM behavior, require the changed-boundary
matrix at minimum:
- source + extracted package parity;
- page/conversation identity positive + mismatch negative;
- composer present + missing/bounded-wait negative;
- Standard send and Work submit positive;
- microphone/stop/disabled/ambiguous send negatives;
- assistant response/completion positive + busy negative;
- command/code discovery positive;
- native code Copy positive;
- Response-actions Copy negative, including misleading copy-state;
- user/editor/ambiguous/unrelated message negatives;
- one-shot delivery/no-replay;
- package identity/readback and relevant browser-family smoke.

No live marketplace provider request is required merely to prove AI DOM compatibility.

## Manual operator test

Before opening the candidate:
- verify manifest SHA;
- verify candidate ZIP/profile SHA against the manifest;
- verify candidate version/revision;
- verify current assignment revision has not changed;
- verify the expected rollback pair still exists and is compatible.

During the manual test:
- use only the named controlled account/session and scope;
- confirm actual browser/package identity before scenario execution;
- run only the bounded contour/scenario matrix;
- capture sanitized evidence only;
- do not enter marketplace secrets into evidence;
- do not treat Telegram delivery/viewing as approval;
- stop on identity/hash mismatch, unexpected permission prompt or unsupported blocking state.

Operator result is explicitly one of:
- `APPROVED`;
- `REJECTED`.

It records actor/time, manifest hash, candidate hash, suite/matrix identity and current
assignment revision.

## Rollout / rollback gate

No rollout is allowed without an acceptable rollback pair.

Profile rollback:
- only after end-to-end profile consumer acceptance exists;
- create a new monotonic assignment revision selecting a previously verified profile;
- never replay an old signature/config as a new command.

Browser package rollback:
- do not promise instant store downgrade;
- pause further rollout on failure;
- restrict only the affected scenario when there is sufficient evidence and an existing
  safe control;
- prepare and release a newer forward-fix package;
- keep server application rollback separate from browser package handling.

Offline clients may retain older package/profile state. Report observed application
separately from publication/assignment.

## Post-rollout recovery declaration

Do not declare `RESOLVED` from:
- one HTTP 200;
- green scheduler/service status;
- successful notification delivery;
- candidate test PASS alone.

Require:
- exact published/assigned candidate identity known;
- observation proves the intended client/profile actually became active;
- target failed contour passes;
- previously healthy required contours remain passing;
- no new bounded incident/replay/security regression;
- evidence class states whether the observation is synthetic, installed, live or production.

Only then may incident state advance from candidate/rollout to observed recovery.

## Current practical gate

For current `0.2.6`:
- package bytes are frozen and must not be modified;
- profile-only DOM repair is currently blocked by `NOT_WIRED`;
- future DOM repair therefore needs a new package version unless C's shared profile
  consumer is implemented and accepted first;
- a legitimate dedicated ChatGPT session remains required for the later live Standard
  vertical slice; no CAPTCHA/2FA bypass is part of A's work.
