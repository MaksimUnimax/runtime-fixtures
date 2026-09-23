# S2-L8 Alice E2E Flake Closure — 2026-09-19 R2

Work ID: `S2_L8_ALICE_E2E_FLAKE_FINAL_ACCEPTANCE_CLOSURE_2026-09-19_R2`

Status: `FINAL_ACCEPTANCE_CANDIDATE` — pending architect final acceptance.

This receipt closes the single Alice failure recorded in the selected S2-L8
server E2E run. It preserves the initial failure rather than rewriting it as
green.

## A. Preflight

- Candidate at task start: `65fa55ef90da20d118e360e701a5beefb0972cbf`.
- Candidate tree at task start: `6f62172dbd85a5a3c24959510f62c628926afc62`.
- Reported parent: `cbe3a294467cd1c44790aa5bbf07e4f55d9dacb5`.
- Accepted S2-L7 ancestor: `90ee56a8c8d56c8eda196e23b5fb57ab127a27b8`, verified as an ancestor.
- Branch: `feature/stream2-l8-final-acceptance-2026-09-19`.
- `origin/main`: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`.
- Integration ref `origin/integration/i1-c1-srv5-2026-09-16`: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- PR #9 head: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`; merge ref: `ccd6fd504f8e1d572e3e2c7eefce33884186e9f2`.
- Toolchain: Node `v24.20.0`, pnpm `10.34.5`, Playwright `1.62.1`.
- Browser: repository Chromium, Google Chrome for Testing `151.0.7922.34`.
- Repetition isolation: one Playwright worker, `--retries=0`, no concurrent integration or Playwright suite, no live-provider probes, and no authenticated session. Full selected E2E used a fresh task-owned PostgreSQL 18 fixture on loopback/tmpfs; it was removed after run 5.
- Existing unrelated worktrees and owner processes were preserved. No unrelated process was killed.

## B. Initial failure identity

The retained R1 failure was:

- File: `tests/e2e/server/health-alice-h3.spec.ts`.
- Test: `ALICE_H3_NONLIVE_CURRENT_STREAM2_CANDIDATE › one-shot and post-send boundaries › RESPONSE_REPLACED never retries`.
- Initial selected server E2E: `125/126 PASS`; this was the one failure.
- Isolated single rerun: `1/1 PASS`.
- Fixture: synthetic Alice `RESPONSE_REPLACED`.
- Failure boundary: H3 `OBSERVE_COMPLETION`, after Send and response observation, during the response-node identity/generation check.
- Expected: `outcome=FAIL`, `failureCode=COMPLETION_OBSERVATION_FAILED`, `failureStep=OBSERVE_COMPLETION`.
- Actual initial failure: `outcome=PASS`.
- Approximate observed boundary timing: the response is inserted at 50 ms; the replacement was scheduled at 40 ms, racing the strategy's response ElementHandle capture. The normal bounded completion/cleanup path completed in approximately 0.8–1.2 s for the false PASS signature.
- Browser/page lifecycle was healthy: no launch, navigation, page replacement, route/history corroboration, composer detection, fixture-server response, or teardown failure was observed.

The precise failure was therefore a synthetic DOM replacement occurring before
the fixture's response handle was captured, allowing the replacement clone to
be captured as if it were the original response. It was not a generic Alice
timeout and it did not show a production monitoring failure.

## C. Historical comparison

This is not the historical AD16–18 defect. AD16–18 was a dedicated-session
filesystem replacement/read and scheduler race, corrected by separating the
cases and making symlink replacement synchronous. The current failure used the
browser H3 fixture's DOM response replacement path and did not use that
filesystem loader path. Focused AD18 and dedicated-session stability cases
remained green.

Classification before correction: `FIXTURE_RACE`.

## D. Repetition matrix

All individual tests ran without retries.

### Pre-correction exact target

The uncorrected exact test was run 50 times, single worker:

- `31 passed, 19 failed`.
- First failing repetition: 1.
- 18 failures had the original false-PASS signature: expected
  `COMPLETION_OBSERVATION_FAILED`/`OBSERVE_COMPLETION`, received `PASS`.
- One distinct failure occurred at repetition 35: `BUSY_TIMEOUT` at
  `OBSERVE_BUSY` instead of the expected `COMPLETION_OBSERVATION_FAILED`.

This reproduced the original failure deterministically enough to establish a
fixture race and stopped the non-correction matrix at the permitted point.

### Post-correction exact target

- `RESPONSE_REPLACED never retries`, 30 repetitions: `30 passed, 0 failed`.

### Containing Alice file/logical group

- Alice file/group, 30 repetitions: `720 passed, 0 failed, 0 skipped`.
- This is 24 tests × 30 repetitions, single worker, no retries; duration was
  20.0 minutes.
- The earlier correction-path group run was `479 passed, 1 failed` across 480
  executions. Its sole failure was the separate `EMPTY_RESPONSE does not
  satisfy completion/Copy ownership` case receiving `BUSY_TIMEOUT` instead of
  `COMPLETION_TIMEOUT`.
- That alternate case was isolated separately for 20 repetitions:
  `20 passed, 0 failed`. It did not recur in the 30-repetition group run or in
  the complete selected server E2E runs. It is retained as a
  `PRE_EXISTING_UNRELATED_FLAKE`/browser-scheduling outlier, not attributed to
  the RESPONSE_REPLACED correction.

### Alice E2E sub-suite

- Alice target/group correction-path bound, 20 repetitions: `479 passed,
  1 failed` only because of the alternate EMPTY_RESPONSE outlier above; the
  corrected RESPONSE_REPLACED case passed on every occurrence.
