# C02 B07 full-suite clock-fixture repair — 2026-09-27

Status: **INTEGRATION REPAIR / SOURCE TEST ONLY / NO PRODUCTION RUNTIME CHANGE**

## Boundary

C integrated exact B candidate `d6d8c4322458f5f4e3bc7b7158e87094a5cda65c` on accepted main `3805f8b23655668556e1f1ef43d4ab3cef837413`, producing C candidate `df84a698f701886d7221b5f4e95a071a0665c977`.

The changed B product/server paths passed the candidate-focused verification on the merged C tree:
- STORE1 planner + admin route units: 89/89 PASS;
- admin-commercial, DB and API typechecks: PASS;
- P5.4 + P5.5 with the canonical integration Vitest config: 244/244 PASS;
- P6.4 + STORE1 whole-sequence with the canonical integration Vitest config: 121/121 PASS.

GitHub Server CI run `36300102372` then exposed an untested historical-fixture boundary in the full integration suite: only `tests/integration/server/p5-7-p5-final-acceptance.integration.test.ts` failed, 10 tests. The new post-lock repositories correctly sample processing time through their injected `now`, but P5.7 still constructed those repositories without the deterministic test clock while its fixtures intentionally set `clock = Date.now() + 60s`. This made processing timestamps precede fixture `verifiedAt` and caused fail-closed `RETRYABLE` / `billing_events_processed_after_verified` outcomes.

## Repair

C took only the blocked P5.7 test-fixture slice because B had no active executor and was waiting on the separate future subscription-contract dependency. No DB/schema/migration/server implementation was edited.

All P5.7 constructions of:
- `createP5BillingEventRepository`;
- `createP5ReconciliationRepository`

now inject the existing fixture clock with `{ now: () => clock }`. This preserves the production post-lock behavior while making historical acceptance fixtures deterministic, matching the already accepted P5.4/P5.5 test-clock pattern.

## Verification

Command shape:
`control.py C heavy --db --profile integration -- ... vitest run --config tests/integration/server/vitest.config.ts tests/integration/server/p5-7-p5-final-acceptance.integration.test.ts`

Result:
- file: 1/1 PASS;
- tests: 80/80 PASS;
- supervisor unit: `octoport-test-c-ef5d68c9ec3f4865a9e4cea9a32445bf.service`;
- command exit: 0;
- no live DB or service was used.

Two earlier C diagnostic attempts omitted the canonical integration Vitest config and therefore ran DB-resetting files concurrently. Those failures are orchestration evidence only and are not product acceptance or product defects.

## Remaining gate

The repaired C candidate must receive all five required GitHub workflows on its exact new HEAD before `ready-main`. The failed exact `df84a698...` is not accepted and must not be pushed to main.
