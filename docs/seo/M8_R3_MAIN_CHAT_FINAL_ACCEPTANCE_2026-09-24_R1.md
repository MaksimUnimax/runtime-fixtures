# Octoport SEO — M8 R3 Main Chat final acceptance — 2026-09-24 R1

WORK_ID: `OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3`

Status: **PASS / SEARCH-ONLY SEMANTIC MASTER ACCEPTED**
Branch: `seo/wordstat-batch-01-2026-09-16`
FINAL_QA_HEAD: `aa9d8ddf410367ac9def3faff761891ff424d5ed`

## 1. Two-level acceptance authority

Re-read on the current branch before final acceptance:

- `docs/seo/LEVEL1/README.md`
  blob `4c3a30644ac736b926ec82bba6b1a6e33434ac06`
- `docs/seo/LEVEL2/M7_M8_SEARCH_FREEZE_AND_SEMANTIC_MASTER_RULES.md`
  blob `1e29a2af8440084c5890e1b397167cc384154d85`
- `docs/seo/WORK_HANDOFF_RULE.md`
  blob `71a031e74b921dade5998beb842fb3afcc4478e7`

Current method authority is unchanged.

## 2. Publication completeness

Staging:

`docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/`

Required files: 9.
Published files: 9.

Published:

1. `M8_SOURCE_MANIFEST.md`
2. `M8_RAW_OCCURRENCE_LEDGER.tsv`
3. `M8_SEMANTIC_IDENTITY_MASTER.tsv`
4. `M8_IDENTITY_SOURCE_XREF.tsv`
5. `M8_REASON_CODE_DICTIONARY.md`
6. `M8_HOLD_REVIEW_LEDGER.tsv`
7. `M8_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M8_QA.md`
9. `M8_RETURN_MANIFEST.json`

```text
FILES_REQUIRED = 9
FILES_PUBLISHED = 9
PUBLICATION_MEMBERSHIP_GATE = PASS
```

## 3. Return-manifest byte/hash reconciliation

All eight non-self outputs exactly match `M8_RETURN_MANIFEST.json`.

```text
M8_SOURCE_MANIFEST.md
  bytes = 14517
  sha256 = 8a531afd81f2691638d7c806e2d1731573df414ce0ca58312ad7850cad5bcd58

M8_RAW_OCCURRENCE_LEDGER.tsv
  bytes = 76810357
  sha256 = 2091432f5eb131b425349954f0518cc8122e98461d932d9b2d7de64e6828bcfc

M8_SEMANTIC_IDENTITY_MASTER.tsv
  bytes = 11405030
  sha256 = 7de172d2e7742472d364d771b3b162c8795bd7c25fa2b147756e3122a6a5d22b

M8_IDENTITY_SOURCE_XREF.tsv
  bytes = 4227700
  sha256 = 4559919054a3c47d2b6b875d16696dfc9fef34b1e12f845e928f93d653d20f9c

M8_REASON_CODE_DICTIONARY.md
  bytes = 29415
  sha256 = e2bd0ed1194c38277fcd3c0b94166a2ab5251def51821221e70e3224198d5c46

M8_HOLD_REVIEW_LEDGER.tsv
  bytes = 3477495
  sha256 = c3f8bbabbf0aa40d9c3049aa3aea8d926661493f4fa0924f40b80ad311602e46

M8_ADVERSARIAL_DIAGNOSTIC.tsv
  bytes = 291584
  sha256 = 0d45d35bc9a5ccf83cfdc75f099dfd400ff54bafccee7d310ec3e64364a0f443

M8_QA.md
  bytes = 9876
  sha256 = 7b72e104980e0f1d40924c09db5cfc9bb2c8b63e6f611aaef38b5ca5a5caf297
```

```text
RETURN_MANIFEST_NONSELF_HASH_MATCH = 8/8
RETURN_MANIFEST_NONSELF_BYTE_MATCH = 8/8
```

## 4. Raw occurrence ledger — full-volume QA

Independent Main Chat commit-addressed readback:

```text
RAW_BYTES = 76810357
RAW_SHA256 = 2091432f5eb131b425349954f0518cc8122e98461d932d9b2d7de64e6828bcfc
PHYSICAL_LINES = 25230
DATA_ROWS = 25229
COLUMNS = 13
MALFORMED_ROWS = 0
UNIQUE_RAW_OCCURRENCE_IDS = 25229
RAW_BACKED_SEMANTIC_IDS = 7905
```

Source-layer equation:

```text
M2R = 1123
M4Q_R2_QUERY_UNIVERSE = 15542
M4C_COMPETITOR_CANDIDATE = 8431
M4Q_R2_TARGETED_DELTA = 133

TOTAL = 25229
```

## 5. Raw source preservation regression

Main Chat independently compared all 25,229 returned raw rows against the four frozen primary source files at M7 frozen HEAD.

For every row checked:

- deterministic `raw_occurrence_id`;
- `source_native_id`;
- `raw_text`;
- `source_status`;
- recomputed exact-safe key;
- parsed `source_original_fields_json` versus the complete original source row.

Results:

```text
M2R_ROWS_CHECKED = 1123
M4Q_QUERY_UNIVERSE_ROWS_CHECKED = 15542
M4C_CANDIDATE_ROWS_CHECKED = 8431
TARGETED_DELTA_ROWS_CHECKED = 133

RAW_ID_MISMATCH = 0
SOURCE_NATIVE_ID_MISMATCH = 0
RAW_TEXT_MISMATCH = 0
SOURCE_STATUS_MISMATCH = 0
EXACT_SAFE_KEY_MISMATCH = 0
SOURCE_ORIGINAL_FIELDS_JSON_PARSE_ERROR = 0
SOURCE_ORIGINAL_FIELDS_JSON_CONTENT_MISMATCH = 0

TOTAL_SOURCE_PRESERVATION_MISMATCH = 0
```

This independently closes `RAW_LINEAGE_LOSS = 0` and `SILENT_ROW_LOSS = 0`.

## 6. RAW ↔ XREF exact join

```text
RAW_ROWS = 25229
XREF_ROWS = 25229
RAW_UNIQUE_IDS = 25229
XREF_UNIQUE_RAW_IDS = 25229

RAW_ID_MISSING_IN_XREF = 0
XREF_EXTRA_RAW_ID = 0
RAW/XREF_SEMANTIC_ID_MISMATCH = 0
RAW/XREF_EXACT_SAFE_KEY_MISMATCH = 0
```

The ordered pair/triple control hashes calculated independently from the uploaded raw ledger matched the published XREF.

## 7. Semantic master QA

```text
SEMANTIC_IDENTITY_ROWS = 7913
COLUMNS = 36
MALFORMED_ROWS = 0
UNIQUE_SEMANTIC_IDS = 7913

WORKING = 104
REVIEW_HOLD = 5064
EXCLUDED = 2737
BRAND_DEFENSE = 8

STATE_SUM_EQUALS_IDENTITY_ROWS = true
EMPTY_SEMANTIC_ID = 0
EMPTY_PRIMARY_STATE = 0
EMPTY_PRIMARY_REASON = 0
MANDATORY_COLUMNS_MISSING = 0
```

State equation:

`104 + 5064 + 2737 + 8 = 7913` PASS.

## 8. Semantic identity determinism

For all 7,905 raw-backed semantic identities, Main Chat independently recomputed:

`M8SID_<first16 lowercase SHA256(sorted unique member exact_safe_keys joined by newline)>`.

```text
RAW_BACKED_IDENTITIES = 7905
DETERMINISTIC_M8SID_MISMATCH = 0
```

XREF/master referential integrity:

```text
XREF_SEMANTIC_IDS_NOT_IN_MASTER = 0
MASTER_IDS_WITHOUT_XREF = 8
MASTER_IDS_WITHOUT_XREF_STATE = BRAND_DEFENSE 8/8
```

The only no-raw-lineage identities are the explicitly permitted product brand-defense identities.

## 9. HOLD ledger QA

```text
HOLD_LEDGER_ROWS = 5168
MALFORMED_ROWS = 0
UNKNOWN_MASTER_IDS = 0
STATE_MISMATCH = 0

YES_FOR_THIS_IDENTITY = 5064
  -> REVIEW_HOLD = 5064/5064

NO = 104
  -> WORKING = 104/104
  -> NONBLOCKING_PRODUCT_CLAIM_BOUNDARY = 104/104
```

The high HOLD count is explicit uncertainty, not hidden failure.

These REVIEW_HOLD identities do not silently enter M9 as ordinary Working candidates.

## 10. Reason-code QA

```text
REASON_CODES_USED = 33
REASON_CODES_DEFINED = 33
UNDEFINED_REASON_CODES = 0
REASON_STATE_MISMATCH = 0
```

All state/reason namespaces reconcile.

## 11. Priority/state QA

Observed priority states:

```text
REVIEW_HOLD -> NA_REVIEW_HOLD = 5064
EXCLUDED -> NA_EXCLUDED = 2737
BRAND_DEFENSE -> NA_BRAND_DEFENSE = 8

WORKING:
  P1_CORE = 8
  P3_SUPPORTING = 1
  P4_EXPLORATORY = 95
```

```text
PRIORITY_STATE_MISMATCH = 0
```

No state was promoted solely from frequency, rank or competitor recurrence.

## 12. Independent adversarial QA

```text
ADVERSARIAL_ROWS = 697
MALFORMED_ROWS = 0
UNIQUE_DIAGNOSTIC_IDS = 697
UNKNOWN_MASTER_IDS = 0

changed_by_diagnostic.YES = 21
changed_by_diagnostic.NO = 676
```

