# Octoport SEO — M10D Search-vs-AI reconciliation — PRE-HANDOFF — 2026-09-25 R1

WORK_ID: `OCTOPORT_SEO_M10D_SEARCH_VS_AI_RECONCILIATION_2026-09-25_R1`
ROADMAP_STAGE: `M10D SEARCH-vs-AI RECONCILIATION`
Status: **READY FOR CANONICAL WORK PROMPT AFTER REMOTE READBACK**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
PRE_HANDOFF_PARENT_HEAD: `83e2c1cb31f714dad2f81900fe42e181496facac`

Step preparation:
`docs/seo/M10D_STEP_PREPARATION_2026-09-25_R1.md`
blob `04990733b31a943dc26213a9b622b5d7fb2b39d5`.

Binding input manifest:
`docs/seo/M10D_SEARCH_VS_AI_RECONCILIATION_INPUT_MANIFEST_2026-09-25_R1.json`
blob `6b4139e7e715e6f23bd435f9a3864f882477139e`.

Accepted M10C:
`docs/seo/M10C_MAIN_CHAT_ACCEPTANCE_2026-09-25_R1.md`
blob `179dd999133fba7eeeaad83e3d72876c79dcda90`.

Accepted M10C evidence manifest:
`docs/seo/M10C_ACCEPTED_EVIDENCE_MANIFEST_2026-09-25_R1.json`
blob `5a07366b653b7c0db6b49a791dfe739e900724f8`.

## Frozen accounting

```text
M10D_CASES = 15
M10C_RAW_SNAPSHOTS = 27
M10B_CASE_CLUSTER_XREF_ROWS = 184
M10B_CASE_BOUNDARY_XREF_ROWS = 166
M10B_UNIQUE_BOUNDARY_PAIR_IDS = 155
M10A_CLUSTER_ROWS = 104
M10A_BOUNDARY_ROWS = 1399
SHARED_CLUSTER_TARGETS = 63
SHARED_BOUNDARY_TARGETS = 11
CROSS_CASE_TARGETS_TOTAL = 74
```

Every case must receive exactly one:
`CHANGE | ENRICH | DE_RISK | NO_CHANGE | HOLD`.

No quota or desired distribution exists.

## Large-file note

`M10A_CANNIBALIZATION_BOUNDARY.tsv`
blob `aafa9698cc1cc83751699ac45048b53d5505f96b`
is 1,557,644 bytes / 1,400 lines.

The ordinary GitHub text connector may render it as empty due to size. Work must read the actual file from the fetched Git checkout and verify:
```text
DATA_ROWS = 1399
COLUMNS = 20
```
Failure to read the actual file -> `HOLD_INPUT_READ`.

## Output contract

Exactly nine final files:
1. `M10D_SOURCE_MANIFEST.md`
2. `M10D_CASE_EVIDENCE_SUMMARY.tsv`
3. `M10D_CASE_RECONCILIATION.tsv`
4. `M10D_CLUSTER_DELTA_XREF.tsv`
5. `M10D_BOUNDARY_DELTA_XREF.tsv`
6. `M10D_CROSS_CASE_RECONCILIATION.tsv`
7. `M10D_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M10D_QA.md`
9. `M10D_RETURN_MANIFEST.json`

Owner staging:
`docs/seo/work_return/M10D_SEARCH_VS_AI_RECONCILIATION_2026-09-25_R1/`

## Hard boundary

```text
PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
M10A_MUTATIONS = 0
M10B_MUTATIONS = 0
M10C_MUTATIONS = 0
FINAL_PAGE_OWNER_ASSIGNMENTS = 0
FINAL_KEEP_OPTIMIZE_CREATE_ROUTE_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0
```

M11 remains blocked until Main Chat independently QA's and accepts the M10D return.
