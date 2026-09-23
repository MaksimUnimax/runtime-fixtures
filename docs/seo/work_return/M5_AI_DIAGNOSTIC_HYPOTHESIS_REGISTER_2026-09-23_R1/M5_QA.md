# M5 full-volume QA

WORK_ID = OCTOPORT_SEO_M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1
START_HEAD = 30c3e8d8e0a82d5827a258ecb01a66b96817b0f4
END_OBSERVED_HEAD = 30c3e8d8e0a82d5827a258ecb01a66b96817b0f4
AUTHORITY_DRIFT_STATUS = NONE
VERDICT = PASS_PROVISIONAL_HYPOTHESIS_REGISTER_WITH_ROW_LEVEL_HOLDS

FROZEN_REQUIRED_BLOBS_MATCH = 10/10
BASE_M4C_INPUTS_ACCOUNTED = 867/867
TARGETED_OVERLAY_INPUTS_ACCOUNTED = 133/133
TOTAL_PRIMARY_INPUTS_ACCOUNTED = 1000/1000
SILENT_INPUT_LOSS = 0
DUPLICATE_INPUT_ROW_IDS = 0

DISPOSITION_ADMIT = 65
DISPOSITION_EXACT_DUPLICATE = 28
DISPOSITION_SEARCH_OR_M6_ONLY = 188
DISPOSITION_OUT_OF_SCOPE = 681
DISPOSITION_HOLD_AMBIGUOUS = 28
DISPOSITION_SUPERSEDED = 10
DISPOSITION_ACCOUNTING = 1000/1000

ADMITTED_HYPOTHESES = 65
UNIQUE_HYPOTHESIS_IDS = 65/65
UNIQUE_HYPOTHESIS_COMPARISON_KEYS = 65/65
HYPOTHESES_WITH_SOURCE_PROVENANCE = 65/65
HYPOTHESES_WITH_CURRENT_UNCERTAINTY = 65/65
HYPOTHESES_WITH_EXPECTED_INFO_GAIN = 65/65
HYPOTHESES_WITH_LIKELY_SEARCH_DECISION = 65/65
HYPOTHESES_WITH_M10B_SELECTION_REQUIREMENT = 65/65
HYPOTHESES_WITH_CORRECT_STATUS = 65/65

AI_PROVIDER_EVIDENCE_ROWS = 0
FINAL_AI_CASE_SELECTIONS = 0
ALICE_CALLS = 0
YANDEX_SEARCH_CALLS = 0
WORDSTAT_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_TOPIC_AS_DEMAND = 0
COMPETITOR_CLAIM_AS_OCTOPORT_FACT = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0
GITHUB_WRITES = 0
OPEN_CRITICAL_DEFECTS = 0

## Adversarial source and meaning checks

- All 867 prior M4C rows reclassified. A listing for an unrelated ChatGPT integration did not become a seller AI case. News on a competitor site did not become demand.
- All 133 exact target wording records reviewed with 47 current page rows and 59 target reconciliations. Source statuses 14 ALREADY_PRESENT / 64 NEW_CANDIDATE / 19 POSSIBLE_VARIANT / 24 OUT_OF_SCOPE / 12 AMBIGUOUS remain recoverable from `source_status`. Every source `OUT_OF_SCOPE` and `AMBIGUOUS` remained outside admissions.
- The 28 exact duplicate inputs point to admitted hypotheses, each of which carries all source row IDs, registry IDs and original candidate/page references. Hypotheses preserve distinct exact wordings; no synonym merge.
- Contextual Q IDs are 45 accepted current known exact Search queries, not an arbitrary competitor reverse index. A contextual match does not assign a sibling-host identity, prove demand for an M4C heading, or establish Octoport functionality.
- 26 ambiguous rows remain terminal row-level holds, including accepted overlay ambiguities and underspecified extraction fragments; no whole-task HOLD needed.
- Admitted cases are provisional tests of source roles/framing. Current Search evidence provides the comparator, but later M10B selection can reject every proposed case after M10A without invalidating this accounting.

### Per-layer accounting

| Layer | Admit | Exact duplicate | Search/M6 | Out of scope | Hold | Superseded | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M4C_R1_M5_INPUT | 32 | 27 | 142 | 657 | 9 | 0 | 867 |
| M4Q_R2_TARGETED_CANDIDATE_DELTA | 33 | 1 | 46 | 24 | 19 | 10 | 133 |
