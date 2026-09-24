# Octoport SEO — M10B final AI diagnostic case selection — STEP PREPARATION — 2026-09-24 R1

Status: **PREPARATION COMPLETE / WORK REQUIRED / NO AI PROVIDER EXECUTION**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation parent HEAD: `83a780759915d3295e00c25ea450a188629e9afb`

## 1. Roadmap cursor

```text
M0..M9 = ACCEPTED
M10A SEARCH-ONLY PAGE/IA BASELINE = ACCEPTED / FROZEN
M10B = CURRENT PREPARATION
M10C AI EVIDENCE ACQUISITION = BLOCKED
M10D RECONCILIATION = BLOCKED
M11+ = BLOCKED
```

M10B purpose: select final bounded AI-search diagnostic cases only where a future AI observation can materially test, enrich, de-risk, confirm no change, or leave HOLD for the frozen M10A Search-only baseline.

M10B does not acquire AI evidence.

## 2. Governing method

Primary authority:
- `docs/seo/LEVEL2/M5_M10_SEARCH_ONLY_AND_ALICE_SEQUENCE_RULES.md`;
- `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md`;
- `docs/seo/WORK_HANDOFF_RULE.md`.

Required causal order:
```text
FROZEN M10A SEARCH BASELINE
+ ACCEPTED M5 PROVISIONAL HYPOTHESES
-> M10B FINAL DIAGNOSTIC CASE SELECTION
-> M10C GOVERNED AI EVIDENCE
-> M10D CAUSAL DELTA
```

M10B must not retroactively alter M10A.

## 3. Fresh official Yandex method check — 2026-09-24

Official current sources checked:

1. Search with Yandex AI:
https://yandex.com/support/webmaster/en/yandex-ai

Current supported method facts:
- Yandex AI can generate concise answers to user queries;
- it searches for relevant information, analyzes sources and combines findings;
- answers include references to original sources except the documented math exception;
- Yandex AI answers are generated from pages indexed by Yandex;
- source/answer composition is therefore an observation layer distinct from the frozen ordinary-Search baseline.

2. Managing groups of search queries:
https://www.yandex.com/support/webmaster/en/service/search-queries

3. Search query monitoring:
https://www.yandex.com/support/webmaster/en/service/popular-queries

Project application:
- ordinary Search query->URL behavior remains the immutable M10A baseline;
- M10B cases must define what AI answer framing/source composition would be observed and compared;
- cited URLs/source roles must be captured in M10C;
- AI evidence may produce only a later causal delta through M10D.

```text
FRESH_METHOD_RESEARCH = PASS
SEARCH_BASELINE_INDEPENDENCE_REQUIRED = true
AI_SOURCE_PROVENANCE_REQUIRED = true
AI_RESULT_VARIABILITY_PLAN_REQUIRED = true
```

## 4. Frozen M10A baseline

Accepted Main Chat authority:
`docs/seo/M10A_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`.

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

This baseline is immutable in M10B.

## 5. Accepted M5 hypothesis authority

Accepted hypothesis register:
`docs/seo/work_return/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER.tsv`.

```text
M5_HYPOTHESIS_ROWS = 65
STATUS = PROVISIONAL_HYPOTHESIS_ONLY_NO_AI_PROVIDER_EVIDENCE for 65/65
AI_PROVIDER_EVIDENCE_ROWS = 0
FINAL_AI_CASE_SELECTIONS = 0
```

M5 hypotheses are candidates, not automatically selected M10B cases.

## 6. Mechanical M5 -> M10A direct-link baseline

Main Chat independently extracted all `M4QR2Q...` references from the 65 M5 rows and intersected them with `current_query_id` in the accepted M10A baseline.

```text
M5_HYPOTHESES = 65
HYPOTHESES_WITH_DIRECT_CURRENT_QUERY_LINK = 43
HYPOTHESES_WITHOUT_DIRECT_CURRENT_QUERY_LINK = 22
DIRECT_HYPOTHESIS_QUERY_CLUSTER_LINK_ROWS = 164
DIRECT_LINKED_M10A_CLUSTERS = 19
UNIQUE_M10A_MATERIAL_BOUNDARIES_TOUCHED_BY_DIRECT_LINKED_CLUSTERS = 363
```

These are mechanical crosswalk facts only, not final case selection.

A direct link means an accepted M4Q query ID cited by the M5 hypothesis exactly equals the M10A cluster's current_query_id.

## 7. Case-selection principle

