# A04 CAP-24 — WB paid-storage exact decimal aggregation R2

## Scope and authority

Task: `A04-CAP24-PAID-STORAGE-EXACT-DECIMAL-AGGREGATION-R2-20261005`.

Initial implementation/test base: `954fd1d48cd1d88dda9ed61266d039381cbd4775`.

Before the first review candidate, `origin/main` advanced to `86d1573ea48493336d06773c77d86cee3d76e244` for the independent Start-entry recovery change. Its changed paths did not overlap this task's fixture, validator or receipt, so the exact task blobs were reconstructed there as candidate `f22ff7ef684978134e49e76b1e777ff826b7b6e2`.

That candidate received the P1 rework described below. The corrected source checkpoint is `d146147fc352667816eff9ca31ea18849e473435`. Before final candidate freeze, `origin/main` advanced again to `3654e8d5836c64c6e7bc6aeb47c56897ca594231`. A direct path comparison from the prior base to this fresh main found zero changes in all three task paths. The corrected task patch was therefore reconstructed on `3654e8d5...`. That reconstruction initially reproduced the corrected source fixture/validator blobs. Before requesting the final independent review, parent adversarial readback tightened the same fresh candidate further: exponent metadata is now parsed digit-by-digit under an explicit lexical bound without `Number()`/`parseInt()`/`parseFloat()`, and direct aggregate inputs also fail closed on non-BigInt coefficients or out-of-contract scale. The external evidence for the final candidate, not the earlier source checkpoint, is the identity authority for review/publication; all authoritative GREEN checks are rerun on those final bytes.

The predecessor `A04-CAP24-PAID-STORAGE-LOSSLESS-MONEY-BOUNDARY-R2-20261005` is strict-DONE and publishes the missing prerequisite: for `paid_storage_download`, each provider `warehousePrice` JSON-number lexeme is preserved exactly as a decimal string before ordinary JSON parsing can round it.

This task changes only the canonical CAP-24 paid-storage fixture, its source validator/calculator, and this receipt. It does not change provider requests, the WB adapter/runtime, operation mapping, marketplace transport, currency binding, platform-contribution policy, database, browser behavior, package bytes, deployment or production state.

Evidence level: **SOURCE / LOCAL_CONTRACT**. Live WB, LIVE_OWNER, installed-package, deployment and production acceptance are not claimed.

## Why R1 was superseded

The earlier decimal-normalization task was correctly blocked because a decoded ECMAScript `Number` cannot prove the provider's original decimal lexeme. Distinct inputs such as `0.1` and `0.10000000000000001` can collapse to the same binary number, so `String(number)` is not an exact-money authority.

The strict-DONE predecessor now provides the raw decimal lexeme as a string. This R2 consumes that accepted boundary directly and deliberately rejects the old numeric fallback.

## Contract

For HTTP 200 paid-storage rows:

- `warehousePrice` must be a string matching the JSON-number grammar: optional minus, canonical integer, optional fractional digits and optional decimal exponent.
- Whitespace, leading plus, malformed leading zeroes, missing integer/fraction digits, `NaN`, `Infinity`, non-string numeric values and unbounded exponent expansion fail closed.
- Parsing produces a signed `BigInt` coefficient plus an effective decimal scale from the lexeme's digits and exponent only.
- Aggregation aligns coefficients to the maximum effective input scale and performs only `BigInt` addition. No `Number`, `parseFloat`, rounding, guessed two-decimal scale or currency conversion participates.
- The aggregate is emitted as a non-exponential decimal string retaining the maximum evidenced scale.
- Input rows are not deduplicated; provider signs and recalculation rows remain intact.
- The original lossless strings remain in `storageAmounts`.
- HTTP 204 explicit no-data remains exact aggregate `"0"`.
- Currency remains unbound and platform contribution remains fail-closed on its separate component-policy/common-currency gates.

Examples:

- `7.65 + -1.25 = 6.40`
- `7.650 + -1.25 = 6.400`
- `1e-2 + 1.00E-2 = 0.0200`
- `1.20e1 + -2 = 10.0`
- `1.25 + -1.25 = 0.00`

Resource limits are explicit local fail-closed safety limits, not WB/provider money semantics:

