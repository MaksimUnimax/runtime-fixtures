# A04 business scenario gold protocol — 2026-10-01

Status: **SOURCE CANDIDATE PASS AFTER REVIEW REWORK / FINAL INDEPENDENT REVIEW AND PUBLICATION PENDING**.

Task: `A04-BUSINESS-GOLD-PROTOCOL`.
Role: A.
Clean isolated base: `7ed7294150fb8797bd2141b93f295ac144441509`.

## Result

This candidate closes the automation-side ambiguity behind the readiness gap “единый численный gold set и смысловой протокол” without inventing real marketplace values or owner semantic verdicts.

It accounts for:

- 45 canonical scenarios;
- 2 marketplaces;
- 3 distinct validation layers;

for exactly **270 logical source cards**.

No current `NOT_RUN` live AI result is converted to PASS.

## Numeric binding

The existing scenario `numericFixtures` field contains 40 semantic labels but was not previously a uniform executable namespace.

The protocol makes every label explicit:

- 21 `EXECUTABLE_KIND`;
- 2 `EXECUTABLE_CASE`;
- 17 `OWNER_ONLY_BOUNDARY / NO_EXECUTABLE_NUMERIC_RULE_BOUND_IN_V1`.

Across both marketplaces:

- 52 deterministic-arithmetic cards are source-automatable;
- 38 remain owner-only boundaries;
- all 90 owner semantic cards remain pending owner/external evidence.

The existing 58 numeric cases remain canonical; their expected numbers are not copied or altered by this task.

## Fixed periods and persisted definition binding

Independent review R1 correctly rejected the first candidate because it had only a period policy/free-form manual period and an in-memory incomplete definition hash.

R1 review:
`/root/octoport-control/logs/A/a04-business-gold-protocol-review-20261001-result.md`

Verdict: **REWORK_REQUIRED**.

The rework adds two concrete versioned synthetic gold periods:

- `GOLD_MONTH_2026_09_MSK`: 2026-09-01 00:00:00+03:00 through 2026-09-30 23:59:59+03:00;
- `GOLD_SNAPSHOT_2026_09_30_MSK`: 2026-09-30 12:00:00+03:00;
- timezone: `Europe/Moscow`.

These are reproducible gold-test windows, not claims about a hidden provider default and not live request mutations.

The protocol persists exactly 90 scenario/marketplace definition rows. Each row carries an exact `periodRef` and `definitionsHash`. The definition hash now covers:

- protocol, coverage and numeric-fixture schema versions;
- readiness semantic-projection hash and marketplace operation-registry authorities;
- exact check-layer/status policy and owner-verdict schema;
- scenario and marketplace;
- coverage state and operations;
- identifiers and metrics;
- period policy, period ref and full period object;
- continuation and omission policy;
- external dependency;
- numeric semantic labels;
- the exact numeric binding records for those labels (executable kind/case IDs or owner-only reason);
- the complete referenced numeric fixture rows, including canonical `input` and `expected` values;
- the **complete** canonical global policy object, including effect, provider request, continuation, join, missing, currency and timezone rules.

Persisted definition-index SHA-256:

`1f407ff5ffeb52d35f8e6eb0196fbc0d822fc83e211a277c76ec79f4888d90e2`.

Manual verdict metadata uses an exact six-field string-valued allowlist. `scenarioId + marketplace + periodRef + definitionsHash` must match one persisted definition-index row; coercible arrays/objects, arbitrary periods/hashes and any unspecified field fail closed.

## Privacy boundary

Manual verdict metadata is limited to:

- scenario ID;
- marketplace;
- exact period ref;
- exact definitions hash;
- bounded result class;
- verdict `PASS | FAIL | BLOCKED`.

The schema uses an exact six-field allowlist and separately forbids raw provider payload, token, OTP, cookies, account/store/device/session/conversation identifiers and full AI transcript. The gate rejects any unspecified field and requires `scenarioId + marketplace + periodRef + definitionsHash` to match one exact definition-index row.

## Post-rework source checks

Node: `v24.20.0`.

Direct gold-protocol gate:

- scenario count: 45;
- marketplace count: 2;
- check layers: 3;
- logical cards: 270;
- bindings: 21 executable kinds / 2 executable cases / 17 owner-only boundaries;
- arithmetic cards: 52 automatable / 38 owner-only;
- owner semantic cards: 90 pending;
- definition index: 90 rows;
- definition-index SHA-256: `1ea580b99d5dfb662551f5884279986bbe0d00c7757740d92e45e1454401aec7`;
- PASS.

Existing `business-scenario-coverage.mjs` post-rework:

- 45 scenario rows;
- 101 Ozon operation refs;
- 133 WB operation refs;
- 58 numeric cases;
- PASS.

Prettier: PASS.
`git diff --check`: PASS.

