# A04 WB provider-neutral response policy foundation R1 — 2026-10-07

## Result

SOURCE FOUNDATION PASS.

This task migrates one dependency-closed provider-neutral prerequisite from the
preserved mature Wildberries v0.3.0 donor into bridge-core:

- bounded metadata tree validation;
- deterministic canonical JSON;
- strict date / date-time parsing;
- bounded reviewed schema compilation;
- schema validation;
- bounded provider-response tree validation.

The common implementation is
packages/bridge-core/src/execution/provider-response-policy.js and exposes
SellerAgentsProviderResponsePolicy.

## Accepted source basis

The preserved donor authority is:

- migration/reference/wildberries-v0.3.0/runtime/shared/runtime_policy.js
  for canonical/date/schema behavior;
- migration/reference/wildberries-v0.3.0/runtime/shared/response_verifier.js
  for bounded response-tree behavior;
- docs/development/QUALITY.md for subsystem/dependency/differential acceptance;
- docs/development/EXTENSION_WB_ADAPTER.md and
  docs/decisions/OPEN_ITEMS.md for the still-open provider-neutral WB migration.

The task deliberately excludes quota/cache/LKG/planner/entitlement/business
policy. Those donor concerns are not silently copied into this common kernel.

## Differential evidence

tests/regression/extension-core/provider-response-policy.mjs compares the common
kernel directly with the preserved donor globals on identical vectors.

Focused differential:

- 33 assertions PASS;
- unsafe metadata/response keys fail closed;
- response depth/key budget/non-finite values fail closed;
- unsupported/malformed schema keywords/types/ranges fail closed;
- required/additional-property/enum/range/length validation matches donor;
- strict date/date-time behavior matches donor;
- live_provider_calls = 0;
- browser_actions = 0;
- test asserts the new module is not present in extension composition.

Evidence:

- focused log SHA256
  cc72c96da62baf0ee487e54167313888622894813260eec3ddbf4ce29f38a9f9;
- common source SHA256
  03a03c9d55c4d503027ff2cc52d39513695c9a4f0fbbd58d6648556b25ec8c50;
- differential test SHA256
  89111edc919437c398a139f56e7c79d555b611ffd1fcf7452f8628f0657babce.

## Permanent gate

tooling/checks/extension_core.py runs
core-provider-response-policy-differential before source/package composition.

The full D2.4 extension-core gate completed:

- status = PASS;
- gate_processes = 156;
- live_provider_calls = 0;
- installed_acceptance = false;
- all existing source and extracted-package regressions passed;
- existing package was rebuilt and exercised without the foundation being
  silently included in worker composition.

Evidence:

- heavy log SHA256
  5d47214d69f4487d6e4a588e9b48242dddd9ed5c1b75d723604b76121af3c3d9;
- D2.4 gates SHA256
  add54201acb5dbeef02626d95d439615915257c449cd46f7fd0cd0da05377567;
- composition receipt SHA256
  b3ee22d22dd7352173a9e6febb8306d027dcf196a0c5c88416734f48af64ad80.

## Boundaries intentionally preserved

This result does not:

- modify apps/extension/composition.json;
- modify packages/marketplaces/wildberries/src/adapter.js;
- load SellerAgentsProviderResponsePolicy into the packaged worker;
- activate or invent a WB live response schema;
- claim donor response_verifier provider integration/quarantine as migrated;
- perform a provider request, credential read, browser action, DB/service or
  live queue mutation;
- change installed extension behavior;
- close provider-neutral WB migration completeness;
- reopen WB R1–R8.

WB 0.3.0 installed FAIL, provider-neutral migration REOPENED, and
R1–R8 CLOSED until established provider-neutral acceptance remain unchanged.

A later separately reviewed slice may wire a common response verifier into the
runtime once the unresolved composition/OWNER-START scope is no longer in
conflict. Quarantine, artifact retention, delivery and installed provider
acceptance remain separate gates.