- at most 4096 input coefficient digits / effective decimal places per lexeme;
- at most 4096 exponent-token digits; exponent magnitude is parsed digit-by-digit under the local bound and the monetary lexeme is never passed through `Number()`, `parseInt()` or `parseFloat()`;
- at most 4096 paid-storage rows per aggregate;
- after scale alignment, each non-zero coefficient must remain at most 4096 digits **before** exponentiation/multiplication is attempted;
- the running aggregate coefficient must remain at most 4096 digits, including carry growth after addition;
- the formatted non-exponential result is limited to 4100 characters.

These bounds deliberately reject otherwise grammatically valid extreme decimals when exact alignment would exceed the local aggregate budget. They are not a guessed provider scale, a rounding rule, a row limit asserted by WB, or a reason to truncate values. The implementation determines the maximum scale with an ordinary loop rather than an unbounded spread call.

## Independent review R1 rework

The first independent review of exact candidate `f22ff7ef684978134e49e76b1e777ff826b7b6e2` returned `REWORK_REQUIRED` with two P1 findings:

1. the saved evidence incorrectly reused the preserved pre-rebase patch hash `390dda0e...` as the fresh-candidate full-index binary diff hash; the actual `86d1573e..f22ff7ef` binary diff hash was `2cee35a95c51abcf1e820ec87749b861d5076a35217658353805d75fde18191b`;
2. the per-lexeme 4096 guard did not explicitly bound post-scale BigInt growth, running-sum carry growth or the number of aggregated rows, and `Math.max(...parts.map(...))` left row-count/spread complexity unbounded.

R2 rework adds the explicit aggregate bounds above and focused negative cases for cross-scale coefficient growth, carry overflow and excessive row count. The old `390dda0e...` value is retained only as historical pre-rebase patch evidence; it is not used as identity for a later fresh candidate.

## RED reproduction

Before implementation, the fixture was changed to the accepted lossless-string representation for the existing `7.65/-1.25` case while the old projector was left unchanged.

Command used the server's default Node 22.22.2 only for this negative-control reproduction:

`node tests/regression/extension-core/wb-paid-storage-contribution-field-schema-slice.mjs`

Result: expected failure. The old projector returned `PAID_STORAGE_ROW_INVALID` because it required `warehousePrice:number` instead of the now accepted lossless string. Log:

`/root/octoport-control/logs/A/a04-cap24-paid-storage-exact-decimal-aggregation-r2-20261005/RED_BASELINE.log`

The authoritative GREEN checks below use pinned product Node 24.20.0.

## GREEN validation

Pinned runtime:

`/root/.nvm/versions/node/v24.20.0/bin/node` → `v24.20.0`.

Passed:

- `wb-paid-storage-contribution-field-schema-slice.mjs`, including:
  - a valid 4096-digit scale-0 lexeme combined with `1e-4096` fails closed before oversized scale alignment;
  - addition carry that would grow the aggregate coefficient past 4096 digits fails closed;
  - 4097 rows fail closed before per-row decimal aggregation;
  - an exponent token longer than 4096 digits fails closed before exponent arithmetic/conversion;
- `business-scenario-coverage.mjs`
- `business-scenario-gold-protocol.mjs`
- fixture JSON parse
- Prettier check using the repository's already-installed formatter binary; no dependency installation
- `git diff --check`

The full business coverage remains 45 scenarios; the gold protocol remains 270 logical cards and 90 owner-pending cards. Exact paid-storage decimal arithmetic does not promote platform contribution, owner semantics or any live boundary.

The producer regression `wb-adapter.mjs` was not counted from a direct invocation: a direct `node wb-adapter.mjs` attempt failed before test execution because that harness requires its composed-runtime path in `process.argv[2]`. This was an invocation error, not a product failure. The adapter/runtime bytes are unchanged by this task, and predecessor exact candidate `954fd1d4` already has independently accepted source/extracted WB adapter coverage (27/27 on each) for the same lossless producer boundary. This task therefore does not rebuild unchanged runtime solely to repeat that accepted producer test.

## Non-claims

This result does **not** prove:

- a paid-storage response currency;
- cross-source common-currency compatibility;
- platform contribution completeness;
- net profit;
- a live WB paid-storage task lifecycle;
- installed browser behavior;
- owner semantic acceptance;
- deployment or production readiness.

Independent read-only `gpt-6-luna` review of the exact candidate is mandatory before publication.