- Alternate EMPTY_RESPONSE exact test, 20 repetitions: `20 passed, 0 failed`.
- The full containing-group bound subsequently passed `720/720`.

### Full selected server E2E

The selected scope was the five health E2E files plus
`tests/e2e/server/admin-safety.spec.ts`, 126 tests per execution. Runs were
complete and sequential:

| Run | Files | Tests | Passed | Failed | Skipped | Duration |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 6 | 126 | 126 | 0 | 0 | 4.6m |
| 2 | 6 | 126 | 126 | 0 | 0 | 4.3m |
| 3 | 6 | 126 | 126 | 0 | 0 | 4.5m |
| 4 | 6 | 126 | 126 | 0 | 0 | 4.5m |
| 5 | 6 | 126 | 126 | 0 | 0 | 4.3m |

R2 full selected E2E result: `5/5 complete executions`, `630/630 passed`,
`0 failed`, `0 skipped`.

## E. Root cause

The original selected-run failure was a deterministic test-fixture timing
race: the `RESPONSE_REPLACED` fixture scheduled DOM replacement at 40 ms while
the response was inserted at 50 ms. Depending on browser scheduling, the H3
strategy captured either the original response node (correctly detecting
replacement and failing closed) or the replacement clone (incorrectly treating
it as the response it had just observed). This was not an Alice authority
failure, a route failure, a real provider failure, or a product monitoring
defect.

The separate EMPTY_RESPONSE/BUSY_TIMEOUT observation is classified as a
pre-existing unrelated browser-scheduling flake. It was not hidden: it was
reported, isolated 20/20, and did not recur in the full 30-repetition Alice
group or 5 complete selected runs.

## F. Correction

One bounded test-only fixture correction was applied in
`tests/e2e/server/support/health-alice-h3-fixture.ts`:

- `RESPONSE_REPLACED` replacement moved from 40 ms to 150 ms, after response
  insertion and handle association can occur.
- Only that variant's synthetic idle transition moved from 100 ms to 500 ms,
  keeping the replacement as the exercised completion boundary.

The correction does not add retries, weaken assertions, swallow timeout errors,
skip tests, multiply global timeouts, or alter production runtime behavior. The
pre-correction 50-run red reproduction is retained in this receipt.

Alice authority remains intact: official synthetic Alice origin and route,
Alice-specific strategy, active-history corroboration, no ChatGPT selector
reuse, no arbitrary conversation fallback, and no session material.

## G. Regression and static gates

- Focused Alice/Health runner tests: 4 files, `93/93 passed`, including Alice
  contracts/profile, dedicated-session capability, AD18 replacement stability,
  and frozen Alice snapshot cases.
- Existing accepted R1 gates retained because no production health or driver
  source changed: Health `124/124`, health runner `302/302`, no-session `66/66`,
  and the accepted L5B/AD16–18 baseline.
- Full selected server E2E: `630/630 passed` across 5 complete runs.
- Typecheck: PASS.
- Build: PASS for API, worker, health-runner, portal, and admin.
- Lint and bridge guard: PASS.
- Format, including the changed fixture: PASS.
- Documentation check: PASS.
- `git diff --check`: PASS.
- Integration rerun: not required; no DB/server/product source changed.

## H. Privacy and security

Diagnostics were structural only: test step/state, synthetic fixture variant,
typed outcome/failure code, route/lifecycle state, elapsed duration, and
synthetic send/prompt counters. No cookies, storage state, tokens, auth
headers, private content, real conversation IDs, or session handles were
logged or retained. Authenticated Send count remains `0`.

## I. Stream-1 boundary

No Stream-1 file or product runtime was changed. No overlap or
`OWNED_BY_PARALLEL_STREAM_1` finding arose from this closure. Existing
ownership remains: product-runtime enforcement of Health recommendations is
owned by parallel Stream 1.

## J. Git

- Correction commit: `1c36c67` (`test: stabilize Alice response replacement fixture`).
- Receipt commit: created after this correction commit; exact final HEAD/tree
  is recorded in the terminal handoff.
- Parent/ancestry remains based on the accepted candidate; no rebase, force
  push, main merge, or PR #9 mutation was performed.
- Normal remote publication/readback is environment-dependent and is recorded
  in the final deferred ledger if credentials are unavailable.

## K. Deferred ledger

Carry-forward factual items only:

`ENVIRONMENT_DEFERRED`

- Remote Stream-2 publication/readback if credentials are unavailable.
- No provisioned technical LLM sessions.
- Ozon/WB S2-A1 public-document protection.

`OWNED_BY_PARALLEL_STREAM_1`

- Product-runtime enforcement of Health recommendations.

## L. Verdict

`FINAL_ACCEPTANCE_CANDIDATE`.

The initial R1 `125/126` result remains part of the record. The failure was
reproduced as a fixture race, corrected at the fixture's timing boundary, and
closed by exact target `30/30`, containing Alice group `720/720`, focused
Alice regressions `93/93`, and full selected server E2E `5/5` complete runs.

## M. S2-L8 final readiness

Is the LLM Health line ready for architect FINAL ACCEPTANCE?

**YES — pending architect decision.**

Exact E2E disposition: `FIXTURE_RACE`, corrected in the test-only
`RESPONSE_REPLACED` fixture. The separate EMPTY_RESPONSE/BUSY_TIMEOUT event was
an isolated unrelated browser-scheduling outlier and did not recur in the
required closure runs; it is not a product defect finding.

## N. Next

Recommend architect final acceptance of the LLM Health line. After that
decision, Stream 2 may resume S2-A1 API-watch. API-watch was not started by
this task.
