# M10B final AI diagnostic case selection — canonical ChatGPT Work prompt — R1

WORK_ID: `OCTOPORT_SEO_M10B_FINAL_AI_DIAGNOSTIC_CASE_SELECTION_2026-09-24_R1`

CONTINUE THE EXISTING OCTOPORT SEO PROGRAM.

THIS IS AN EXECUTION TASK.
THIS IS M10B FINAL AI DIAGNOSTIC CASE SELECTION ONLY.

THIS IS NOT A NEW PROJECT.
THIS IS NOT M10A REWORK.
THIS IS NOT AI PROVIDER EXECUTION.
THIS IS NOT M10C.
THIS IS NOT M10D.
THIS IS NOT M11 FINAL PAGE OWNERSHIP.
THIS IS NOT URL / H1 / TITLE / IA IMPLEMENTATION.

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Prompt preparation parent HEAD: `b1ae641e19a2de3f605bcf0986e118f6104f8db0`

======================================================================
0. ROADMAP / CURRENT CURSOR
======================================================================

```text
M0..M9 = ACCEPTED
M10A = ACCEPTED / FROZEN SEARCH-ONLY BASELINE
M10B = CURRENT FINAL AI DIAGNOSTIC CASE SELECTION
M10C = BLOCKED
M10D = BLOCKED
M11+ = BLOCKED
```

Goal:
select the final bounded AI-search diagnostic cases that can causally test the frozen M10A Search-only HOLD baseline.

No arbitrary case quota.
No first-N.
No representative sampling.
No provider execution.

======================================================================
1. FIRST ACTION — LIVE PREFLIGHT
======================================================================

Fetch the live remote SEO branch and record `START_HEAD`.

Read in full.

