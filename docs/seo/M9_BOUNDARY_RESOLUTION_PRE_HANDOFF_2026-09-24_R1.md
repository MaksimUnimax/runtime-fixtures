# M9 boundary-resolution pre-acquisition — PRE-HANDOFF R1

WORK_ID: `OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1`
ROADMAP_STAGE: `M9 / W2.1 PRE-ACQUISITION RECONCILIATION`
Status: **READY FOR WORK PROMPT AFTER REMOTE READBACK**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
CURRENT_REMOTE_HEAD: `f4d5d33b7fb2150e0a863340712a235e3458e948`

## Current authority

Step preparation:
`docs/seo/M9_BOUNDARY_RESOLUTION_STEP_PREPARATION_2026-09-24_R1.md`
blob `fb0d6ecf64bef695e70991764a009109e887b1ff`.

Input manifest:
`docs/seo/M9_BOUNDARY_RESOLUTION_PREACQ_INPUT_MANIFEST_2026-09-24_R1.json`
blob `8a2c5eb5bb5985bbd743e83803026f02ee9f73ec`.

Accepted M9:
`docs/seo/M9_R2_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-24_R1.md`.

## Why Work

```text
CLUSTER_ELIGIBLE = 104
CURRENT_SEARCH_ANCHORS = 22
MISSING_CURRENT_SEARCH = 82

HOLD_BOUNDARY = 1518
MATERIAL_HOLD = 1424
ONE_CURRENT_SERP_HOLD = 396

QUERY_FORM_REVIEW = 82 rows
GRAPH_IMPACT_REVIEW = 82 rows
```

Large full-volume reconciliation; no sampling.

## Exact goal

Classify all 82 missing-Search M9 identities into:
- first-wave exact Search candidates;
- deferred candidates;
- persistent no-query HOLD;
- ambiguous query-form HOLD.

Select at most 25 exact current Search queries with explicit information gain.

Do NOT execute providers.

## Allowed inputs

Exactly 14 files from the pre-acquisition input manifest.

## Prohibited

- provider calls;
- Bridge commands;
- web acquisition by Work;
- Alice/AI-search;
- query rewriting/rephrasing;
- related-query expansion;
- M8 non-WORKING identities;
- M10A page ownership/URL/H1/Title/IA.

## Query text authority

For any candidate:

`exact_query_text = M8 canonical_display_text`.

No rewrite.

Allowed query-form classes:

```text
DEMAND_OR_TESTED_EXACT_QUERY
NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND
PAGE_TITLE_OR_SOURCE_PHRASE
AMBIGUOUS_QUERY_FORM
```

Only first two may become Wave‑1 candidates.

## Wave-1 information gain

Wave‑1 row requires:
- M8 WORKING;
- no existing current exact Search anchor;
- query-safe exact text;
- provider length/word bounds pass;
- named current M9 boundary impact;
- no duplicate existing Search snapshot.

Cap:
`WAVE1_QUERY_COUNT <= 25`.

Selection order:

1. blocks a currently supported merge from materialization;
2. material HOLD degree to existing Search anchors desc;
3. total material HOLD degree desc;
4. one-current-SERP HOLD degree desc;
5. demand/tested exact query before natural no-demand probe;
6. semantic ID asc.

25 is a ceiling, not a target.

## Current graph facts to reconcile

```text
MATERIAL_HOLD = 1424

ANCHOR<->ANCHOR = 47
ANCHOR<->MISSING = 371
MISSING<->MISSING = 1006

ONE_CURRENT_SERP_HOLD = 396
UNIQUE_MISSING_IN_ONE_SERP_HOLD = 82

H_ONE_SERP_INSUFFICIENT = 150
UNIQUE_MISSING = 56
```

All counts must be recomputed by Work from frozen inputs.

## Future provider context — planning only

Intended future Search context:

```text
Yandex Search API
DEFERRED_ASYNC via Yandex Marketing Bridge
SEARCH_TYPE_RU
region = 225
page = 0
depth/groupsOnPage = 100
docsInGroup = 1
GROUP_MODE_FLAT
FAMILY_MODE_MODERATE
FIX_TYPO_MODE_OFF
SORT_MODE_BY_RELEVANCE
SORT_ORDER_DESC
```

This is NOT provider authorization.

Current installed Bridge capability and current tariff must be rechecked later by Main Chat.

## Exact outputs — 9

