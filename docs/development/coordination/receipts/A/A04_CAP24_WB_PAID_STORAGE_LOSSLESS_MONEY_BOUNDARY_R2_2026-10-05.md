# A04 CAP-24 — WB paid-storage lossless money boundary R2

Task: `A04-CAP24-PAID-STORAGE-LOSSLESS-MONEY-BOUNDARY-R2-20261005`

## Scope and base

- Exact base / fresh `origin/main`: `7efa64b169791ee85eb1feecac9a94a4ce209ca5`.
- Fresh-main reconstruction from the pre-review base `58538782da935144ce862bd60516e67f1b62187e` was conflict-free: intervening main changed only six B05 owner-test resource-guardrail/receipt files and none of this task's three declared paths.
- Changed runtime boundary: `packages/marketplaces/wildberries/src/adapter.js`.
- Focused regression: `tests/regression/extension-core/wb-adapter.mjs`.
- No frozen `migration/reference` file, registry, provider request, credential, DB, server, browser or live state is changed.
- This successor follows the blocked R1 finding that a decoded ECMAScript `Number` cannot prove the provider's original monetary decimal lexeme.

## Problem proved before the fix

Two distinct valid JSON numeric lexemes can collapse to one IEEE-754 value after `JSON.parse`:

- `0.10000000000000001`
- `0.1`

Both decode to JS `0.1`. Therefore `String(number)` is not an exact-money authority and binary `Number` aggregation remains forbidden for CAP-24.

The focused red test reproduced this in the real composed WB adapter: expected `"0.10000000000000001"`, actual `0.1`.

## Implemented boundary

The WB adapter already receives a byte-bounded `response.rawText` from the frozen provider transport before ordinary `JSON.parse`.

R2 adds one lexical normalization at that existing boundary:

- it runs **only** for operation `paid_storage_download`;
- for a non-empty paid-storage body it parses the bounded raw body through this lexical boundary regardless of response `Content-Type`, so an incorrect or missing JSON header cannot fall back to an already-rounded parsed `Number`;
- it recognizes a real JSON object property whose decoded key is `warehousePrice`;
- when that property's value is a valid JSON number token, the exact token is quoted before normal `JSON.parse`;
- therefore the delivered/persisted `WB_RESULT_V1.result[*].warehousePrice` is an exact decimal string for this operation;
- escaped property spelling, fraction/exponent syntax and lexical trailing zeroes are preserved;
- unrelated fields keep their existing JSON types;
- other WB operations keep the legacy parse path;
- malformed JSON remains `PROVIDER_JSON_INVALID`.

This is a local output normalization. The official provider source schema is still a JSON number; this receipt does not rewrite provider evidence. It deliberately changes the delivered `paid_storage_download.warehousePrice` type from provider JSON number to exact decimal string. No active runtime consumer was found that requires the former numeric type, but the synthetic paid-storage schema-slice validator still models the provider field as a number; any future contribution consumer must adopt the exact string boundary explicitly before arithmetic.

## Deliberate non-goals / fail-closed boundaries

R2 does **not**:

- infer a decimal scale;
- round a value;
- convert or infer currency;
- aggregate storage;
- deduplicate recalculation rows;
- compute CAP-24 platform contribution or net profit;
- claim a live WB observation.

The existing component-policy and common-currency gates remain open and CAP-24 contribution stays fail-closed.

## Verification

Red-before-green:

- before the runtime change, `WB-12a-paid-storage-preserves-exact-money-lexemes` failed with actual `0.1` versus expected exact string `0.10000000000000001`.

Focused green:

- pre-review candidate composed source/runtime WB adapter: **26/26 PASS**;
- pre-review candidate extracted package WB adapter: **26/26 PASS**;
- review-driven final composed source/runtime WB adapter on Node `v24.20.0`: **27/27 PASS**;
- review-driven final extracted package WB adapter on Node `v24.20.0`: **27/27 PASS**;
- the added P2 regression preserves exact paid-storage lexemes when the provider JSON body is mislabeled `text/plain` or arrives without a JSON `Content-Type`, while malformed paid-storage JSON mislabeled `text/plain` remains `PROVIDER_JSON_INVALID`;
- task-local composed package SHA-256 for this focused rerun: `f2cbc885d993e047a30dea88bd077b7738a539c0ac8a6ca852da7312316238b3` (synthetic evidence only, not a release artifact);
- `live_provider_calls: 0`;
- new coverage preserves exact `0.10000000000000001`, `1.2300`, and `-4.5e-7`;
- unrelated numeric fields remain numbers;
- a non-paid-storage operation with `warehousePrice` retains legacy number parsing;
- malformed `warehousePrice: 1e` remains `PROVIDER_JSON_INVALID`.

Consumers:

- `node tests/regression/extension-core/business-scenario-coverage.mjs`: **PASS**; CAP-24 remains `REOPENED` and `platformContributionSourceReady=false`.
- `python3 tooling/checks/extension_core.py --output <task-local-output>`: **PASS**, **155 gate processes**, source + extracted package, `live_provider_calls=0`, `installed_acceptance=false`.
- `node --check packages/marketplaces/wildberries/src/adapter.js`: PASS.
- `git diff --check`: PASS.

## Evidence level

`SOURCE + PACKAGE_SYNTHETIC / LOCAL_CONTRACT`.

Not `LIVE_WB`, not `LIVE_OWNER`, not `DEPLOYMENT`, not `PRODUCTION`.

## Review history and re-review focus

Independent gpt-6-luna review of candidate `aecab801034cc44c3f33a6daec322879fba37d75` returned **REWORK_REQUIRED** with one blocking P2: paid-storage exactness could be bypassed by a valid JSON body carrying a non-JSON or missing `Content-Type`. The review also requested an explicit compatibility caveat for the deliberate number-to-string normalization. This revision addresses both findings; a fresh independent review of the successor exact SHA remains required before publication.

Re-review must specifically challenge:

1. whether the lexical scanner can mistake string contents for object properties;
2. JSON-number delimiter/escape handling and malformed-input behavior;
3. the intentionally scoped type normalization (provider number -> exact local string) for `paid_storage_download.warehousePrice`;
4. preservation of all other operation and field types;
5. absence of currency/aggregation claims.

Publication remains subject to fresh-base, independent review, exact-head CI and the normal governed publication route.
