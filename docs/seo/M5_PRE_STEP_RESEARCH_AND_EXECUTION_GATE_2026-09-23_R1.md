# Octoport SEO — M5 AI diagnostic hypothesis register pre-step research and execution gate R1

Date: 2026-09-23
Status: **PREPARED / WORK REQUIRED / NO AI PROVIDER ACQUISITION**
WORK_ID: `OCTOPORT_SEO_M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1`

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation base HEAD: `a5ed79725283c2791b51bbfe056623a2e5352245`

## 1. Current roadmap authority

M5 is the stage immediately after accepted M4 and before M6.

Current binding rule:

`docs/seo/LEVEL2/M5_M10_SEARCH_ONLY_AND_ALICE_SEQUENCE_RULES.md`

Git blob:
`2c63e4228f9cc6f2d26555fcb02d445baafb1000`

Binding sequence:

```text
M4 SEARCH EVIDENCE
-> M5 PROVISIONAL AI DIAGNOSTIC HYPOTHESIS REGISTER
-> M6 SEARCH-SIDE GAP CLOSURE + M3 CONTROL PATCH
-> M7 SEARCH-SIDE FREEZE
-> M8/M9 SEARCH-ONLY SEMANTICS/CLUSTERING
-> M10A SEARCH-ONLY PAGE/IA BASELINE
-> M10B FINAL AI CASE SELECTION
-> M10C ALICE EVIDENCE
-> M10D SEARCH-vs-AI RECONCILIATION
```

M5 is hypothesis preparation only.

## 2. Fresh external method check

Official Yandex documentation was refreshed on 2026-09-23.

Official sources:

- https://yandex.ru/support/webmaster/en/alice
- https://yandex.ru/support/webmaster/ru/service/alice-answers

Current relevant facts:

- Search with Alice finds query-matching content, analyzes it and generates an answer with source links.
- Search with Alice results are generated from pages indexed by Yandex.
- Yandex Webmaster Alice visibility is measured on queries where the site already has sufficient Search visibility.
- Webmaster Alice visibility data covers a recent bounded period and is refreshed periodically.
- Alice answers and their source composition may vary over time.

Project consequence:

```text
SEARCH_BASELINE_FIRST = REQUIRED
M5_ALICE_PROVIDER_CALLS = 0
M5_CURRENT_ALICE_EVIDENCE = 0
M5_FINAL_AI_CASE_SELECTION = FORBIDDEN
```

M5 records future diagnostic hypotheses only.

## 3. Current accepted M4 authority

Current M4 authority is additive:

1. accepted M4C R1;
2. accepted M4Q R2 current known-query top-100 visibility overlay;
3. accepted 59-URL targeted current M4C overlay.

Required current acceptances:

- `docs/seo/serp/competitors/M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md`
  blob `8b8f075052f03511e6d0b831a3688e65da488f7d`

- `docs/seo/serp/competitors/M4Q_R2_PASS_B_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`
  blob `fee2919f871846144f2f14abe86e7c2eb7b2e035`

- `docs/seo/serp/competitors/M4Q_R2_TARGETED_M4C_RECHECK_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`
  blob `a9738377589633c07396159ee02a688810debc57`

Open bounded limitations remain:
- 74 sibling-host identity rows from Pass B remain unassigned;
- 12 exact target URLs have terminal current access holds;
- arbitrary domain->unknown-query reverse-index recall remains unproven.

These limitations do not block provisional M5 hypotheses.

## 4. Primary M5 inputs

### Existing accepted M4C hypothesis inputs

`docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_M5_AI_HYPOTHESIS_INPUTS.tsv`

Blob:
`7b190250660ee5245df7b0b3a79ce4cefdee9373`

```text
ROWS = 867
UNIQUE_M5_INPUT_IDS = 867
UNIQUE_REGISTRY_ENTITIES = 44
UNIQUE_CANDIDATE_GROUPS = 779
STATUS = HYPOTHESIS_ONLY_NO_PROVIDER_CALL for 867/867
```

These are accepted M4C inputs, not yet the final M5 register.

### New targeted M4 overlay candidate inputs

`docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv`

Blob:
`dc9aa037a5da3101c72d4c6460109e4f69d5eea2`

