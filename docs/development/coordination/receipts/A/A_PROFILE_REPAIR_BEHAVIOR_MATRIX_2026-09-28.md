# A — ChatGPT signed-profile repair behavior matrix — 2026-09-28

Status: **FIXTURE MATRIX PASS / PROFILE_ONLY BOUNDARY PROVEN / NO RELEASE AUTHORITY**.

Task: `A_AUTO_REPAIR_BEHAVIOR_MATRIX` (A04).
Product HEAD exercised: `b7d32108625517d0000ca782d2f23608315ecc0a`.
Test: `tests/regression/extension-core/client-i1/profile-repair-behavior-matrix.py`.

Canonical evidence:
`/root/octoport-control/logs/A/profile-repair-matrix-b7d32108-r2/summary.json`.

- schema: `chatgpt_profile_repair_fixture_matrix_v1`;
- suite: `chatgpt_standard_profile_repair_behavior@1`;
- evidence class: `FIXTURE_MATRIX`;
- scope: ChatGPT/web/standard_composer, `AUTHENTICATED_DEEP`, `H4_CANDIDATE`;
- actual browser identity: Chrome family, `151.0.0.0`;
- LOCAL_DEVELOPMENT package SHA-256:
  `fcd0f6d275233622d77185f2aedbbe35c63cad69769d69e1872ab0c53a35528b`;
- semantic matrix SHA-256:
  `d2f9827c12c090ae6e293ac93060b78a758ffb934ce3d8300c4e397b8c946d61`;
- SOURCE/EXTRACTED semantic parity: PASS;
- live provider calls: 0;
- production apply authority: false.
## Executable matrix

The same packaged composer baseline was exercised in isolated real-MV3 browser profiles.

1. `UNCHANGED_BASELINE`: signed textbox-role profile + normal composer -> PASS / `NO_CHANGE`.
2. `COSMETIC_DOM_CHANGE`: class/dataset-only DOM change -> PASS / `NO_CHANGE`.
3. `IMPORTANT_ROLE_BREAK_OLD_PROFILE`: composer remains discoverable by packaged code but
   semantic role changes from textbox to status; old profile fails closed with
   `CONTENT_ADAPTER_ERROR`.
4. `VALID_PROFILE_REPAIR`: the same changed DOM with a valid signed
   `accessibility_role_name=status` profile passes -> `PROFILE_ONLY`.
5. `PACKAGED_ANCHOR_REMOVED`: the packaged composer discovery anchor is removed; even the
   valid status-role profile cannot create a baseline -> `PACKAGE_UPDATE`.

This proves the intended boundary: profile data may select/filter behavior that the package
already knows how to find; it cannot invent a new DOM detector or primitive.

Fresh regressions in the same supervised job also prove:
- invalid profile material fails closed;
- stale/out-of-order profile cannot replace current material;
- ChatGPT -> Alice scope mismatch clears the old ChatGPT profile;
- signed rollback to a previously valid profile works;
- failed profile ensure blocks Start/Resume before legacy irreversible action.
## Copy ownership, no replay and Finish

Fresh `chatgpt-dom-compat.py` evidence preserves the whole-response Copy boundary:
- `response_copy_only_plain` -> no code block;
- misleading `data-code-copy-state` on Response-actions Copy -> no code block;
- localized whole-response Copy -> no code block;
- real code Copy and fenced-code fallback remain recognized.

Fresh native `browser_application.py` evidence preserves:
- response-actions Copy exclusion;
- user/editor/ambiguous/unrelated negatives;
- no replay after completed execution;
- one-shot binary delivery;
- explicit Finish.

The SOURCE and EXTRACTED regression outputs have identical content hashes for the signed
consumer/runtime and DOM/native result payloads.

## C binding / shared identity

No missing shared field was found. The existing monitoring/evaluation authority already has
the needed scope fields:
`provider/surface/target/variant/monitoringLayer/phase/browserFamily/browserVersion/environmentClass`,
plus suite machine key/revision and authoritative baseline/candidate revision UUIDs.

The fixture matrix deliberately stores null for:
- `incidentId`;
- `acceptedBaselineId`;
- `baselineProfileRevisionId`;
- `candidateProfileRevisionId`.
C must bind those values and the current assignment revision from a real repair case.
A does not infer an accepted baseline or monitoring UUID from a green fixture test.

This matrix therefore complements, rather than replaces, the canonical H4/H5 evaluation and
repair-admission records.

## Updated practical gate

The older operator checklist predates the accepted signed-profile DOM consumer and says
PROFILE_ONLY is globally `NOT_WIRED`. That practical statement is superseded for the
already-proven consumer boundary: SOURCE/EXTRACTED plus Firefox installed lifecycle now show
signed profile application, safe defer and rollback.

PROFILE_ONLY is still **not universal**:
- the target package/browser must have the accepted consumer;
- the change must fit the existing `adapter_profile_v1` bounded vocabulary;
- the packaged baseline must still discover the element;
- exact candidate + rollback pair + real repair-case identity + required operator approval remain mandatory.

A new packaged detector, primitive, permission, manifest rule or executable behavior remains
`PACKAGE_UPDATE` with a strictly new immutable package version.

## Supervision / limits

Resource receipt:
`/root/octoport-control/resource-jobs/b8f1b958713c41fc9430aeac00c4b03d/receipt.json`.
Exit 0, OOM 0, cleanup verified, peak `458227712` bytes.
The ephemeral Ed25519 private key was removed after the run.

No live ChatGPT account, marketplace provider, owner GUI, store submission, rollout,
operator approval, production assignment or recovery declaration was performed.
