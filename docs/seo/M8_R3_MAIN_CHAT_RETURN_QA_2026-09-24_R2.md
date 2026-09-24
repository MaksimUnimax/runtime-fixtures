# Octoport SEO — M8 R3 Main Chat return QA — 2026-09-24 R2

WORK_ID: `OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3`

Status: **HOLD_RETURN_PUBLICATION_INCOMPLETE / 8 OF 9 PUBLISHED / SEMANTIC QA PASSED SO FAR**

Live HEAD reviewed:
`01e347acb0cae098335c4db46aea526e8003517b`

## Publication state

Required: 9 files.
Published: 8 files.
Missing: 1 file.

Only missing:
`M8_RAW_OCCURRENCE_LEDGER.tsv`

Return manifest says:

```text
EXPECTED_BYTES = 76810357
EXPECTED_SHA256 = 2091432f5eb131b425349954f0518cc8122e98461d932d9b2d7de64e6828bcfc
EXPECTED_LINES = 25230
EXPECTED_DATA_ROWS = 25229
```

GitHub browser upload cannot accept this file because it exceeds the browser per-file limit; this is publication transport only, not a Work analytical defect.

## Return-manifest identity checks for published non-self outputs

All seven published non-self outputs listed in `M8_RETURN_MANIFEST.json` match exact Work-return bytes and SHA-256:

```text
M8_SOURCE_MANIFEST.md = PASS
M8_SEMANTIC_IDENTITY_MASTER.tsv = PASS
M8_IDENTITY_SOURCE_XREF.tsv = PASS
M8_REASON_CODE_DICTIONARY.md = PASS
M8_HOLD_REVIEW_LEDGER.tsv = PASS
M8_ADVERSARIAL_DIAGNOSTIC.tsv = PASS
M8_QA.md = PASS
```

The eighth non-self artifact, `M8_RAW_OCCURRENCE_LEDGER.tsv`, remains unavailable for remote byte/hash verification.

## Semantic master independent QA

```text
MASTER_ROWS = 7913
MASTER_COLUMNS = 36
MALFORMED_MASTER_ROWS = 0
UNIQUE_SEMANTIC_IDS = 7913

WORKING = 104
REVIEW_HOLD = 5064
EXCLUDED = 2737
BRAND_DEFENSE = 8

EMPTY_SEMANTIC_ID = 0
EMPTY_PRIMARY_STATE = 0
EMPTY_PRIMARY_REASON = 0

MANDATORY_COLUMNS_MISSING = 0
```

State sum:
`104 + 5064 + 2737 + 8 = 7913` PASS.

## XREF -> master referential integrity

```text
XREF_ROWS = 25229
XREF_MALFORMED_ROWS = 0
UNIQUE_RAW_OCCURRENCE_IDS = 25229
XREF_UNIQUE_SEMANTIC_IDS = 7905
XREF_IDS_NOT_IN_MASTER = 0

MASTER_IDS_WITHOUT_XREF = 8
MASTER_IDS_WITHOUT_XREF_STATE = BRAND_DEFENSE 8/8
```

This exactly matches the permitted no-raw-lineage BRAND_DEFENSE exception.

## Deterministic semantic identity QA

For all 7,905 raw-backed semantic identities:

```text
M8SID = first16 lowercase SHA256(sorted unique member_exact_safe_keys joined with newline)
M8SID_MISMATCH = 0
```

Deterministic identity gate PASS.

## HOLD ledger -> master QA

```text
HOLD_LEDGER_ROWS = 5168
HOLD_MALFORMED_ROWS = 0
UNKNOWN_MASTER_IDS = 0
STATE_MISMATCH = 0

YES_FOR_THIS_IDENTITY = 5064
  -> REVIEW_HOLD = 5064/5064

NO = 104
  -> WORKING = 104/104
  -> hold_class = NONBLOCKING_PRODUCT_CLAIM_BOUNDARY 104/104
```

## Adversarial -> master QA

```text
ADVERSARIAL_ROWS = 697
MALFORMED_ROWS = 0
UNKNOWN_MASTER_IDS = 0
changed_by_diagnostic.YES = 21
changed_by_diagnostic.NO = 676
```

Matches Work summary.

## Priority/state QA

Allowed state/tier mapping checked across all 7,913 master rows.

```text
PRIORITY_STATE_MISMATCH = 0
```

Observed:

```text
REVIEW_HOLD -> NA_REVIEW_HOLD = 5064
EXCLUDED -> NA_EXCLUDED = 2737
BRAND_DEFENSE -> NA_BRAND_DEFENSE = 8
WORKING -> P1_CORE/P3_SUPPORTING/P4_EXPLORATORY = 104
```

## Reason code QA

```text
REASON_CODES_USED = 33
REASON_CODES_DEFINED = 33
UNDEFINED_REASON_CODES = 0
REASON_STATE_MISMATCH = 0
```

Reason dictionary contract passes for the published master.

## Current hard-gate state

Already independently supported by published files:

```text
SEMANTIC_IDENTITY_ROWS = 7913 PASS
STATE_SUM = PASS
EVERY_IDENTITY_HAS_STATE_REASON = PASS
REASON_CODES_ALL_DEFINED = PASS
XREF_ROWS = 25229 PASS
UNLINKED_BY_XREF_STRUCTURE = 0
MASTER/XREF_REFERENTIAL_INTEGRITY = PASS
BRAND_DEFENSE_LINEAGE_EXCEPTION = PASS
HOLD/MASTER_JOIN = PASS
ADVERSARIAL/MASTER_JOIN = PASS
PRIORITY/STATE_COMPATIBILITY = PASS
DETERMINISTIC_SEMANTIC_IDS = PASS
```

Still blocked solely by missing raw ledger remote publication:

- exact returned raw-ledger bytes/SHA;
- exact 25,229 row transport;
- primary source-layer equation from the returned ledger;
- raw field preservation;
- raw-ledger raw_occurrence_id -> XREF exact equality;
- complete return artifact membership 9/9.

## Current verdict

```text
WORK_RERUN_REQUIRED = false
SEMANTIC_REWORK_REQUIRED_SO_FAR = false
PUBLISHED_8_OF_9_QA = PASS
MAIN_CHAT_ACCEPTANCE = HOLD_RETURN_PUBLICATION_INCOMPLETE
M8 = NOT YET ACCEPTED
M9 = BLOCKED
```

Once the original Work-produced raw ledger is published byte-exactly, Main Chat completes the final raw/join/hash QA and quality score.