LEVEL 1:
- `docs/seo/LEVEL1/README.md`
- `docs/seo/EXECUTION_RULES.md`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md`
- `docs/seo/WORK_HANDOFF_RULE.md`
- `docs/seo/METHODOLOGY.md`
- `docs/seo/PRODUCT_TRUTH.md`

LEVEL 2:
- `docs/seo/LEVEL2/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M5_M10_SEARCH_ONLY_AND_ALICE_SEQUENCE_RULES.md`
- `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md`

Current stage authority:
- `docs/seo/M10A_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`
- `docs/seo/M10B_STEP_PREPARATION_2026-09-24_R1.md`
- `docs/seo/M10B_FINAL_AI_CASE_SELECTION_INPUT_MANIFEST_2026-09-24_R1.json`
- `docs/seo/M10B_PRE_HANDOFF_2026-09-24_R1.md`
- `docs/seo/M5_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`
- `docs/seo/FAILURE_LEDGER.md`

Frozen M10A data:
- `docs/seo/work_return/M10A_SEARCH_ONLY_PAGE_IA_BASELINE_2026-09-24_R1/M10A_CLUSTER_PAGE_IA_BASELINE.tsv`
- `docs/seo/work_return/M10A_SEARCH_ONLY_PAGE_IA_BASELINE_2026-09-24_R1/M10A_CANNIBALIZATION_BOUNDARY.tsv`
- `docs/seo/work_return/M10A_SEARCH_ONLY_PAGE_IA_BASELINE_2026-09-24_R1/M10A_EXISTING_SITE_SURFACE.tsv`

Accepted M5 data:
- `docs/seo/work_return/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER.tsv`
- `docs/seo/work_return/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1/M5_INPUT_DISPOSITION_LEDGER.tsv`

Exact current query authority:
- `docs/seo/M9_BOUNDARY_RESOLUTION_SEARCH_ANCHOR_MAP_2026-09-24_R2.tsv`

Binding identities:
```text
STEP_PREPARATION_BLOB = 8a06eff867d569bd96d42b6527886b4a6015ef84
INPUT_MANIFEST_BLOB = 0c8a200e6733e21c56221d8d22d781cd54f3f01a
PRE_HANDOFF_BLOB = 4a8a9683f5a89107460153883de861ac110b9253
M10A_ACCEPTANCE_BLOB = a0cc44f9631067f4938044fe0a4c21e6ed4898cb
M10A_CLUSTER_BASELINE_BLOB = 81a385400dffce94441525938ac4916d4db95cc2
M10A_BOUNDARY_BASELINE_BLOB = aafa9698cc1cc83751699ac45048b53d5505f96b
M10A_SITE_SURFACE_BLOB = b1805310f77263a8734260fafb00ef0c5025d44a
M5_ACCEPTANCE_BLOB = 1ba7eda6e51fef110be3847b10819ddab344e5f9
M5_HYPOTHESIS_REGISTER_BLOB = fea13f2d07c05952ac1adc68d062a9da43f4bb25
M5_INPUT_DISPOSITION_BLOB = 9f0ec02927c16046ec0d836133a5e660b8d29dbd
CURRENT_65_ANCHOR_MAP_BLOB = 32b6ec36c1707808519d7f885f511f4258f117e1
PRODUCT_TRUTH_BLOB = 6a469d5743142d3e476afa5d2cda653fd411ecb8
```

Any mismatch -> `HOLD_INPUT_IDENTITY`.

======================================================================
2. IMMUTABLE M10A SEARCH BASELINE
======================================================================

Hard accepted state:
```text
M10A_CLUSTER_ROWS = 104
M10A_SEARCH_OWNER_HOLD = 104
M10A_PAGE_ROLE_HOLD = 104
M10A_MATERIAL_BOUNDARY_ROWS = 1399
M10A_SAME_PAGE_AUTHORIZATIONS = 0
M10A_SEPARATE_PAGE_AUTHORIZATIONS = 0
CURRENT_SEARCH_ANCHORS = 65
NO_CURRENT_EXACT_SERP = 39
```

M10B may not change:
- cluster IDs;
- cluster states;
- cluster membership;
- Search owner state;
- page role state;
- existing/planned page relation;
- page-boundary state;
- current physical site surface ownership;
- M10A claims.

M10A is the baseline to be tested later, not a draft to improve.

======================================================================
3. M5 HYPOTHESIS AUTHORITY
======================================================================

Exactly 65 accepted M5 hypotheses.

Hard:
```text
M5_HYPOTHESIS_ROWS = 65/65
M5_STATUS_PROVISIONAL_ONLY = 65/65
M5_AI_PROVIDER_EVIDENCE_ROWS = 0
M5_FINAL_AI_CASE_SELECTIONS = 0
```

Every hypothesis must receive exactly one M10B disposition.

Allowed closed disposition vocabulary:
```text
SELECT_FINAL_AI_DIAGNOSTIC
COVERED_BY_SELECTED_CASE
NO_MATERIAL_M10A_DECISION_LINK
HOLD_AMBIGUOUS_M10A_LINK
NO_EXECUTABLE_DIAGNOSTIC_PROMPT
```

No silent skip.

======================================================================
4. MECHANICAL DIRECT-LINK RECONCILIATION
======================================================================

For every M5 row:
1. extract every exact `M4QR2Q[0-9]+` token from `source_evidence_refs`;
2. intersect with M10A `current_query_id` values;
3. map exact matches to M10A cluster IDs.

Independently verify:
```text
HYPOTHESES_WITH_DIRECT_CURRENT_QUERY_LINK = 43/43
HYPOTHESES_WITHOUT_DIRECT_CURRENT_QUERY_LINK = 22/22
DIRECT_HYPOTHESIS_QUERY_CLUSTER_LINK_ROWS = 164/164
DIRECT_LINKED_M10A_CLUSTERS = 19/19
UNIQUE_M10A_MATERIAL_BOUNDARIES_TOUCHED_BY_DIRECT_LINKED_CLUSTERS = 363/363
```

These counts are crosswalk QA only.
They do not preselect cases.

Direct link basis:
`DIRECT_CURRENT_QUERY_LINK`.

======================================================================
5. NON-DIRECT LINK RULE
======================================================================

For a hypothesis without direct current-query link, selection is allowed only if Work proves a defensible M10A link using all of:
- compatible task/intent scope;
- compatible marketplace scope;
- compatible product boundary;
- accepted M5 Search context that is materially relevant to the named M10A HOLD;
- no contradiction with M10A/M9 authority.

Forbidden mapping bases:
- lexical similarity alone;
- shared word `AI`, `Ozon`, `Wildberries`, `analytics`, `report` alone;
- product capability alone;
- competitor wording alone;
- generic business relevance alone.

Link basis for a defensible non-direct mapping:
`DEFENSIBLE_TASK_SCOPE_LINK`.

If not proven:
`NO_MATERIAL_M10A_DECISION_LINK` or `HOLD_AMBIGUOUS_M10A_LINK`.

======================================================================
6. MATERIAL INFORMATION-GAIN GATE
======================================================================

A final AI diagnostic case may exist only when:

```text
NAMED_M10A_CLUSTER = true
AND NAMED_FROZEN_BASELINE_HOLD = true
AND M5_UNCERTAINTY_CAUSALLY_RELEVANT = true
AND SPECIFIC_AI_OBSERVATION_CAN_CHANGE_OR_ENRICH_OR_DERISK_OR_CONFIRM_NO_CHANGE_OR_LEAVE_HOLD = true
AND EXACT_EXECUTABLE_PROMPT_FROZEN = true
AND PRODUCT_TRUTH_BOUNDARY_PRESERVED = true
AND REPEAT_VARIABILITY_PLAN_DEFINED = true
AND STOP_RULE_DEFINED = true
```

Do not select a case merely for:
- curiosity;
- competitor monitoring;
- source diversity;
- representativeness;
- hypothesis confidence;
- high boundary degree;
- cost-budget filling.

======================================================================
7. EXACT DIAGNOSTIC PROMPT
======================================================================

Prompt source classes:
```text
EXACT_CURRENT_SEARCH_QUERY
M5_COMPARISON_KEY_DIAGNOSTIC_NOT_DEMAND
M5_PROVISIONAL_QUESTION_MINIMAL_USER_FORM_DIAGNOSTIC_NOT_DEMAND
```

For `DIRECT_CURRENT_QUERY_LINK`:
- prefer `EXACT_CURRENT_SEARCH_QUERY`;
- resolve exact wording from the accepted 65-anchor map;
- prompt text must equal the accepted `exact_query_text` byte-for-byte except surrounding whitespace removal;
- this creates the strongest controlled Search-vs-AI comparison.

For a defensible non-direct mapping:
- prompt may use exact `hypothesis_comparison_key`; OR
- minimally transform `provisional_future_ai_question` into a user-facing diagnostic question;
- preserve task and marketplace scope;
- record the exact transformation basis;
- mark claim boundary: `M10B_DIAGNOSTIC_PROMPT_NOT_DEMAND_EVIDENCE`.

Do not add an Octoport product claim to the prompt unless it already exists in accepted wording and is permitted by product truth.

======================================================================
8. CASE CONSOLIDATION / DEDUPLICATION
======================================================================

One selected case may cover multiple M5 hypotheses only if all are materially equivalent on:
- exact executable prompt;
- primary affected M10A cluster;
- diagnostic uncertainty;
- expected baseline decision impact.

Do not collapse:
- Ozon vs Wildberries where marketplace specificity is material;
- report-reading vs ad-analysis;
- own-LLM integration vs generic AI-agent discovery;
- read-only analysis vs mutation/write-back task;
- materially different exact prompts.

Every `COVERED_BY_SELECTED_CASE` row must name the selected case ID and show why consolidation is lossless.

Case ID:
`M10BCASE_<first16 lowercase SHA256(exact_ai_prompt + newline + primary_cluster_id + newline + sorted source hypothesis IDs joined by newline)>`.

======================================================================
9. SELECTED CASE CONTRACT
======================================================================

Every selected case has exactly one primary M10A cluster.
Additional affected clusters are allowed through XREF.

Every selected case must record:
- case ID;
- source M5 hypothesis IDs;
- exact AI prompt;
- prompt source class/reference;
- primary M10A cluster ID;
- affected cluster IDs;
- marketplace scope;
- task/intent scope;
- frozen M10A owner/page-role state;
- concrete baseline uncertainty being tested;
- expected AI information gain;
- possible later M10D outcomes (from `CHANGE | ENRICH | DE_RISK | NO_CHANGE | HOLD`);
- exact evidence to capture in M10C;
- repeat/variability plan;
- bounded max snapshots;
- success/valid-partial/failure/unknown meanings;
- stop rule;
- M10C provider execution authorized here = false;
- claim boundary.

Do not predict which M10D outcome will occur.

======================================================================
10. REPEAT / VARIABILITY PLAN
======================================================================

Every selected case must have a bounded plan.

`max_snapshots` must be an integer 1..3.

Plan must specify:
- initial snapshot;
- mandatory vs conditional repeat;
- what source/framing difference triggers repeat;
- when variability itself is a meaningful result;
- when to stop.

M10B does not spend provider budget.
M10C may later refuse/reduce execution if current provider contract/cost/safety does not support the plan.

======================================================================
11. CASE -> CLUSTER XREF
======================================================================

Produce complete row-level case/hypothesis/cluster links.

Every selected case must have >=1 XREF row.
Every `SELECT_FINAL_AI_DIAGNOSTIC` or `COVERED_BY_SELECTED_CASE` hypothesis must appear in >=1 XREF row.

Allowed link bases:
```text
DIRECT_CURRENT_QUERY_LINK
DEFENSIBLE_TASK_SCOPE_LINK
```

No `NONE` link in selected-case XREF.

======================================================================
12. CASE -> BOUNDARY XREF
======================================================================

Link selected cases to exact M10A material boundary pair IDs when the diagnostic can causally inform that boundary.

Every boundary ID must exist in frozen M10A cannibalization authority.

A selected case may legitimately have zero boundary rows only if:
- its primary M10A cluster has material-hold degree 0;
- it still tests that cluster's frozen owner/page-role HOLD;
- this exception is explicit in QA.

Do not claim the AI case itself resolves a boundary.

======================================================================
13. REQUIRED OUTPUTS — EXACTLY 8
======================================================================

1. `M10B_SOURCE_MANIFEST.md`
2. `M10B_HYPOTHESIS_DISPOSITION.tsv`
3. `M10B_CASE_CLUSTER_XREF.tsv`
4. `M10B_CASE_BOUNDARY_XREF.tsv`
5. `M10B_FINAL_AI_DIAGNOSTIC_CASES.tsv`
6. `M10B_ADVERSARIAL_DIAGNOSTIC.tsv`
7. `M10B_QA.md`
8. `M10B_RETURN_MANIFEST.json`

Exactly these eight final files.
No scripts/caches/source copies.

### M10B_HYPOTHESIS_DISPOSITION.tsv
Exactly 65 rows.

Required columns:
```text
m5_hypothesis_id
hypothesis_comparison_key
marketplace_scope
task_or_intent_scope
direct_current_query_ids
direct_m10a_cluster_ids
direct_link_count
non_direct_candidate_cluster_ids
final_disposition
selected_case_ids
disposition_basis
expected_information_gain_summary
evidence_refs
claim_boundary
```

### M10B_CASE_CLUSTER_XREF.tsv

Required columns:
```text
case_id
m5_hypothesis_id
cluster_id
semantic_identity_id
current_query_id
link_basis
link_evidence
baseline_owner_state
baseline_page_role_state
current_material_hold_degree
diagnostic_relevance
evidence_refs
```

### M10B_CASE_BOUNDARY_XREF.tsv

Required columns:
```text
case_id
pair_id
cluster_id_a
cluster_id_b
terminal_search_only_disposition
m10a_boundary_state
diagnostic_relevance
expected_information_gain
evidence_refs
claim_boundary
```

### M10B_FINAL_AI_DIAGNOSTIC_CASES.tsv

Required columns:
```text
case_id
source_m5_hypothesis_ids
exact_ai_prompt
prompt_source_class
prompt_source_ref
primary_cluster_id
affected_cluster_ids
marketplace_scope
task_or_intent_scope
frozen_m10a_owner_state
frozen_m10a_page_role_state
frozen_m10a_boundary_context
current_uncertainty
expected_ai_information_gain
possible_m10d_outcomes
evidence_capture_requirements
repeat_plan
max_snapshots
variability_trigger
success_condition
valid_partial_condition
failure_condition
unknown_condition
stop_rule
m10c_execution_authorized_here
claim_boundary
```

======================================================================
14. ADVERSARIAL QA
======================================================================

Independently test at least:
1. 65/65 hypothesis accounting;
2. exact 43/22 direct-link hypothesis partition;
3. exact 164 direct hypothesis-query-cluster links;
4. exact 19 directly linked M10A clusters;
5. exact 363 material boundaries touched by those 19 clusters;
6. direct prompt byte-equality to accepted exact Search query;
7. non-direct mapping is not lexical-only;
8. non-direct prompt uses only allowed M5 source fields;
9. no hypothesis selected solely by confidence/competitor recurrence;
10. no arbitrary selection quota/first-N;
11. no duplicate case with same prompt+primary cluster+uncertainty;
12. no marketplace-specific uncertainty collapsed incorrectly;
13. no read-only/write-back boundary collapse;
14. every selected case has specific M10A decision link;
15. every selected/covered hypothesis has XREF;
16. every boundary XREF points to exact frozen pair ID;
17. max_snapshots bounded 1..3;
18. no AI result or M10D outcome invented;
19. M10A baseline unchanged;
20. provider calls = 0.

Systematic defect:
```text
ROOT CAUSE
-> AFFECTED 65-HYPOTHESIS / XREF UNIVERSE
-> FIX PRODUCER
-> RERUN COMPLETE SELECTION
-> REGRESSION
```

No example-only patch.

======================================================================
15. HARD GATES
======================================================================

```text
M5_HYPOTHESIS_ROWS = 65/65
HYPOTHESIS_DISPOSITION_ROWS = 65/65
HYPOTHESIS_ID_SET_MATCH = true
HYPOTHESIS_MULTI_DISPOSITION = 0

