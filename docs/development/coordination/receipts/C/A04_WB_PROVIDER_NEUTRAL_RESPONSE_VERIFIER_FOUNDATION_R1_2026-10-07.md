# A04 WB provider-neutral response-verifier foundation R1

- Task: A04-WB-PROVIDER-NEUTRAL-RESPONSE-VERIFIER-FOUNDATION-R1-20261007
- Role: C
- Base / accepted main at implementation start: 4543d5abda3685414390f3394404d63ace9c30b9
- Evidence level: SOURCE FOUNDATION ONLY
- Created: 2026-10-07T08:43:59.704382+00:00

## Exact scope

This slice introduces only the provider-neutral response-verifier foundation and its permanent differential:

1. packages/bridge-core/src/execution/provider-response-verifier.js
2. tests/regression/extension-core/provider-response-verifier.mjs
3. tooling/checks/extension_core.py
4. this receipt

It does not change apps/extension/composition.json or packages/marketplaces/wildberries/src/adapter.js. It does not attach a live WB schema or semantic policy and does not widen the current packaged runtime.

## Accepted dependency and donor closure

The verifier depends fail-closed on the already accepted common provider-response-policy foundation.

Exact prerequisite/donor bytes:

- common provider-response-policy.js SHA256 03a03c9d55c4d503027ff2cc52d39513695c9a4f0fbbd58d6648556b25ec8c50
- donor response_verifier.js SHA256 738e21b1f3d14d42d11a9f13f2d3d7b5972d1fcedeb03fb2482e22e93ff2ac45
- donor runtime_policy.js SHA256 83d4718621ec1c6a6b36e7f72aea64cf42772b3927725d37dbdd842c6777b242

Exact new/gate bytes before candidate freeze:

- provider-response-verifier.js SHA256 d3bea66f78e992e1d385c8ba612b7ecae3d17190fb84745edeb3d5e0c85c13b7
- provider-response-verifier differential SHA256 598b8f4ee319a0acdca157d03ff9833618d4bafa44a7003e864bc43aafba92d2
- extension_core.py SHA256 83e1cbbe0f568cc333eebb3cb6cd7e93733fdfdebcf80230c92e24b40b07983b

The common dependency provides the reviewed bounded response tree, schema compile and schema validation primitives. The verifier fails closed with PROVIDER_RESPONSE_POLICY_REQUIRED when that dependency is unavailable.

## Donor behavior preserved

The new provider-neutral verifier migrates only the donor policy(value) and verify(response, options) mechanics:

- policy admission requires reviewed=true and non-empty source_revision;
- semanticError, when present, must be a function;
- reviewed schemas are compiled through the accepted common response-policy dependency;
- JSON and +json content types are parsed strictly;
- empty 204/205 JSON responses become null with parse=empty;
- non-JSON parsed values retain donor behavior;
- unsafe response keys, response depth/key budget and non-finite values fail closed through the common policy;
- schema validation runs only for response.ok and returns donor-compatible failure codes/details;
- semantic validation runs only for response.ok, preserves safe uppercase error codes and sanitizes invalid/throwing semantic errors;
- HTTP error responses preserve donor result semantics without claiming full verification;
- binary mode preserves donor behavior;
- fully_verified is true only when response.ok and both configured schema and semantic checks pass.

No quota/cache/LKG/planner/admission/entitlement/business-date/provider schema or provider business policy is migrated by this slice.

## Behavioral evidence

Focused donor differential:

- evidence: /root/octoport-control/logs/C/wb-provider-neutral-response-verifier-foundation-r1-20261007/FOCUSED_DIFFERENTIAL.log
- SHA256: 985eec12b06050dc535e4c953f874be5f33616e2d0297caedc13317769d600f7
- result: PASS
- assertions: 31
- live provider calls: 0
- browser actions: 0
- packaged runtime widened: false
- live schema attached: false

Covered behavior includes policy admission, schema compiler failures, JSON/content-type parsing, empty 204/205, unsafe/non-finite trees, schema pass/fail, semantic pass/error/sanitization, binary behavior, HTTP error behavior, fully_verified semantics, dependency absence and composition exclusion.

Permanent extension-core gate:

- heavy result: /root/octoport-control/logs/C/wb-provider-neutral-response-verifier-foundation-r1-20261007/HEAVY_RESULT.json SHA256 8a6f42ebe495965f47943ac650e28615a2f6eed3499c92c15bfba5ba091e0b9f
- heavy log: /root/octoport-control/logs/C/wb-provider-neutral-response-verifier-foundation-r1-20261007/EXTENSION_CORE_HEAVY.log SHA256 a5c4283703102fc9b9f34b68f5b2043edc98285278c9544f3a81bb4b5abd973a
- status: PASS
- gate processes: 157
- resource exit code: 0
- resource cleanup verified: true
- installed acceptance: false

tooling/checks/extension_core.py permanently runs core-provider-response-verifier-differential.

Organization gate before this receipt:

- comparison: /root/octoport-control/logs/C/wb-provider-neutral-response-verifier-foundation-r1-20261007/org-audit/comparison-before-receipt-rev316.json
- SHA256: 1fedc192b394bfdd96dc9435e379bb1136249648be43742202c00208f5ad7d90
- registry revision: 316
- all 39 organization IDs covered
- review-clock issues empty

## Product/currentity boundaries preserved

This foundation does not change current packaged WB behavior and does not claim provider, browser, installed, live, deployment or production acceptance.

The required current states remain explicit:

- WB INSTALLED: FAIL / blocked.
- Provider-neutral WB migration: REOPENED / completeness not proven.
- Historical R1-R8 source/evidence slices: CLOSED and not reopened by this task.
- Installed/provider certification remains separate and blocked; CLOSED above refers only to the historical slice work, not installed-provider acceptance.

Separate future slices are still required for:

- composition/runtime wiring;
- WB adapter integration;
- reviewed live provider schema/semantic policy attachment;
- quarantine/delivery integration;
- installed ordinary auth/provider validation;
- browser/operator acceptance.

## Negative authority

No token, credential, provider call, browser action, DB/service mutation, live queue mutation, composition widening, WB adapter wiring, live schema attachment, quota/cache/LKG/planner migration or business-rule migration was performed by this source foundation.
