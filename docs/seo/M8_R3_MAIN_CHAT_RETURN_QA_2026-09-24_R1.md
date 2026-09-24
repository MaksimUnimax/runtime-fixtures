# Octoport SEO — M8 R3 Main Chat return QA — 2026-09-24 R1

WORK_ID: `OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3`

Status: **HOLD_RETURN_PUBLICATION_INCOMPLETE / ANALYTICAL RETURN NOT YET ACCEPTED**
Live return HEAD reviewed: `45ace0a8f18fef562a082e95776e24dc7957ce39`

## 1. Two-level QA authority

Read/re-applied before return QA:
- `docs/seo/LEVEL1/README.md`
- `docs/seo/LEVEL2/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M7_M8_SEARCH_FREEZE_AND_SEMANTIC_MASTER_RULES.md`
- `docs/seo/EXECUTION_RULES.md`
- `docs/seo/WORK_HANDOFF_RULE.md`
- M8 R3 step preparation/pre-handoff/progress
- failure ledger including OSEO-F05.

## 2. Publication membership

Required output files: 9.

Observed under:
`docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/`

Published files: **5/9**.

Present:
1. `M8_SOURCE_MANIFEST.md`
2. `M8_IDENTITY_SOURCE_XREF.tsv`
3. `M8_HOLD_REVIEW_LEDGER.tsv`
4. `M8_ADVERSARIAL_DIAGNOSTIC.tsv`
5. `M8_QA.md`

Missing:
1. `M8_RAW_OCCURRENCE_LEDGER.tsv`
2. `M8_SEMANTIC_IDENTITY_MASTER.tsv`
3. `M8_REASON_CODE_DICTIONARY.md`
4. `M8_RETURN_MANIFEST.json`

A full-tree search of the current branch found no copy of the four missing filenames elsewhere.

```text
FILES_REQUIRED = 9
FILES_PUBLISHED = 5
FILES_MISSING = 4
PUBLICATION_MEMBERSHIP_GATE = FAIL
```

## 3. Independent QA of published TSVs

### M8_IDENTITY_SOURCE_XREF.tsv

Commit-addressed remote bytes:

```text
BYTES = 4227700
SHA256 = 4559919054a3c47d2b6b875d16696dfc9fef34b1e12f845e928f93d653d20f9c
DATA_ROWS = 25229
COLUMNS = 5
MALFORMED_ROWS = 0
UNIQUE_RAW_OCCURRENCE_IDS = 25229
NONEMPTY_RAW_OCCURRENCE_IDS = 25229
UNIQUE_SEMANTIC_IDENTITY_IDS = 7905
```

This is consistent with the Work claim:
- 25,229 raw-linked occurrences;
- 7,905 raw-backed semantic identities;
- plus 8 declared BRAND_DEFENSE identities without raw lineage would total 7,913.

That final 7,913 total cannot be independently accepted until the semantic master is present.

### M8_HOLD_REVIEW_LEDGER.tsv

```text
BYTES = 3477495
SHA256 = c3f8bbabbf0aa40d9c3049aa3aea8d926661493f4fa0924f40b80ad311602e46
DATA_ROWS = 5168
COLUMNS = 9
MALFORMED_ROWS = 0
UNIQUE_SEMANTIC_IDENTITIES = 5168

blocking_for_m9:
  YES_FOR_THIS_IDENTITY = 5064
  NO = 104

NO rows:
  NONBLOCKING_PRODUCT_CLAIM_BOUNDARY = 104
```

This matches the declared semantic distribution structurally:
- 5,064 REVIEW_HOLD identities;
- 104 WORKING identities with a nonblocking product-claim boundary.

The exact master-state join is still unaccepted until `M8_SEMANTIC_IDENTITY_MASTER.tsv` is present.

### M8_ADVERSARIAL_DIAGNOSTIC.tsv

```text
BYTES = 291584
SHA256 = 0d45d35bc9a5ccf83cfdc75f099dfd400ff54bafccee7d310ec3e64364a0f443
DATA_ROWS = 697
COLUMNS = 9
MALFORMED_ROWS = 0
UNIQUE_DIAGNOSTIC_IDS = 697
UNIQUE_SEMANTIC_IDENTITIES = 681
changed_by_diagnostic.YES = 21
changed_by_diagnostic.NO = 676
```

This independently matches the Work summary:
`ADVERSARIAL_DIAGNOSTIC_ROWS = 697`,
`IDENTITIES_CHANGED_AFTER_ADVERSARIAL_QA = 21`.

## 4. Published QA/source-manifest review

`M8_QA.md` and `M8_SOURCE_MANIFEST.md` are present and internally consistent with the Work summary for:
- 26/26 direct TSV preflight;
- malformed direct physical rows = 0;
- recovered page evidence 47/47 × 21/21;
- 25,229 primary occurrence accounting;
- 7,913 stated semantic identities;
- state counts 104 / 5064 / 2737 / 8;
- M6 HOLD ancestry;
- AI/M5 exclusion;
- no M9/page/IA decisions;
- no provider/web/GitHub writes by Work.

These are producer assertions until cross-checked against the missing primary outputs.

## 5. Hard gates that cannot yet be independently verified

Missing `M8_RAW_OCCURRENCE_LEDGER.tsv` blocks:
- actual 25,229 raw-ledger content verification;
- source-layer row equation from the returned file;
- raw field preservation;
- raw->identity ID consistency.

Missing `M8_SEMANTIC_IDENTITY_MASTER.tsv` blocks:
- 7,913 identity-row count verification;
- WORKING / REVIEW_HOLD / EXCLUDED / BRAND_DEFENSE state sum;
- mandatory master schema;
- every identity state/reason;
- product-fit/intent/priority/family distributions;
- deterministic semantic-ID verification;
- xref->master referential integrity;
- adversarial changed-state verification.

Missing `M8_REASON_CODE_DICTIONARY.md` blocks:
- `REASON_CODES_ALL_DEFINED = true` independent verification;
- reason namespace/state compatibility;
- evidence/forbidden-inference/reopen rules.

Missing `M8_RETURN_MANIFEST.json` blocks:
- exact eight-output bytes/SHA-256 reconciliation;
- return-manifest row counts;
- complete artifact identity;
- ZIP-return identity crosscheck.

## 6. Current verdict

```text
WORK_ANALYTICAL_VERDICT_REPORTED = PASS
MAIN_CHAT_ACCEPTANCE = HOLD_RETURN_PUBLICATION_INCOMPLETE

PRESENT_FILES_QA = PASS_SO_FAR
MISSING_FILES = 4
WORK_RERUN_REQUIRED = false
REUPLOAD_EXISTING_5_REQUIRED = false

M8 = NOT_ACCEPTED
M9 = BLOCKED
```

This is a publication completeness HOLD, not evidence of a semantic defect in the Work result.

## 7. Exact recovery action

Upload exactly these four unpacked files to the existing R3 staging directory:

- `M8_RAW_OCCURRENCE_LEDGER.tsv`
- `M8_SEMANTIC_IDENTITY_MASTER.tsv`
- `M8_REASON_CODE_DICTIONARY.md`
- `M8_RETURN_MANIFEST.json`

Do not rerun Work and do not replace the five already published files unless their original Work files differ from the GitHub copies.

After the four files exist:
`REMOTE READBACK -> FULL HASH/ROW/JOIN QA -> QUALITY SCORE -> ACCEPT | REWORK | HOLD`.