HYPOTHESES_WITH_DIRECT_CURRENT_QUERY_LINK = 43/43
HYPOTHESES_WITHOUT_DIRECT_CURRENT_QUERY_LINK = 22/22
DIRECT_HYPOTHESIS_QUERY_CLUSTER_LINK_ROWS = 164/164
DIRECT_LINKED_M10A_CLUSTERS = 19/19
DIRECT_LINKED_MATERIAL_BOUNDARIES = 363/363

SELECTED_CASE_IDS_UNIQUE = true
SELECTED_CASE_WITHOUT_CLUSTER_XREF = 0
SELECTED_OR_COVERED_HYPOTHESIS_WITHOUT_CLUSTER_XREF = 0
INVALID_BOUNDARY_XREF = 0
DIRECT_PROMPT_QUERY_TEXT_MISMATCH = 0
UNAUTHORIZED_PROMPT_REWRITE = 0
CASE_DUPLICATE_PROMPT_CLUSTER_UNCERTAINTY = 0
MAX_SNAPSHOTS_OUT_OF_RANGE = 0

M10A_BASELINE_MUTATIONS = 0
M9_CLUSTER_MUTATIONS = 0
M5_HYPOTHESIS_MUTATIONS = 0

AI_PROVIDER_CALLS = 0
YANDEX_AI_EXECUTIONS = 0
ALICE_EXECUTIONS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0