## Post-rework CI-path integration proof

`tests/regression/extension-core/core-contracts.mjs` imports the new protocol gate, so the normal Extension CI contract path executes it.

Post-rework supervised run:

- `tooling/checks/extension_core.py`;
- evidence directory: `/root/octoport-control/logs/A/a04-business-gold-protocol-20261001/extension-core-r2`;
- resource job: `fc7ac5c38bfc4e249fceff77e9a7e110`;
- `core-source-contracts`: PASS;
- `core-package-contracts`: PASS;
- final stage/status: `D2.4 / PASS`;
- gate processes: 142;
- `live_provider_calls=0`;
- installed acceptance not claimed;
- supervisor exit 0;
- cleanup reported verified;
- peak supervised memory about 179 MiB.

The harness's `middle-failure` line is its built-in expected negative control; the overall run exited 0/PASS.

The earlier extension-core R1 was pre-review-rework and is historical only.

## 2026-10-02 publication-review hash hardening

Fresh publication review found that the persisted definition hash covered numeric labels but not the exact binding records behind those labels. The candidate now hashes the per-scenario binding records too, so changing an executable kind/case ID or owner-only reason changes `definitionsHash`.

Post-hardening Node 24 evidence: `/root/octoport-control/logs/A/a04-business-gold-protocol-publish-20261002-r2`.

- direct coverage gate: PASS;
- direct gold-protocol gate: PASS;
- definition-index SHA-256: `2052c1054033cbdf05478d92b754fae8710e2097feb3dd13a23a7d25b821b8e2`;
- normal `tooling/checks/extension_core.py`: `D2.4 / PASS`;
- gate processes: 145;
- `live_provider_calls=0`;
- `installed_acceptance=false`.

The next independent review rejected this intermediate candidate because numeric fixture row contents were not yet hashed and the manual-verdict schema was not yet enforced as an exact allowlist/definition-index tuple.

## 2026-10-02 publication-review numeric-case and verdict hardening

The final source candidate now:

- hashes the numeric fixture schema plus every referenced canonical numeric case row, including `input` and `expected`;
- rejects any manual-verdict field outside the exact six-field allowlist;
- requires `scenarioId + marketplace + periodRef + definitionsHash` to match one exact definition-index row;
- retains the explicit privacy denylist in addition to the stricter allowlist.

R3 intermediate definition-index SHA-256: `1943848dc74bde2d109d335ea0e573851f75af66b2881c7a537ddc6f7d8097eb`.

R3 supervised Node 24 evidence: `/root/octoport-control/logs/A/a04-business-gold-protocol-publish-20261002-r3/extension-core`.

- normal `tooling/checks/extension_core.py`: `D2.4 / PASS`;
- gate processes: 145;
- `live_provider_calls=0`;
- `installed_acceptance=false`;
- resource unit: `octoport-test-a-0a61287cd93c41ed99c0bb44f438f601.service`;
- resource exit: 0;
- peak supervised memory: 180 MiB;
- cleanup verified.

R3 independent review then found two additional fail-closed gaps: manual tuple identity fields accepted coercible non-string values, and generated card statuses were constrained only by excluding literal `PASS`. The current candidate requires all six manual verdict fields to be strings and validates each card against the exact allowed status set for its layer. Those semantics are included in the definition hash.

Current hardened definition-index SHA-256: `1f407ff5ffeb52d35f8e6eb0196fbc0d822fc83e211a277c76ec79f4888d90e2`.

Current supervised Node 24 evidence: `/root/octoport-control/worktrees/A/A04-BUSINESS-GOLD-PROTOCOL-PUBLISH-FRESH-20261002/verification-r4/extension-core`.

- normal `tooling/checks/extension_core.py`: `D2.4 / PASS`;
- gate processes: 145;
- `live_provider_calls=0`;
- `installed_acceptance=false`;
- resource unit: `octoport-test-a-25d35d8d5d8041378b4346bc832d52ae.service`;
- resource exit: 0;
- peak supervised memory: 174 MiB;
- cleanup verified.

Publication additionally requires a fresh independent gpt-6-luna review of the exact final candidate; that review evidence is stored outside the source candidate.

## Evidence boundary

Evidence level is exactly **SOURCE + LOCAL_PACKAGE_CONTRACT**.

This does not prove:

- real Ozon/WB values or permissions;
- live AI correctness/usefulness;
- owner semantic PASS for any scenario;
- 45×2×3 live execution;
- browser installation or LIVE_OWNER behavior;
- production readiness.

Real semantic verdicts remain a separate owner/manual gate, bound to the persisted fixed period and current definitions hash.

Publication acceptance requires an external fresh independent gpt-6-luna review of the exact post-hardening candidate plus the governed clean-route mechanism. The publication candidate must not inherit the rejected B05 history from the fixed A worktree.