All 21 actual changes were fail-closed:

```text
EXCLUDED -> REVIEW_HOLD = 7
WORKING -> REVIEW_HOLD = 14
```

Root causes included:
- incomplete source fragments;
- current-policy/action ambiguity;
- unsupported actions/endpoints;
- unproven named LLM adapters.

Work reports:
`SIBLING_CHANGE_REPORT = 21 expected changed identities, zero unexpected state changes`.

No adversarial fix promoted an uncertain identity into WORKING.

## 13. M6 / evidence-boundary regression

Producer QA and Main Chat joins support:

```text
M6_HOLD_ANCESTRY_ACCOUNTED = true
M6_HOLD_PROMOTED_TO_NON_HOLD = 0
PRODUCT_CAPABILITY_HOLD_ESCALATED_WITHOUT_AUTHORITY = 0
PROVIDER_FAILURE_AS_ZERO_DEMAND = 0
SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_TOPIC_AS_DEMAND = 0
DEFAULT_KEEP = 0
```

## 14. AI / downstream contamination

```text
ALICE_INPUT_ROWS = 0
AI_SOURCE_USED_FOR_SEARCH_RELEVANCE = 0
AI_SOURCE_USED_FOR_SEARCH_INTENT = 0
AI_SOURCE_USED_FOR_PRIORITY = 0
M5_HYPOTHESIS_USED_AS_SEARCH_TRUTH = 0
PROHIBITED_SEMANTIC_INPUT_USED = 0

FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0
```

M8 remains independently Search-only.

## 15. R3 transport regression

```text
DIRECT_TSV_FILES_SCANNED = 26/26
DIRECT_TSV_FILES_PASS = 26/26
MALFORMED_DIRECT_TSV_PHYSICAL_LINES = 0

RECOVERED_TARGETED_PAGE_EVIDENCE_ROWS = 47/47
RECOVERED_TARGETED_PAGE_EVIDENCE_WIDTH = 21/21
HISTORICAL_MALFORMED_TARGETED_PAGE_EVIDENCE_DIRECTLY_PARSED = 0
R2_SUPERSEDED_EXECUTION_AUTHORITY_USED = 0
```

OSEO-F05 regression PASS.

Oversized return publication recovery:
- original raw ledger ultimately published byte-exactly;
- no semantic regeneration;
- no Work rerun;
- Git blob `50f4e750a446dfa7907c13d576d04e071255dfd2`.

OSEO-F06 regression recorded.

## 16. Hard-gate verdict

```text
LEVEL1_READ = PASS
APPLICABLE_LEVEL2_READ = PASS
FULL_VOLUME_ACCOUNTING = PASS
RAW_LINEAGE_LOSS = 0
SILENT_ROW_LOSS = 0
EVERY_IDENTITY_HAS_STATE_REASON = true
DEFAULT_KEEP = 0
UNCERTAINTY_EXPLICIT = true
COUNTS/JOINS/REASON_CODES = RECONCILED
INDEPENDENT_SEMANTIC_QA = PASS
ALICE_CONTAMINATION = 0
CURRENT_AUTHORITY_UNAMBIGUOUS = true
GITHUB_REMOTE_READBACK = PASS
OPEN_CRITICAL_DEFECTS = 0
```

All mandatory M8 hard gates PASS.

## 17. Main Chat quality score

| Dimension | Score /10 |
|---|---:|
| goal/output completeness | 10.0 |
| method/source support | 9.5 |
| evidence/provenance integrity | 10.0 |
| coverage/completeness | 10.0 |
| analytical correctness/claim boundaries | 9.5 |
| adversarial QA | 10.0 |
| persistence/readback/reproducibility | 9.5 |
| owner usability | 9.0 |
| information gain/execution efficiency | 9.3 |
| downstream readiness | 9.5 |

```text
QUALITY_TOTAL = 96.3 / 100
M8_CURRENT_SCORE = 9.63 / 10
QUALITY_GATE = PASS
```

The owner-usability deduction reflects the oversized-artifact publication recovery; it does not affect semantic correctness.

## 18. Final verdict

```text
WORK_VERDICT = PASS
MAIN_CHAT_RETURN_QA = PASS
M8 = PASS
M8_SEARCH_ONLY_SEMANTIC_MASTER = ACCEPTED

RAW_OCCURRENCE_ROWS = 25229/25229
SEMANTIC_IDENTITY_ROWS = 7913
WORKING = 104
REVIEW_HOLD = 5064
EXCLUDED = 2737
BRAND_DEFENSE = 8

OPEN_CRITICAL_DEFECTS = 0
M9_BLOCKED_BY_M8 = false
M9_PREPARATION_ALLOWED = true
```

This acceptance does **not** authorize immediate M9 execution.

Next:
`M9 TWO-LEVEL STEP PREPARATION -> fresh clustering-method research -> exact M9 contract -> Work decision -> only then clustering`.
