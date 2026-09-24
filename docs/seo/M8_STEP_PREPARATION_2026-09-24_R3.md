# M8 STEP PREPARATION R3 — corrected transport

Date: 2026-09-24
Status: **PREPARATION COMPLETE / WORK NOT YET RELEASED**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
LIVE_HEAD: `107afe5254a0b16e050d731816fcd09b96fb7404`

## Two-level gate

LEVEL 1 read/applied:
- `LEVEL1/README.md`
- `EXECUTION_RULES.md`
- `QUALITY_FIRST_RESOURCE_RULE.md`
- `WORK_HANDOFF_RULE.md`
- `METHODOLOGY.md`
- `PRODUCT_TRUTH.md`

LEVEL 2 read/applied:
- `LEVEL2/README.md`
- `LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `LEVEL2/M7_M8_SEARCH_FREEZE_AND_SEMANTIC_MASTER_RULES.md`

Roadmap/current state, current work/evidence and `FAILURE_LEDGER.md` read.

```text
LEVEL1_READ = PASS
LEVEL2_READ = PASS
ROADMAP_CURRENT_STATE_READ = PASS
WORK_EVIDENCE_READ = PASS
FAILURE_HISTORY_READ = PASS
```

## Current cursor

```text
M7 = PASS_WITH_TRANSPORT_CORRECTION
M8 R1 = SUPERSEDED
M8 R2 = HOLD_SEMANTIC_CONTRACT_DEFECT / NOT ACCEPTED
M8 R3 = CURRENT PREPARATION
M9 = BLOCKED
```

Effective M7:
- base manifest `M7_SEARCH_SIDE_FREEZE_MANIFEST_2026-09-23_R1.json`
  blob `3cc09a62aa4ac4bed0af44939a9be63820657219`
- correction overlay `M7_SEARCH_SIDE_FREEZE_TRANSPORT_CORRECTION_2026-09-24_R2.json`
  blob `ed1bad03d793ed0b0315c94b3b1bf46771736fd8`

## R2 HOLD and recovery

R2 HOLD return:
`docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R2/M8_R2_WORK_HOLD_RETURN_2026-09-24.md`
blob `2dc9520bcedc7a4808167d91a55a7586b8ca134e`.

Historical malformed overlay:
`M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv`
blob `c2aaf2d18784e0386d044621c9409225b1efe4a4`
SHA256 `96d930d02060141a6eb9242c8079121a85359a256ff2fd39e0c4995577b05486`.

Current recovered authority:
`docs/seo/serp/competitors/recovery/M4Q_R2_TARGETED_PAGE_EVIDENCE_2026-09-24_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE_RECOVERED.tsv`
blob `b62d1c2cfb8ccb4dba84b8d3d691cb5d1c5fb77c`.

Commit-addressed readback:
```text
BYTES = 2602161
SHA256 = a9ec3a14319edc0a4721e702378e910461490be1deba4136afcdf2276c2585d5
ROWS = 47/47
UNIQUE_IDS = 47
WIDTH = 21/21 for 47/47
SEMANTIC_CHANGE = false
```

Historical malformed file is provenance only and must not be directly parsed.

## Method research

Same M8 analytical method as R2 remains current; transport repair introduces no new SEO-method question.

Current sources already checked for this M8 stage:
- Yandex Wordstat official;
- Yandex Webmaster query selection/clustering and statistics;
- Ahrefs/Semrush clustering corroboration;
- Google spam and people-first guidance.

Binding conclusions:
```text
WORDSTAT != INTENT
LEXICAL SIMILARITY != INTENT EQUIVALENCE
SEMANTIC IDENTITY != PAGE CLUSTER
SERP OVERLAP = M9 EVIDENCE, NOT M8 AUTO-MERGE
QUERY != PAGE
HIGH FREQUENCY != KEEP
LOW FREQUENCY != EXCLUDE
```

`FRESH_METHOD_RESEARCH = PASS / CURRENT SAME-STAGE AUTHORITY`.

## Work trigger

```text
PRIMARY_RAW_OCCURRENCES = 25229
CANONICAL_DIRECT_CONTEXT_FILES = 46
WORK_TRIGGER = REQUIRED
SAMPLE/FIRST-N/TRUNCATION FALLBACK = FORBIDDEN
```

## Exact inputs

Canonical R3 direct manifest:
`docs/seo/M8_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-24_R3.json`
blob `d6ddafd812baacd60e737a3141971b76f81da485`.

It preserves 45 R2 direct inputs and replaces exactly one malformed transport with the recovered file.

Primary occurrence equation remains:
```text
M2R = 1123
M4Q_QUERY_UNIVERSE = 15542
M4C_CANDIDATES = 8431
TARGETED_DELTA = 133
TOTAL = 25229
```

## Parser / transport preflight — new hard gate

Before semantic work, Work must scan every direct TSV under its declared parser.

Default TSV contract unless source authority says otherwise:
```text
separator = literal TAB
record = physical newline
quote semantics = disabled
expected width = header width
```

Report per direct TSV:
- physical data-line count;
- header column count;
- malformed physical-line count;
- expected row count where frozen.

Global gate:
```text
DIRECT_TSV_FILES_SCANNED = ALL
MALFORMED_DIRECT_TSV_PHYSICAL_LINES = 0
RECOVERED_TARGETED_PAGE_ROWS = 47/47
RECOVERED_TARGETED_PAGE_WIDTH = 21/21
HISTORICAL_MALFORMED_PAGE_FILE_DIRECTLY_PARSED = 0
```

Any failure => `HOLD_INPUT_TRANSPORT` before semantic classification.

M2R CSV remains standard CSV with UTF-8 BOM awareness.

## Semantic method

Inherited unchanged from accepted R2 preparation:
- exact-safe normalization: NFC + trim + whitespace collapse + case-fold only;
- no morphology/synonym/entity/marketplace auto-merge;
- non-exact merge requires equivalence of referent, task, entity scope, action/object, intent and product-fit;
- ambiguity => `REVIEW_HOLD`;
- states: `WORKING | REVIEW_HOLD | EXCLUDED | BRAND_DEFENSE`;
- no default KEEP;
- Product Truth is binding;
- M6 HOLD ancestry must be explicit;
- M5/Alice semantic input = 0;
- M8 may not perform M9 clustering/page ownership/URL-H1-Title-IA decisions.

## Exact outputs

Exactly 9 files:
1. `M8_SOURCE_MANIFEST.md`
2. `M8_RAW_OCCURRENCE_LEDGER.tsv`
3. `M8_SEMANTIC_IDENTITY_MASTER.tsv`
4. `M8_IDENTITY_SOURCE_XREF.tsv`
5. `M8_REASON_CODE_DICTIONARY.md`
6. `M8_HOLD_REVIEW_LEDGER.tsv`
7. `M8_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M8_QA.md`
9. `M8_RETURN_MANIFEST.json`

R2 semantic schemas/lineage/reason-code/state/priority/family contracts remain binding.

## R3 QA additions

`M8_QA.md` must additionally contain:
```text
M7_BASE_FREEZE_BLOB_MATCH =
M7_TRANSPORT_CORRECTION_BLOB_MATCH =
M8_R3_DIRECT_INPUT_MANIFEST_BLOB_MATCH =
DIRECT_TSV_FILES_SCANNED =
DIRECT_TSV_FILES_PASS =
MALFORMED_DIRECT_TSV_PHYSICAL_LINES = 0
RECOVERED_TARGETED_PAGE_EVIDENCE_BLOB_MATCH =
RECOVERED_TARGETED_PAGE_EVIDENCE_SHA256_MATCH =
RECOVERED_TARGETED_PAGE_EVIDENCE_ROWS = 47/47
RECOVERED_TARGETED_PAGE_EVIDENCE_WIDTH = 21/21
HISTORICAL_MALFORMED_TARGETED_PAGE_EVIDENCE_DIRECTLY_PARSED = 0
R2_SUPERSEDED_EXECUTION_AUTHORITY_USED = 0
```

All R2 semantic/accounting/adversarial hard gates remain required.

## Stop/HOLD

```text
HOLD_AUTHORITY_DRIFT
HOLD_INPUT_IDENTITY
HOLD_INPUT_TRANSPORT
PARTIAL_REWORK_REQUIRED
HOLD_SEMANTIC_CONTRACT_DEFECT
```

Row-level `REVIEW_HOLD` remains valid.

## Work/provider policy

```text
WORK = REQUIRED
PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
SITE_MUTATION = 0
```

## Publication

One ZIP, exactly 9 final files.

Staging:
`docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/`

Upload URL:
`https://github.com/MaksimUnimax/runtime-fixtures/upload/seo/wordstat-batch-01-2026-09-16/docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/`

## Required preparation record

```text
LIVE_HEAD = 107afe5254a0b16e050d731816fcd09b96fb7404
LEVEL1_FILES_READ = PASS
LEVEL2_README_READ = PASS
OCTOPORT_STEP_RULES_INDEX_READ = PASS
APPLICABLE_LEVEL2_FILES_READ = PASS
WORK_EVIDENCE_FILES_READ = PASS
FAILURE_HISTORY_READ = PASS
EXTERNAL_SOURCES_CHECKED = PASS / CURRENT SAME-STAGE METHOD
WORK_TRIGGER_DECISION = WORK_REQUIRED
EXACT_INPUTS = FROZEN
EXACT_OUTPUTS = FROZEN
SCHEMA_AND_LINEAGE = FROZEN
HARD_GATES = FROZEN
STOP_HOLD_REOPEN_RULES = FROZEN
PUBLICATION_PATH = FROZEN
WORK_PROMPT_ALLOWED_BEFORE_REMOTE_READBACK = false
```

After remote readback:
`M8_R3_PRE_HANDOFF_ALLOWED = true`.
