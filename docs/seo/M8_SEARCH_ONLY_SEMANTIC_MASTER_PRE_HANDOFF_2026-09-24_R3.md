# M8 Search-only Semantic Master — PRE-HANDOFF R3

WORK_ID: `OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3`
ROADMAP_STAGE: `M8 / W1`
Status: **READY FOR WORK PROMPT AFTER REMOTE READBACK**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
CURRENT_REMOTE_HEAD: `8db8af224a8b87613570c9dc8c310af1c0af0215`

## Preparation authority

Executable R3 step preparation:
`docs/seo/M8_STEP_PREPARATION_2026-09-24_R3.md`

Required blob:
`4ee2374170cd3a0765af5f59d191215cfaf54889`

R3 direct-input manifest:
`docs/seo/M8_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-24_R3.json`

Required blob:
`d6ddafd812baacd60e737a3141971b76f81da485`

Effective M7:
- base `M7_SEARCH_SIDE_FREEZE_MANIFEST_2026-09-23_R1.json`
  blob `3cc09a62aa4ac4bed0af44939a9be63820657219`
- correction `M7_SEARCH_SIDE_FREEZE_TRANSPORT_CORRECTION_2026-09-24_R2.json`
  blob `ed1bad03d793ed0b0315c94b3b1bf46771736fd8`

R2 Work HOLD:
`docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R2/M8_R2_WORK_HOLD_RETURN_2026-09-24.md`
blob `2dc9520bcedc7a4808167d91a55a7586b8ca134e`.

R1/R2 execution prompts are superseded.

## WHY_WORK_REQUIRED

```text
PRIMARY RAW OCCURRENCES = 25229
DIRECT/CONTEXT INPUTS = 46
FULL M7 BASE CATALOG = 162
TRANSPORT CORRECTION OVERLAY = 1

FULL-VOLUME NEEDS:
- exact occurrence accounting
- semantic identity formation
- provenance joins
- evidence-class separation
- M6 HOLD propagation
- row-level state/task/intent/product-fit/priority
- independent adversarial QA
```

`WORK_TRIGGER = REQUIRED`.
Sampling/first-N/truncation fallback is forbidden.

## ALLOWED INPUTS

Binding direct list:
`docs/seo/M8_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-24_R3.json`

Exactly 46 direct/context files.

45 are unchanged from R2.

One replacement:

Historical malformed, prohibited direct use:
`docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv`

Current parser-safe authority:
`docs/seo/serp/competitors/recovery/M4Q_R2_TARGETED_PAGE_EVIDENCE_2026-09-24_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE_RECOVERED.tsv`

Required recovered identity:
```text
GIT_BLOB = b62d1c2cfb8ccb4dba84b8d3d691cb5d1c5fb77c
BYTES = 2602161
SHA256 = a9ec3a14319edc0a4721e702378e910461490be1deba4136afcdf2276c2585d5
ROWS = 47
COLUMNS = 21
```

Files outside the R3 direct manifest may be opened only as M7 `audit_fallback` for a named provenance/defect question and must be listed in Work source manifest.

## PROHIBITED INPUTS

```text
M5 hypothesis semantic use
Alice / GenSearch / AI-search evidence
M7 prohibited_semantic_input
M7 prohibited_direct_use
historical malformed targeted-page-evidence direct parsing
superseded M8 R1/R2 prompt authority
new external web research
new provider acquisition
chat memory as evidence
```

## EXACT EXECUTION GOAL

```text
25229 primary raw occurrences
-> immutable raw ledger
-> conservative exact-safe identities
-> evidence-backed semantic equivalence only
-> one Search-only semantic master
-> WORKING / REVIEW_HOLD / EXCLUDED / BRAND_DEFENSE
-> user task
-> Search intent
-> product fit
-> priority
-> preliminary family
-> explicit ambiguity/reopen rules
-> independent adversarial QA
```

No clustering/page decisions.

## PRIMARY RAW OCCURRENCE EQUATION

```text
M2R = 1123
M4Q_QUERY_UNIVERSE = 15542
M4C_CANDIDATES = 8431
TARGETED_DELTA = 133
TOTAL = 25229
```

Recovered targeted page evidence is an overlay only.

## INPUT TRANSPORT PREFLIGHT

Before semantic analysis, scan every direct TSV.

Default TSV contract unless frozen authority says otherwise:
```text
separator = TAB
record = physical newline
quote semantics = disabled
expected width = header width
```

Hard gate:
```text
DIRECT_TSV_FILES_SCANNED = ALL
MALFORMED_DIRECT_TSV_PHYSICAL_LINES = 0
RECOVERED_TARGETED_PAGE_ROWS = 47/47
RECOVERED_TARGETED_PAGE_WIDTH = 21/21
HISTORICAL_MALFORMED_PAGE_FILE_DIRECTLY_PARSED = 0
```

Any failure => `HOLD_INPUT_TRANSPORT`.

M2R CSV uses standard CSV parser with UTF-8 BOM awareness.

## SEMANTIC / LINEAGE CONTRACT

Inherited from R2 and frozen by R3 preparation:

- exact-safe normalization only: NFC, outer trim, collapse whitespace, case-fold;
- raw text immutable;
- no stemming/morphology/synonym/entity/marketplace/Latin-Cyrillic automatic merge;
- non-exact merge requires equivalence on referent, task, scope, action/object, intent and product-fit;
- material ambiguity => REVIEW_HOLD;
- deterministic raw IDs;
- deterministic semantic IDs;
- every raw occurrence -> exactly one primary semantic identity;
- raw lineage never erased.

Primary state:
`WORKING | REVIEW_HOLD | EXCLUDED | BRAND_DEFENSE`.

