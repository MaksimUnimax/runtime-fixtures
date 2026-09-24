# Octoport SEO — M8 blocked-input transport recovery pre-step — 2026-09-24 R1

Status: **PREPARED / RECOVERY PUBLICATION ALLOWED AFTER REMOTE READBACK**
Branch: `seo/wordstat-batch-01-2026-09-16`
LIVE_HEAD: `0ad808196e3d371a61a2fb579daa59aba7e9bcbf`

## 1. Trigger

ChatGPT Work R2 stopped correctly with:

`HOLD_SEMANTIC_CONTRACT_DEFECT`.

Affected frozen input:

`docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv`

Historical Git blob:
`c2aaf2d18784e0386d044621c9409225b1efe4a4`

Historical SHA-256:
`96d930d02060141a6eb9242c8079121a85359a256ff2fd39e0c4995577b05486`

## 2. Two-level authority

LEVEL 1 read:
- `LEVEL1/README.md`
- `EXECUTION_RULES.md`
- `WORK_HANDOFF_RULE.md`

LEVEL 2 read:
- `LEVEL2/README.md`
- `LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `LEVEL2/M7_M8_SEARCH_FREEZE_AND_SEMANTIC_MASTER_RULES.md`

Current M7/M8 state and failure history read.

No external research is required: this is a deterministic parser/transport recovery over an immutable frozen Git blob, not a changing SEO/provider-method question.

## 3. Defect proof

Accepted M4Q source manifest declares:
- TAB field separator;
- physical newline record separator;
- quote semantics disabled;
- control chars reversibly escaped.

Raw frozen bytes contradict that declaration only for:
- `M4QR2TR0058`;
- `M4QR2TR0059`.

Observed frozen-file facts:

```text
SOURCE_BYTES = 2602167
SOURCE_PHYSICAL_LINES = 54
HEADER_COLUMNS = 21
EXPECTED_LOGICAL_PAGE_ROWS = 47
BAD_PHYSICAL_DATA_LINES = 8
```

Each affected logical record starts on a 19-column physical line and has three continuation physical lines before the next `M4QR2TRxxxx` record.

## 4. Recovery rule

Historical Work-return remains immutable.

Create a recovery authority under:

`docs/seo/serp/competitors/recovery/M4Q_R2_TARGETED_PAGE_EVIDENCE_2026-09-24_R1/`

Required files:

1. `M4Q_R2_TARGETED_PAGE_EVIDENCE_RECOVERED.tsv`
2. `RECOVERY_QA.md`
3. `RECOVERY_MANIFEST.json`

Deterministic reconstruction:

```text
HEADER defines 21 columns.
A logical record begins only at ^M4QR2TR\d{4}\t.
A physical line not beginning with a record ID is a continuation
of the immediately preceding logical record.
Each continuation physical LF is encoded as literal \n.
No other character/content normalization is allowed.
```

## 5. Expected recovery QA

```text
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

Expected recovered SHA-256 from preparation diagnostic:
`a9ec3a14319edc0a4721e702378e910461490be1deba4136afcdf2276c2585d5`

This expected hash must be recomputed after the gate; mismatch = HOLD.

## 6. Freeze correction policy

Do NOT mutate the historical M7 R1 manifest silently.

After recovery publication:
- create a versioned M7 transport-correction overlay;
- map the historical malformed input to the recovered parser-safe authority;
- preserve the original blob as provenance history;
- do not add a second evidence universe;
- supersede M8 R2 direct manifest/preparation/prompt;
- issue M8 R3 only after corrected freeze/direct-input readback.

## 7. Stop conditions

`HOLD_RECOVERY_AMBIGUITY` if record boundaries are not unique.

`HOLD_RECOVERY_HASH_MISMATCH` if regenerated recovery differs from the expected deterministic hash.

`HOLD_RECOVERY_ROW_ACCOUNTING` if 47/47 or 21-column QA fails.

## 8. Verdict

```text
RECOVERY_METHOD = FROZEN
HISTORICAL_SOURCE_MUTATION = forbidden
RECOVERY_PUBLICATION_ALLOWED_BEFORE_READBACK = false
```

After commit + remote readback:
`RECOVERY_PUBLICATION_ALLOWED = true`.