1. `M9BR_SOURCE_MANIFEST.md`
2. `M9BR_IDENTITY_DISPOSITION.tsv`
3. `M9BR_BOUNDARY_IMPACT_LEDGER.tsv`
4. `M9BR_WAVE1_QUERY_MANIFEST.tsv`
5. `M9BR_DEFERRED_OR_PERSISTENT_HOLD.tsv`
6. `M9BR_PROVIDER_RELEASE_PLAN.tsv`
7. `M9BR_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M9BR_QA.md`
9. `M9BR_RETURN_MANIFEST.json`

## Row contracts

```text
IDENTITY_DISPOSITION_ROWS = 104
EXISTING_CURRENT_SEARCH_ANCHOR = 22

BOUNDARY_IMPACT_ROWS = 82

WAVE1_QUERY_ROWS = 0..25
PROVIDER_RELEASE_PLAN_ROWS = WAVE1_QUERY_ROWS

DEFERRED_OR_PERSISTENT_ROWS =
82 - WAVE1_QUERY_ROWS
```

## Provider release plan mandatory fields

Each selected query must contain the complete future information-gain/outcome contract frozen in the step preparation, including:
- exact query;
- semantic ID;
- open decision;
- affected HOLDs;
- success/zero/failure meanings;
- exact intended provider parameters;
- no-blind-retry;
- persistence path;
- downstream rerun decision.

## Hard QA

```text
M9_ACCEPTANCE = PASS_WITH_HOLD_BOUNDARIES

M9_ELIGIBLE = 104/104
EXISTING_SEARCH_ANCHORS = 22/22
MISSING_CURRENT_SEARCH = 82/82

IDENTITY_DISPOSITION_ROWS = 104/104
BOUNDARY_IMPACT_ROWS = 82/82

MATERIAL_HOLD_RECOMPUTED = 1424/1424
ONE_CURRENT_SERP_HOLD_RECOMPUTED = 396/396
MISSING_IDENTITIES_WITH_ONE_SERP_HOLD = 82/82

WAVE1_QUERY_COUNT <= 25
WAVE1_DUPLICATE_SEMANTIC_ID = 0
WAVE1_DUPLICATE_QUERY_TEXT = 0
WAVE1_REPHRASED_QUERY = 0
WAVE1_PROVIDER_LIMIT_VIOLATION = 0
WAVE1_EXISTING_SEARCH_DUPLICATE = 0
WAVE1_WITHOUT_NAMED_INFO_GAIN = 0

PAGE_TITLE_OR_SOURCE_PHRASE_RELEASED = 0
AMBIGUOUS_QUERY_FORM_RELEASED = 0

PROVIDER_CALLS = 0
BRIDGE_COMMANDS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES = 0
ALICE_INPUT_ROWS = 0
M10A_PAGE_OWNERSHIP_DECISIONS = 0

INDEPENDENT_PREACQ_QA = PASS
OPEN_CRITICAL_DEFECTS = 0
```

## Adversarial QA

Must test:
- demand-only promotion;
- competitor title accidental release;
- natural no-demand query wrongly rejected;
- rewritten query;
- duplicate current anchor;
- no named boundary impact;
- high-degree title-like node selected;
- supported-merge blocker ignored;
- 25 treated as target;
- truncation to provider limits;
- M8 non-WORKING admission;
- AI contamination;
- provider execution inside Work.

Systematic defect:
rerun all 82 identities.

## Stop

```text
HOLD_AUTHORITY_DRIFT
HOLD_INPUT_IDENTITY
HOLD_PREACQ_ACCOUNTING
HOLD_QUERY_SELECTION_CONTRACT_DEFECT
```

## Publication

One ZIP with exactly 9 final files.

Staging:
`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/`

Upload:
`https://github.com/MaksimUnimax/runtime-fixtures/upload/seo/wordstat-batch-01-2026-09-16/docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/`

## Handoff verdict

```text
WORK_ID = OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1
ROADMAP_STAGE = M9 / W2.1
WHY_WORK_REQUIRED = FROZEN
ALLOWED_INPUT_FILES = FROZEN
PROHIBITED_INPUTS = FROZEN
EXACT_EXECUTION_GOAL = FROZEN
QUERY_FORM_CLASSES = FROZEN
INFORMATION_GAIN_GATE = FROZEN
WAVE1_SELECTION_ORDER = FROZEN
PROVIDER_RELEASE_PLAN_SCHEMA = FROZEN
REQUIRED_OUTPUT_FILES = 9
QA_ACCEPTANCE_CHECKS = FROZEN
STOP_CONDITIONS = FROZEN
PUBLICATION_POLICY = FROZEN

PROVIDER_EXECUTION_ALLOWED = false
WORK_PROMPT_ALLOWED_BEFORE_THIS_FILE_READBACK = false
```