OPEN_CRITICAL_DEFECTS = 0
```

Final selected case count is not predeclared.

======================================================================
16. STOP CONDITIONS
======================================================================

```text
HOLD_INPUT_IDENTITY
HOLD_M10A_BASELINE_DRIFT
HOLD_M5_HYPOTHESIS_ACCOUNTING
HOLD_DIRECT_LINK_RECONCILIATION
HOLD_PROMPT_AUTHORITY
HOLD_CASE_XREF_ACCOUNTING
HOLD_UNAUTHORIZED_AI_EXECUTION
```

Do not solve a stop by inventing a prompt, page owner, or AI result.

======================================================================
17. BEFORE RETURN
======================================================================

Re-fetch remote branch and record `END_OBSERVED_HEAD`.

If only M10B prompt/progress/staging authority changed while frozen inputs remain identical:
`AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED`.

If frozen input changed: stop.

======================================================================
18. PUBLICATION
======================================================================

Create one downloadable ZIP containing exactly the 8 final files.
Work must not write GitHub.

Owner staging:
`docs/seo/work_return/M10B_FINAL_AI_DIAGNOSTIC_CASE_SELECTION_2026-09-24_R1/`

======================================================================
19. DOWNSTREAM STOP
======================================================================

DO NOT CONTINUE TO M10C.

Main Chat must independently audit and explicitly accept M10B.

Only then may Main Chat prepare current provider/Bridge/cost preflight and bounded M10C execution.

======================================================================
20. FINAL RESPONSE FORMAT
======================================================================

Return:
```text
WORK_ID = OCTOPORT_SEO_M10B_FINAL_AI_DIAGNOSTIC_CASE_SELECTION_2026-09-24_R1
START_HEAD =
END_OBSERVED_HEAD =
AUTHORITY_DRIFT_STATUS =
VERDICT =

