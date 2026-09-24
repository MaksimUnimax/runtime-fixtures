# Octoport SEO — M8 R2 Work HOLD return — 2026-09-24

WORK_ID: `OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R2`

Status: **HOLD_SEMANTIC_CONTRACT_DEFECT / NO ZIP / NOT ACCEPTED**

```text
START_HEAD = 0ad808196e3d371a61a2fb579daa59aba7e9bcbf
END_OBSERVED_HEAD = 0ad808196e3d371a61a2fb579daa59aba7e9bcbf
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED
VERDICT = HOLD_SEMANTIC_CONTRACT_DEFECT

M7_FROZEN_FILES = 162/162 MATCH
R2_DIRECT_INPUT_IDENTITIES = 46/46 MATCH
PRIMARY_RAW_OCCURRENCES_PRELIMINARY_ACCOUNTING = 25229/25229
M8_SEMANTIC_MASTER = NOT_ACCEPTED
PROVIDER_CALLS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES = 0
FILES_IN_ZIP = 0
```

## Blocking defect

Input:
`docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv`

Records:
`M4QR2TR0058`, `M4QR2TR0059`.

R2 parser contract required physical newline record boundaries with quote semantics disabled, but the frozen input contains physical LF characters inside those two records.

Work correctly stopped rather than inventing a repair.

## Resolution

Current recovery authority:
`docs/seo/serp/competitors/recovery/M4Q_R2_TARGETED_PAGE_EVIDENCE_2026-09-24_R1/`

Current M7 correction:
`docs/seo/M7_SEARCH_SIDE_COLLECTION_FREEZE_CORRECTION_2026-09-24_R2.md`

R2 outputs remain unaccepted.
M8 must restart under R3 corrected input authority.