```text
ROWS = 133
ALREADY_PRESENT = 14
NEW_CANDIDATE = 64
POSSIBLE_VARIANT = 19
OUT_OF_SCOPE = 24
AMBIGUOUS = 12
```

All 133 are source-grounded page wording, but none is automatically an M5 hypothesis.

### Supporting current context

Read in full:

- targeted page evidence:
  `M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv`
  blob `c2aaf2d18784e0386d044621c9409225b1efe4a4`
  rows = 47

- targeted M4C/M6 reconciliation:
  `M4Q_R2_TARGETED_M4C_M6_RECONCILIATION.tsv`
  blob `a0123d35a62b4ec969b53cb4f6ac753de83a3633`
  rows = 59

- current M4Q query visibility:
  `M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv`
  blob `d8401597cb66a9c4181422af37453934113dfd57`
  rows = 45

- current M4Q/M4C/M6 reconciliation:
  `M4Q_R2_M4C_M6_RECONCILIATION.tsv`
  blob `363536ac20c41e4b8b9c136f842ef12db0ce15c3`
  rows = 45

- accepted M3 query authority:
  `docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md`

## 5. Work trigger

```text
WORK_TRIGGER = MET
```

Reason:

```text
BASE_M4C_M5_INPUT_ROWS = 867
TARGETED_OVERLAY_CANDIDATE_ROWS = 133
PRIMARY_M5_INPUT_ACCOUNTING_ROWS = 1000
SUPPORTING_QUERY_ROWS = 45
SUPPORTING_TARGET_ROWS = 59
SUPPORTING_CURRENT_PAGE_ROWS = 47
```

The task requires full-volume cross-source reconciliation and conservative semantic dispositions.

Sampling, FIRST_N, arbitrary pruning and ordinary-chat simplification are forbidden.

## 6. M5 exact purpose

Build the provisional:

`AI_DIAGNOSTIC_HYPOTHESIS_REGISTER`

Each admitted hypothesis must state:
- what future Alice/AI observation might be asked;
- what accepted Search/M4 evidence currently says;
- what uncertainty remains;
- what information a later AI observation could add;
- which later Search-only decision it might test after M10A;
- why the hypothesis is not current AI evidence.

M5 does not decide whether the hypothesis will actually be executed later.

Final case selection occurs only in M10B after a frozen M10A Search-only baseline exists.

## 7. Full input accounting

Every one of the 1,000 primary input rows must receive one M5 disposition.

Allowed dispositions:

```text
ADMIT_PROVISIONAL_HYPOTHESIS
EXACT_DUPLICATE_OF_ADMITTED_HYPOTHESIS
SEARCH_OR_M6_ONLY_NOT_AI_DIAGNOSTIC
OUT_OF_PRODUCT_SCOPE
HOLD_AMBIGUOUS
SUPERSEDED_BY_CURRENT_M4_EVIDENCE
```

No input row may disappear.

Existing 867 hypotheses must be re-evaluated against current M4 authority; they are not auto-retained merely because they existed before R2.

Targeted overlay:
- `OUT_OF_SCOPE` may not become admitted without explicit current product authority;
- `AMBIGUOUS` may not become admitted without resolving the ambiguity from accepted evidence;
- `NEW_CANDIDATE` is not demand and is not automatically AI-diagnostic;
- `POSSIBLE_VARIANT` is not semantic identity.

## 8. Hypothesis identity / deduplication

Deduplication may use only exact-safe identity unless a separately documented semantic relation is preserved as non-identity.

Exact-safe comparison:
- Unicode NFC;
- trim outer whitespace;
- collapse internal whitespace;
- case-fold/lowercase.

Do not silently merge:
- morphology;
- synonyms;
- different task meanings;
- different marketplace scope;
- different uncertainty/decision effects.

If multiple source rows map to one exact-safe admitted hypothesis, preserve all source IDs/provenance.

No arbitrary cap on register size.

## 9. Hard boundaries

```text
M5_HYPOTHESIS != AI_EVIDENCE
M5_HYPOTHESIS != DEMAND
M5_HYPOTHESIS != FINAL_AI_CASE
M5_HYPOTHESIS != FINAL_QUERY
M5_HYPOTHESIS != FINAL_CLUSTER
M5_HYPOTHESIS != FINAL_PAGE
M5_HYPOTHESIS != FINAL_URL/H1/TITLE/IA

ALICE_CALLS = 0
YANDEX_SEARCH_CALLS = 0
WORDSTAT_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
```