M5_HYPOTHESIS_ROWS = 65/65
HYPOTHESIS_DISPOSITION_ROWS = 65/65

HYPOTHESES_WITH_DIRECT_CURRENT_QUERY_LINK = 43/43
HYPOTHESES_WITHOUT_DIRECT_CURRENT_QUERY_LINK = 22/22
DIRECT_HYPOTHESIS_QUERY_CLUSTER_LINK_ROWS = 164/164
DIRECT_LINKED_M10A_CLUSTERS = 19/19
DIRECT_LINKED_MATERIAL_BOUNDARIES = 363/363

SELECT_FINAL_AI_DIAGNOSTIC =
COVERED_BY_SELECTED_CASE =
NO_MATERIAL_M10A_DECISION_LINK =
HOLD_AMBIGUOUS_M10A_LINK =
NO_EXECUTABLE_DIAGNOSTIC_PROMPT =

FINAL_AI_DIAGNOSTIC_CASES =
CASE_CLUSTER_XREF_ROWS =
CASE_BOUNDARY_XREF_ROWS =
SELECTED_CASES_WITH_DIRECT_QUERY_PROMPT =
SELECTED_CASES_WITH_M5_DIAGNOSTIC_PROMPT =

DIRECT_PROMPT_QUERY_TEXT_MISMATCH = 0
INVALID_BOUNDARY_XREF = 0
MAX_SNAPSHOTS_OUT_OF_RANGE = 0

M10C_GATE_RECOMMENDATION =

AI_PROVIDER_CALLS = 0
YANDEX_AI_EXECUTIONS = 0
ALICE_EXECUTIONS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0

OPEN_CRITICAL_DEFECTS =
FILES_IN_ZIP = 8
ZIP_SHA256 =
```

Provide one real downloadable ZIP.
Do not continue to M10C.