Product fit:
`SUPPORTED_CURRENT | SUPPORTED_WITH_BOUNDARY | UNPROVEN_CAPABILITY_HOLD | OUT_OF_SCOPE | AMBIGUOUS`.

Intent:
`INFORMATIONAL | COMMERCIAL_INVESTIGATION | TRANSACTIONAL | NAVIGATIONAL | MIXED | AMBIGUOUS`.

Priority:
`P1_CORE | P2_STRONG | P3_SUPPORTING | P4_EXPLORATORY | NA_REVIEW_HOLD | NA_EXCLUDED | NA_BRAND_DEFENSE`.

No default KEEP.

## M6 HOLD ANCESTRY

Must account:
```text
SOURCE HOLD_AMBIGUOUS = 1676
PRODUCT_CAPABILITY_HOLD = 29
M6PC004 INVALID_QUERY HOLD = 1
HTML CAPABILITY HOLD = 6
DEVICE/USERAGENT HOLD = 3
```

Any M6-HOLD ancestry promoted to non-HOLD must appear in adversarial QA with exact resolving frozen evidence.

## AI EXCLUSION

```text
ALICE_INPUT_ROWS = 0
M5_HYPOTHESIS_USED_AS_SEARCH_TRUTH = 0
AI_SOURCE_USED_FOR_RELEVANCE = 0
AI_SOURCE_USED_FOR_INTENT = 0
AI_SOURCE_USED_FOR_PRIORITY = 0
```

## REQUIRED OUTPUTS

Exactly nine:

1. `M8_SOURCE_MANIFEST.md`
2. `M8_RAW_OCCURRENCE_LEDGER.tsv`
3. `M8_SEMANTIC_IDENTITY_MASTER.tsv`
4. `M8_IDENTITY_SOURCE_XREF.tsv`
5. `M8_REASON_CODE_DICTIONARY.md`
6. `M8_HOLD_REVIEW_LEDGER.tsv`
7. `M8_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M8_QA.md`
9. `M8_RETURN_MANIFEST.json`

Schemas from R2 remain binding plus R3 transport-preflight fields.

## KNOWN FAILURE REGRESSIONS

Must prove:
```text
DEFAULT_KEEP = 0
LOW_FREQUENCY_ONLY_EXCLUDE = 0
HIGH_FREQUENCY_ONLY_KEEP = 0
SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_TOPIC_AS_DEMAND = 0
PROVIDER_FAILURE_AS_ZERO_DEMAND = 0
PRODUCT_HOLD_AS_SUPPORTED_TASK = 0
BUYER_SELLER_COLLISION_SILENT = 0
HUMAN_SOFTWARE_COLLISION_SILENT = 0
EXTERNAL_INTERNAL_ANALYTICS_COLLISION_SILENT = 0
UNSUPPORTED_MUTATION_PROMOTED = 0
M5_AI_CONTAMINATION = 0
RAW_LINEAGE_LOSS = 0
SILENT_ROW_LOSS = 0
HISTORICAL_MALFORMED_PAGE_FILE_DIRECTLY_PARSED = 0
R2_SUPERSEDED_EXECUTION_AUTHORITY_USED = 0
```

## QA / ACCEPTANCE

At minimum:
```text
RAW_OCCURRENCE_ROWS = 25229/25229
UNIQUE_RAW_OCCURRENCE_IDS = 25229
UNLINKED_RAW_OCCURRENCES = 0
RAW_OCCURRENCE_MULTI_PRIMARY_IDENTITY = 0
EVERY_IDENTITY_HAS_STATE_REASON = true
STATE_SUM_EQUALS_IDENTITY_ROWS = true
REASON_CODES_ALL_DEFINED = true
UNCERTAINTY_EXPLICIT = true
INDEPENDENT_SEMANTIC_QA = PASS

MALFORMED_DIRECT_TSV_PHYSICAL_LINES = 0
RECOVERED_TARGETED_PAGE_ROWS = 47/47
RECOVERED_TARGETED_PAGE_WIDTH = 21/21

ALICE_INPUT_ROWS = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0

PROVIDER_CALLS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES = 0
OPEN_CRITICAL_DEFECTS = 0
```

## STOP CONDITIONS

```text
HOLD_AUTHORITY_DRIFT
HOLD_INPUT_IDENTITY
HOLD_INPUT_TRANSPORT
PARTIAL_REWORK_REQUIRED
HOLD_SEMANTIC_CONTRACT_DEFECT
```

Row-level REVIEW_HOLD is valid and expected.

## PUBLICATION

Work creates exactly one downloadable ZIP with exactly 9 final files.
Work does not write GitHub.

Owner staging:
`docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/`

Exact upload URL:
`https://github.com/MaksimUnimax/runtime-fixtures/upload/seo/wordstat-batch-01-2026-09-16/docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/`

## OWNER RELAY

Main Chat must give the final R3 prompt directly in chat, complete and copy-ready.

## HANDOFF VERDICT

```text
WORK_ID = OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3
ROADMAP_STAGE = M8 / W1
STEP_PREPARATION_R3 = PASS / REMOTE READBACK
WHY_WORK_REQUIRED = FROZEN
ALLOWED_INPUT_FILES = FROZEN
PROHIBITED_INPUTS = FROZEN
EXACT_EXECUTION_GOAL = FROZEN
REQUIRED_OUTPUT_FILES = 9
SCHEMA_AND_LINEAGE = FROZEN
INPUT_TRANSPORT_PREFLIGHT = FROZEN
KNOWN_FAILURE_REGRESSIONS = FROZEN
QA_ACCEPTANCE_CHECKS = FROZEN
STOP_CONDITIONS = FROZEN
PUBLICATION_POLICY = FROZEN
OWNER_RELAY_STAGING_PATH = FROZEN

WORK_PROMPT_ALLOWED_BEFORE_THIS_FILE_READBACK = false
```
