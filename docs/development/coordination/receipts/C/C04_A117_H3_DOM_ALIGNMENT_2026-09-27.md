# C04 ChatGPT H3 DOM alignment with A117 — 2026-09-27

Status: **SOURCE + SYNTHETIC CHROMIUM PASS / NOT LIVE AUTHENTICATED H3**

Reviewed implementation candidate: `e6797824ab6eb8ab6328814e1a3aa2cc346e81e2`.
C integration merge: `dec098af14027b9d0b1b9d740221c178f9cc7d26`.
Base/main safety boundary: `466f50cb85680e33c0f36ec58bb5a9884d28725c`.

Standard and Work H3 now consume one bounded ChatGPT DOM ownership helper aligned to accepted A117 semantics: current `data-message-role=assistant`, legacy assistant markers, exact-one inferred Response-actions root, DOM order, user-contamination rejection, plain `code`, fenced/code-editor surfaces, and Copy/Copy code/localized/data-state controls.

Response-level Copy controls are excluded before positive code-Copy recognition. Native Copy is accepted only when one actionable Copy owns the single canonical code surface containing the packaged Health token. A response-level Copy cannot claim a sibling plain code surface.

The first browser regression exposed and fixed one fail-closed bug: a structural `data-message-role=user` root could enter the inferred-assistant path because self-user was not excluded. The corrected selector rejects self/ancestor/descendant user contamination and two Response-actions ambiguity.

Final supervised browser gate `octoport-test-c-1847e38855bf4414a8c63f923ef16d15.service`: synthetic Chromium helper/profile cases 10/10 PASS, health-runner typecheck PASS, Prettier PASS, ESLint PASS, exit 0, peak 483 MiB, cleanup verified.

This does not configure a dedicated technical session, bootstrap authenticated schedules, invoke a live ChatGPT prompt, persist authenticated H3 evidence, or claim owner-authenticated/Opera/store acceptance. Those remain separate C04/runtime gates.

## R6 Server-CI browser regression closure

Exact fix commit: `b72993f12a3655e45e9eda879925b96fd1bbc1be`.

The first exact `1d3551ca` branch run passed four workflows but Server CI failed only at `pnpm test:e2e`: 16 positive Standard/Work H3 cases reached the bridge-validation boundary and returned FAIL. A safe local diagnostic proved the physical Send count remained exactly one and isolated the defect to `chatGPTOwnedNativeCopyObservation()`: nested helper functions inside Playwright `locator.evaluate()` were transformed with an unavailable browser-side `__name` helper.

The fix rewrites that browser callback as self-contained imperative code with no captured/transformed helper functions while preserving A117 ownership: response-actions Copy is excluded first; a code-local Copy must own exactly one canonical code surface containing the packaged Health token. The Standard `COPY_MISSING` negative fixture was also corrected so both its label and visible text are genuinely non-Copy; visible text `Copy` is intentionally valid under accepted A117 text-only semantics.

Validation:
- full Standard + Work H3 Playwright matrix: **79/79 PASS**, supervisor `octoport-test-c-109fe3115a4d45678455ecbdc1e4c226.service`, exit 0, peak 1028 MiB, cleanup verified;
- helper/profile Vitest: **10/10 PASS**;
- health-runner typecheck + build PASS under `octoport-test-c-7286e0d3731a4b67aa77250ea2d91463.service`, exit 0, peak 450 MiB, cleanup verified;
- Prettier, ESLint and `git diff --check` PASS.

The failed `1d3551ca` Server CI run is superseded by this correction and must not be treated as an accepted release boundary.
