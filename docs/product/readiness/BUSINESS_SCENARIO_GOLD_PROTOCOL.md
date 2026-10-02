# Business scenario gold protocol

Status: **SOURCE-ONLY PROTOCOL / LIVE AND OWNER VERDICTS NOT RUN**.

This protocol closes the automation-side ambiguity behind the readiness gap “единый численный gold set и смысловой протокол”. It does not invent real marketplace values and does not replace owner semantic acceptance.

## Canonical inputs

The protocol reuses, rather than duplicates:

- `docs/product/readiness/BUSINESS_SCENARIOS.tsv` — 45 canonical scenario IDs and current manual/live matrix;
- `tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json` — per-scenario Ozon/Wildberries operations, identifiers, metrics and source policies;
- `tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json` — 58 deterministic numeric/boundary cases over 25 executable calculator kinds;
- the existing marketplace operation registries validated by `business-scenario-coverage.mjs`.

No customer/store payload, token, OTP, account/store/device/session/conversation identifier or full AI transcript belongs in this protocol.

## 45 × 2 × 3 cards

The source gate expands the canonical 45 scenarios across:

- two marketplaces: `OZON`, `WILDBERRIES`;
- three distinct check layers:
  1. `provider_fact`;
  2. `deterministic_arithmetic`;
  3. `owner_semantic_verdict`.

That is exactly **270 logical cards**. The key is `scenarioId + marketplace + layer`; duplicates fail closed.

### Provider facts

A provider-fact card binds the current coverage state, operation aliases, identifiers, metrics, fixed gold-period reference, continuation policy, missing-data policy and all canonical global policies.

Its status is `SOURCE_DEFINED_NOT_LIVE_ACCEPTED`, never PASS. The existing coverage gate remains responsible for proving operation aliases against actual Ozon/WB registries.

### Deterministic arithmetic

The historical `numericFixtures` field is a semantic-label namespace, not a uniform executable ID namespace. The protocol makes the relationship explicit:

- 21 labels bind to an executable calculator kind;
- 2 labels (`warehouse_stock_sort`, `warehouse_sales_sort`) bind to concrete executable case IDs;
- 17 labels have no executable numeric rule bound in v1 and are explicitly `OWNER_ONLY_BOUNDARY`.

This yields 52 marketplace arithmetic cards that are source-automatable and 38 arithmetic cards that remain owner-only boundaries. An unresolved label cannot silently become an automated PASS.

The existing 58 numeric fixtures remain the canonical deterministic expected values. The protocol does not copy or alter their numbers.

### Owner semantic verdict

Every scenario/marketplace pair has one semantic card. It starts as:

- `PENDING_OWNER` when no external dependency is declared;
- `PENDING_EXTERNAL` when the scenario explicitly requires external/live evidence.

A manual verdict must reference the exact persisted definition row and contain:

- `scenarioId`;
- `marketplace`;
- `periodRef`;
- `definitionsHash`;
- result class;
- verdict `PASS | FAIL | BLOCKED`.

The manual-verdict contract is an exact six-field string-valued allowlist: no additional metadata field is accepted. The four identity fields `scenarioId + marketplace + periodRef + definitionsHash` must be strings and must match one exact persisted definition-index row; coercible arrays/objects, or a hash or period copied from another row, fail closed.

## Fixed gold periods

The periods are synthetic, reproducible gold-test windows. They are not a claim about a provider's hidden default timezone and do not change live request semantics.

The project already uses explicit `Europe/Moscow` request/timezone contracts in WB finance/cross-source field-schema evidence. Gold protocol v1 therefore fixes:

- `GOLD_MONTH_2026_09_MSK`: 2026-09-01 00:00:00+03:00 through 2026-09-30 23:59:59+03:00, timezone `Europe/Moscow`;
- `GOLD_SNAPSHOT_2026_09_30_MSK`: 2026-09-30 12:00:00+03:00, timezone `Europe/Moscow`.

The 43 `EXPLICIT_WHERE_APPLICABLE` scenarios bind to the fixed month. The two `CURRENT_SNAPSHOT` scenarios bind to the fixed snapshot.

## Persisted definition index

`business-scenario-gold-protocol-v1.json` persists exactly 90 scenario/marketplace definition rows.

Each `definitionsHash` covers the complete canonical definition payload:

- protocol, coverage and numeric-fixture schema versions;
- readiness semantic-projection hash and marketplace operation-registry authorities;
- exact check-layer/status policy and owner-verdict schema;
- scenario and marketplace;
- coverage state and operation aliases;
- identifiers and metrics;
- period policy, exact `periodRef` and full period object;
- continuation and omission policy;
- external dependency;
- numeric semantic labels;
- the exact numeric binding records for those labels (executable kind/case IDs or owner-only reason);
- the complete referenced numeric fixture rows, including their canonical `input` and `expected` values;
- the complete `globalPolicies` object, including `effect`, provider-request rule, continuation rule, join rule, missing rule, currency rule and timezone rule.

The entire persisted index is itself hashed. Gold protocol v1 definition-index SHA-256 is:

`1f407ff5ffeb52d35f8e6eb0196fbc0d822fc83e211a277c76ec79f4888d90e2`.

A manual semantic verdict can therefore compare an obtainable persisted `periodRef + definitionsHash`, rather than relying on an in-memory hash or free-form period.

## Privacy-safe manual result

The protocol forbids:

- raw provider payload;
- token, OTP or cookies;
- account/store/device/session/conversation identifiers;
- full AI transcript.

Only the six allowlisted fields belong in a later manual verdict. Unknown fields—including fields that are not individually named in the denylist—are rejected.

## Current evidence boundary

The six live AI columns in `BUSINESS_SCENARIOS.tsv` are still `NOT_RUN`. The source gate deliberately fails if that matrix changes without explicit protocol-integration review.

Therefore this task proves only:

- complete 45×2×3 source accounting;
- executable numeric linkage where a rule exists;
- explicit non-automatable boundaries where it does not;
- fixed reproducible period definitions;
- persisted definition hashes for later manual binding;
- a privacy-safe owner verdict contract.

It does **not** prove real Ozon/WB values, real AI usefulness, live account permissions, field completeness, 45×2×3 live execution or production readiness.