No arbitrary case quota.
No representative first-N.
No ranking score that chooses cases merely to fit a budget.

Every 65 M5 hypotheses must receive one terminal M10B disposition.

Allowed dispositions:
```text
SELECT_FINAL_AI_DIAGNOSTIC
COVERED_BY_SELECTED_CASE
NO_MATERIAL_M10A_DECISION_LINK
HOLD_AMBIGUOUS_M10A_LINK
NO_EXECUTABLE_DIAGNOSTIC_PROMPT
```

A final diagnostic case is allowed only when all are true:
1. a concrete M10A cluster and/or material boundary is named;
2. the frozen baseline state being tested is named;
3. the M5 uncertainty is causally relevant to that baseline HOLD;
4. expected information gain is specific and not generic curiosity;
5. an exact executable diagnostic prompt can be frozen without claiming demand;
6. product-truth boundaries are preserved;
7. repeat/variability plan and stop rule are explicit.

## 8. Linking rules

Preferred link:
`DIRECT_CURRENT_QUERY_LINK`.

For the 22 hypotheses without a direct current-query link, Work may consider a non-direct link only when it can prove all of:
- task/intent scope matches a named M10A cluster job/intent;
- marketplace scope is compatible;
- product boundary is compatible;
- accepted M5 Search context is relevant to the named M10A HOLD;
- mapping is not lexical-only and not product-capability-only.

Otherwise use `NO_MATERIAL_M10A_DECISION_LINK` or `HOLD_AMBIGUOUS_M10A_LINK`.

Non-direct semantic mapping must never become a new Search query, demand fact, cluster merge/split, or page owner.

## 9. Exact diagnostic prompt rule

For a case with `DIRECT_CURRENT_QUERY_LINK`, prefer the exact current Search query wording from the accepted 65-anchor map as the `exact_ai_prompt`.

This creates a controlled Search-vs-AI comparison for the same wording.

For a defensible non-direct case, an executable prompt may come only from accepted M5 fields:
- `hypothesis_comparison_key`, or
- a minimally transformed user-facing form of `provisional_future_ai_question`.

Any transformed prompt must preserve task/scope and be explicitly marked `M10B_DIAGNOSTIC_PROMPT_NOT_DEMAND_EVIDENCE`.

No product claim may be inserted into the prompt unless already in accepted source wording/product truth.

## 10. Case consolidation / deduplication

Multiple M5 hypotheses may be covered by one selected case only if all of these are identical or materially equivalent:
- exact executable prompt;
- affected M10A cluster;
- diagnostic uncertainty;
- expected M10D decision impact.

Do not collapse marketplace-specific or materially different task uncertainties merely to reduce provider calls.

Every covered hypothesis keeps explicit lineage to the selected case.

## 11. Repeat / variability plan

Every selected case must define:
- initial snapshot requirement;
- whether an independent repeat is mandatory or conditional;
- what observed source/framing variance triggers a repeat;
- maximum bounded snapshot count;
- terminal stop rule for SUCCESS / VALID_PARTIAL / FAILURE / UNKNOWN.

M10B does not execute those snapshots.

Provider/Bridge contract and cost are checked later in M10C before any call.

## 12. Work trigger

Work is required because final selection needs a complete crosswalk among:
- 65 M5 hypotheses;
- 104 M10A cluster baseline rows;
- 1,399 M10A material boundary rows;
- current 65-anchor exact-query map;
- product truth;
- complete hypothesis/case/boundary lineage.

No sampling.

`WORK_TRIGGER_DECISION = WORK_REQUIRED`.

## 13. Required outputs — exactly 8

1. `M10B_SOURCE_MANIFEST.md`
2. `M10B_HYPOTHESIS_DISPOSITION.tsv`
3. `M10B_CASE_CLUSTER_XREF.tsv`
4. `M10B_CASE_BOUNDARY_XREF.tsv`
5. `M10B_FINAL_AI_DIAGNOSTIC_CASES.tsv`
6. `M10B_ADVERSARIAL_DIAGNOSTIC.tsv`
7. `M10B_QA.md`
8. `M10B_RETURN_MANIFEST.json`

## 14. Hard boundaries

```text
M10A_BASELINE_MUTATIONS = 0
M9_CLUSTER_MUTATIONS = 0
M5_HYPOTHESIS_ROWS_ACCOUNTED = 65/65
AI_PROVIDER_CALLS = 0
YANDEX_AI_EXECUTIONS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0
```

Main Chat must independently accept M10B before M10C can be prepared.