Do not create AI-specific pages.

Do not change Search evidence from hypothetical AI behavior.

## 10. Required outputs — exactly 5

1. `M5_SOURCE_MANIFEST.md`
2. `M5_INPUT_DISPOSITION_LEDGER.tsv`
3. `M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER.tsv`
4. `M5_QA.md`
5. `M5_RETURN_MANIFEST.json`

## 11. Required input-disposition ledger

Exactly 1,000 data rows.

At minimum:

- m5_input_row_id
- input_source_layer
- source_input_id
- source_registry_id
- source_candidate_group_or_delta_id
- source_wording
- source_status
- source_evidence_refs
- current_m4_context_summary
- m5_disposition
- disposition_reason
- admitted_hypothesis_id
- ambiguity_or_hold_reason
- claim_boundary

Required accounting:

```text
M4C_BASE_INPUTS = 867/867
TARGETED_OVERLAY_INPUTS = 133/133
TOTAL_INPUTS = 1000/1000
SILENT_INPUT_LOSS = 0
```

## 12. Required hypothesis register

One row per admitted provisional hypothesis.

At minimum:

- m5_hypothesis_id
- provisional_future_ai_question
- hypothesis_comparison_key
- marketplace_scope
- task_or_intent_scope
- source_registry_ids
- source_candidate_groups_or_delta_ids
- observed_competitor_wording_examples
- accepted_search_m4_evidence_summary
- current_uncertainty
- expected_future_ai_information_gain
- likely_search_decision_affected
- m10b_selection_requirement
- source_evidence_refs
- confidence
- hold_or_variability_notes
- do_not_infer_boundary
- status

Required status:

`PROVISIONAL_HYPOTHESIS_ONLY_NO_AI_PROVIDER_EVIDENCE`

for every admitted row.

Do not assign final priority score/rank/winner.

## 13. QA

At minimum:

```text
BASE_M4C_INPUTS_ACCOUNTED = 867/867
TARGETED_OVERLAY_INPUTS_ACCOUNTED = 133/133
TOTAL_PRIMARY_INPUTS_ACCOUNTED = 1000/1000
SILENT_INPUT_LOSS = 0

DISPOSITION_ADMIT =
DISPOSITION_EXACT_DUPLICATE =
DISPOSITION_SEARCH_OR_M6_ONLY =
DISPOSITION_OUT_OF_SCOPE =
DISPOSITION_HOLD_AMBIGUOUS =
DISPOSITION_SUPERSEDED =

ADMITTED_HYPOTHESES =
UNIQUE_HYPOTHESIS_IDS =
HYPOTHESES_WITH_SOURCE_PROVENANCE =
HYPOTHESES_WITH_CURRENT_UNCERTAINTY =
HYPOTHESES_WITH_EXPECTED_INFO_GAIN =
HYPOTHESES_WITH_LIKELY_SEARCH_DECISION =
HYPOTHESES_WITH_M10B_SELECTION_REQUIREMENT =

AI_PROVIDER_EVIDENCE_ROWS = 0
ALICE_CALLS = 0
YANDEX_SEARCH_CALLS = 0
WORDSTAT_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0

SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_TOPIC_AS_DEMAND = 0
FINAL_AI_CASE_SELECTIONS = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
GITHUB_WRITES = 0
```

## 14. Stop conditions

- `HOLD_AUTHORITY_DRIFT` if current M4/rules/product authority materially changed.
- `PARTIAL_REWORK_REQUIRED` if 1,000/1,000 primary rows are not accounted.
- Preserve row-level HOLD rather than guessing through material ambiguity.

## 15. Publication

Work must not write to GitHub.

Return one downloadable ZIP containing exactly five outputs.

Owner uploads all five unpacked files together to:

`docs/seo/work_return/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1/`

Main Chat performs remote readback / QA.

## 16. Current cursor

```text
M4 = ACCEPTED / CURRENT WITH EXPLICIT BOUNDED HOLDS
M5 = PREPARED FOR FULL-VOLUME WORK / NO PROVIDER
M6 = BLOCKED ON ACCEPTED M5 HYPOTHESIS REGISTER
M7 = BLOCKED
```
