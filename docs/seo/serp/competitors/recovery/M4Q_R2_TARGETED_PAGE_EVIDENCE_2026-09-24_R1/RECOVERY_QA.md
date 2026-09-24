# M4Q R2 targeted page evidence — transport recovery QA

Date: 2026-09-24
Status: **PASS / DETERMINISTIC TRANSPORT RECOVERY / SEMANTIC CONTENT UNCHANGED**

Historical source:
`docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv`

Recovered transport:
`docs/seo/serp/competitors/recovery/M4Q_R2_TARGETED_PAGE_EVIDENCE_2026-09-24_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE_RECOVERED.tsv`

## Defect

The historical accepted TSV declares literal TAB field separator, physical newline record separator, quote semantics disabled, and escaped control characters.

The frozen Git blob violates that contract only for:
- `M4QR2TR0058`
- `M4QR2TR0059`

Each was split across four physical lines because three physical LF characters occurred inside captured visible text.

## Recovery rule

1. Header defines 21 columns.
2. Logical record begins only at `^M4QR2TR\d{4}\t`.
3. A physical line without a record ID continues the immediately preceding record.
4. Each continuation LF becomes literal `\n`.
5. No other normalization/change is allowed.

## QA

```text
SOURCE_SHA256 = 96d930d02060141a6eb9242c8079121a85359a256ff2fd39e0c4995577b05486
SOURCE_BYTES = 2602167
SOURCE_PHYSICAL_LINES = 54
SOURCE_BAD_PHYSICAL_DATA_LINES = 8

RECOVERED_SHA256 = a9ec3a14319edc0a4721e702378e910461490be1deba4136afcdf2276c2585d5
RECOVERED_BYTES = 2602161
RECOVERED_DATA_ROWS = 47
RECOVERED_UNIQUE_IDS = 47
RECOVERED_COLUMN_WIDTH = 21/21 FOR 47/47
UNMODIFIED_GOOD_ROWS_EXACT_TEXT_MATCH = 45/45

AFFECTED_RECORDS = M4QR2TR0058,M4QR2TR0059
OTHER_RECORDS_CHANGED = 0
SEMANTIC_ROWS_ADDED = 0
SEMANTIC_ROWS_REMOVED = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION = 0
```

The recovery is transport-only. The historical file remains immutable.

For M8/later consumers, use the recovered transport as current parser-safe authority and preserve the historical blob only as provenance history.