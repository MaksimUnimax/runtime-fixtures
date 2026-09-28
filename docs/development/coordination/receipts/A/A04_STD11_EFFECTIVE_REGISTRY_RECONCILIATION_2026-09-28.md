# A04 — STD-11 effective WB registry reconciliation — 2026-09-28

Status: **SOURCE EFFECTIVE-REGISTRY CONSUMER PASS / CURRENT MAIN STILL WITHOUT ITEM-RETURNS**

Task: `A04_STD11_EFFECTIVE_REGISTRY_RECONCILIATION`.

Controller assignment:
`A-STD11-EFFECTIVE-REGISTRY-20260928-1011`.

Parent A base:
`a8a97dca6394b7ca97b60504065fda59341bc8dc`.

Accepted `origin/main` during final verification:
`182847f15abdf307ea1dabca38e5b52ab3695731`.

Pinned C shared-authority candidate:
`bac8cc88bb58298b07d2235390363aa706abe43a`.

## Defect closed

The earlier STD-11 validator loaded only the frozen WB donor
`migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js`.
It therefore could report `replacementPresent=false` even when the composed
product registry applied an effective overlay that added
`analytics_item_returns`.

That was not a valid integration tripwire.

The validator now separates:

1. **frozen donor inventory** — historical donor bytes remain unchanged;
2. **accepted effective registry** — donor plus the registry overlays in the
   exact `apps/extension/composition.json` order before credentials/contracts;
3. **pinned combined C candidate** — the same effective loader with the exact
   `bac8cc88` analytics-overlay bytes supplied as an isolated override.

No C/shared runtime file is changed by A.

## Current accepted authority

On current accepted main:

- donor `analytics_item_returns`: absent;
- accepted effective `analytics_item_returns`: absent;
- `goods_return`: still current+enabled on its documented deprecated path;
- STD-11 therefore retains a source-only dependency that the replacement is not
  yet in the **accepted effective registry**;
- generic write-off/transfer causality remains unverified.

The coverage dependency wording was narrowed from
`NOT_IN_ACCEPTED_REGISTRY` to
`NOT_IN_ACCEPTED_EFFECTIVE_REGISTRY`.

## Pinned C candidate proof

The exact C overlay SHA-256 is:

`c0b20ab4c81dd8b398bbd171114dcb1518d3fe8ef83ad18e3fb16d1af115a2de`.

The combined-source validation proves:

- frozen donor still has no `analytics_item_returns`;
- effective registry has exactly one `analytics_item_returns`;
- method `GET`;
- path `/api/analytics/v1/item-returns`;
- `effect=READ`;
- `execution_enabled=true`;
- `current=true`;
- required/query identity is exactly
  `dateFrom,dateTo,status,limit,offset`;
- legacy `goods_return` remains current before its separate retirement boundary.

A negative drift case rewrites the candidate replacement path in-memory and
requires the current-authority check to reject it.

## Verification

Node: `v24.20.0`.

Current accepted A effective registry:

`node tests/regression/extension-core/wb-inventory-movement-boundary.mjs`

PASS:
- `donorReplacementPresent=false`;
- `acceptedEffectiveReplacementPresent=false`;
- `pinnedCandidateDetected=false`.

Pinned C combined-source validation:

`node tests/regression/extension-core/wb-inventory-movement-boundary.mjs /tmp/a-bac8-item-returns-overlay.js`

PASS:
- exact overlay SHA matched;
- `pinnedCandidateDetected=true`;
- `driftNegativeRejected=true`.

Aggregate current-source gate:

`node tests/regression/extension-core/business-scenario-coverage.mjs`

PASS:
- scenario rows: 45/45;
- Ozon refs: 101;
- WB refs: 133;
- numeric cases: 58.

`git diff --check`: PASS.

Changed evidence SHA-256:
- `tests/regression/extension-core/wb-inventory-movement-boundary.mjs`:
  `d38b0b1abea75800128dfdf585db53b15234ecc775e6e970b8b753aae421b6a1`;
- `tests/regression/extension-core/fixtures/wb-inventory-movement-boundary-v1.json`:
  `3491a594fe7216067d77b2fbd4e0b9b7294f9e8dc50745bd23e3925fa27ebb56`;
- `tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json`:
  `661e850d1875b09652a1b38f8a6532a5c1793517f0e34d4a757ad22d6853481f`.

No full extension/browser/package suite was rerun because A changes only
source evidence/tests; product/runtime/package bytes are unchanged.

## Next boundary

Once the accepted `origin/main` contains `bac8cc88` (or a reviewed equivalent
with the same authority), A must merge main normally and perform the small
current-state follow-up:

- set accepted effective replacement expectation to true;
- remove the shared-authority absence from STD-11 coverage;
- preserve generic write-off/transfer causality as unverified;
- rerun focused + aggregate checks and resubmit current evidence.

Evidence level: **SOURCE only**. No provider request, installed browser,
LIVE_OWNER, store, deployment or production acceptance is claimed.
