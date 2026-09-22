# Octoport SEO — M4C GitHub Web transport correction R1

Date: 2026-09-22
Status: ACTIVE / TRANSPORT-ONLY CORRECTION
WORK_ID: `OCTOPORT_SEO_M4C_SYNTHESIS_2026-09-22_R1`

## Incident

The owner attempted the released M4C Work return upload through GitHub Web.

GitHub Web rejected oversized files with the browser limit error.

Official GitHub limits:
- browser upload: max 25 MiB per file;
- regular Git push: files over 100 MiB are blocked;
- larger files require Git LFS.

Sources:
- https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github

Affected logical M4C files:

```text
M4C_PAGE_EVIDENCE.tsv
bytes = 34206423
sha256 = e0433463f29daf4d2bec1dccd3fec541e9263161672c752898be18c18e7fa175

M4C_TASK_CAPABILITY_CLAIM_CONTENT_MATRIX.tsv
bytes = 185122964
sha256 = e45d2e6640d7b366b354ca66e19affcce04c8b2b18629905cfd020f9a2d6bebe
```

The second file also exceeds GitHub's regular-Git 100 MiB hard limit.

## Owner partial upload

Owner GitHub Web commit:

`cc4a30a742b2544eb1e52e40b14d97a2c29fb79d`

The following six final logical files were accepted unchanged:

- M4C_COMPETITOR_CANDIDATE_REGISTER.tsv
- M4C_COVERAGE_LEDGER.tsv
- M4C_HARDENED_COMPETITOR_REGISTRY.tsv
- M4C_M5_AI_HYPOTHESIS_INPUTS.tsv
- M4C_M6_DEMAND_GAP_CANDIDATES.tsv
- M4C_URL_LEDGER.tsv

They must not be re-uploaded or recomputed.

## Correction

This correction changes persistence transport only.

```text
ANALYTICAL_RESULT_CHANGED = false
WORK_RERUN_REQUIRED = false
LOGICAL_M4C_OUTPUTS = 11
```

The two oversized TSVs are stored as ordered, line-aligned, byte-exact parts, each safely below 25 MiB.

Reconstruction is direct binary concatenation in lexical part order.

No repeated header is inserted into later parts.

The reconstructed logical file MUST match the original Work byte count and SHA-256 exactly.

Repository-side transport manifest:
`work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_GITHUB_WEB_TRANSPORT_MANIFEST.json`

Repository-side reconstruction helper:
`work_return/M4C_SYNTHESIS_2026-09-22_R1/REASSEMBLE_M4C_OVERSIZED.py`

## Required remaining owner upload

Upload only:
- M4C_QA.md
- M4C_RETURN_MANIFEST.json
- M4C_SOURCE_MANIFEST.md
- M4C_PAGE_EVIDENCE.tsv.part001
- M4C_PAGE_EVIDENCE.tsv.part002
- M4C_TASK_CAPABILITY_CLAIM_CONTENT_MATRIX.tsv.part001 ... part009

Total owner payload files: 14.

All are below GitHub Web's 25 MiB per-file limit.

## Acceptance rule

After owner upload Main Chat must:

1. remote-read back all 14 new files plus the six already-uploaded logical files;
2. verify every physical part against the transport manifest;
3. reconstruct the two oversized logical TSV byte streams from ordered parts;
4. prove reconstructed original bytes + SHA-256 match Work:
   - PAGE_EVIDENCE = 34206423 bytes / e0433463...
   - MATRIX = 185122964 bytes / e45d2e66...
5. verify the other logical files against M4C_RETURN_MANIFEST.json;
6. independently verify row/accounting/claim-boundary gates;
7. only then ACCEPT / REWORK / HOLD.

```text
M4C_WORK_RESULT = REPORTED_PASS
M4C_REMOTE_PERSISTENCE = PARTIAL_PENDING_TRANSPORT_COMPLETION
M4C_ACCEPTED = false
NEXT = OWNER_UPLOAD_REMAINING_14_FILES
```
