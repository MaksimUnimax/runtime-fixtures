# Octoport SEO — M10B final AI diagnostic case selection — PRE-HANDOFF — 2026-09-24 R1

WORK_ID: `OCTOPORT_SEO_M10B_FINAL_AI_DIAGNOSTIC_CASE_SELECTION_2026-09-24_R1`
ROADMAP_STAGE: `M10B FINAL AI DIAGNOSTIC CASE SELECTION`
Status: **READY FOR WORK PROMPT AFTER REMOTE READBACK**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
PREPARATION_PARENT_HEAD: `ab8c787a3ca087efa8e01cab409ffe36624e4649`

Binding input manifest:
`docs/seo/M10B_FINAL_AI_CASE_SELECTION_INPUT_MANIFEST_2026-09-24_R1.json`
blob `0c8a200e6733e21c56221d8d22d781cd54f3f01a`.

Step preparation:
`docs/seo/M10B_STEP_PREPARATION_2026-09-24_R1.md`
blob `8a06eff867d569bd96d42b6527886b4a6015ef84`.

Accepted M10A baseline:
`docs/seo/M10A_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`
blob `a0cc44f9631067f4938044fe0a4c21e6ed4898cb`.

Accepted M5 hypothesis authority:
`docs/seo/M5_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`
blob `1ba7eda6e51fef110be3847b10819ddab344e5f9`.

## Frozen counts

```text
M5_HYPOTHESES = 65
M10A_CLUSTER_BASELINE_ROWS = 104
M10A_MATERIAL_BOUNDARY_ROWS = 1399
M10A_SEARCH_OWNER_HOLD = 104

HYPOTHESES_WITH_DIRECT_CURRENT_QUERY_LINK = 43
HYPOTHESES_WITHOUT_DIRECT_CURRENT_QUERY_LINK = 22
DIRECT_HYPOTHESIS_QUERY_CLUSTER_LINK_ROWS = 164
DIRECT_LINKED_M10A_CLUSTERS = 19
DIRECT_LINKED_MATERIAL_BOUNDARIES = 363
```

These crosswalk counts are mechanical expectations to re-derive, not a preselected case list.

## Required selection boundary

No arbitrary case quota.
No provider budget-based first-N.
No case is selected merely because it appears in M5.

Every one of 65 hypotheses must be accounted.

Final case count is NOT predeclared.

Every selected case requires:
- named affected M10A cluster;
- named frozen baseline HOLD/uncertainty;
- causal M5 uncertainty;
- exact executable diagnostic prompt;
- specific expected information gain;
- explicit repeat/variability plan;
- bounded stop rule;
- provider execution = false in M10B.

## Downstream stop

M10C is blocked until Main Chat independently accepts M10B.

Work returns exactly 8 files.

Owner staging:
`docs/seo/work_return/M10B_FINAL_AI_DIAGNOSTIC_CASE_SELECTION_2026-09-24_R1/`
