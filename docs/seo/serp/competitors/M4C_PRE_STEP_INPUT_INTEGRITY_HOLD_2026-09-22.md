# Octoport SEO — M4C pre-step input-integrity HOLD

Date: 2026-09-22
Status: **HOLD / ACCEPTED R3 ARTIFACT PERSISTENCE RECOVERY REQUIRED**

## 1. Current accepted upstream state

```text
M4A = ACCEPTED
M4B1 = ACCEPTED
M4B2 = ACCEPTED
M4Q = ACCEPTED_WITH_SOURCE_LIMITATION
M4C = PREPARATION_HOLD
```

M4Q ranking-query lane remains:
`SOURCE_UNAVAILABLE_DECLARED_LIMITATION`.

## 2. Exact blocker

M4B1 R3 was executed and its result was consumed as accepted baseline by R4.

Accepted R3 facts preserved by R4 authority:

```text
AUTHORIZED_ENTITIES = 45
ACCEPTED_ANCHORS = 100
PRE_R3_NORMALIZED_URL_UNIVERSE = 1612
R3_NEW_IN_SCOPE_NORMALIZED_IDENTITIES = 2888
R3_NEW_INSPECTED_IDENTITIES = 2845
R3_EXECUTION_ENVIRONMENT_FAILURE_TERMINALS = 43
POST_R3_MERGED_NORMALIZED_URL_UNIVERSE = 4500
OPEN_URL_UNRESOLVED = 0
SILENT_URL_LOSS = 0
R3_CHANNEL_COVERAGE_ROWS = 45
R3_BLOCKING_CHANNEL_HOLD = 47
R3_ENTITIES_WITH_BLOCKING_HOLD = 39
```

However, the current durable repository directory:

`docs/seo/serp/competitors/work_return/M4B1_COVERAGE_CLOSURE_2026-09-18_R3/`

contains only the pre-existing staging `README.md`.

The nine accepted R3 Work outputs are not present there.

## 3. Required original R3 outputs

Exactly these accepted Work artifacts must be restored without new crawl or regeneration:

1. `M4B1R3_SOURCE_MANIFEST.md`
2. `M4B1R3_DISCOVERY_CHANNEL_COVERAGE.tsv`
3. `M4B1R3_URL_OVERLAY.tsv`
4. `M4B1R3_PAGE_EVIDENCE_OVERLAY.tsv`
5. `M4B1R3_CANDIDATE_TERMS_OVERLAY.tsv`
6. `M4B1R3_ENTITY_SYNTHESIS_CURRENT.tsv`
7. `M4B1R3_FRONTIER_RECONCILIATION.tsv`
8. `M4B1R3_QA.md`
9. `M4B1R3_RETURN_MANIFEST.json`

These files were explicitly used as R4 inputs in the accepted R4 execution context.

## 4. Why M4C cannot start yet

M4C is a full-volume cross-phase synthesis.

Current visible page-evidence phases do not contain the R3 page-level corpus:

```text
R1 PAGE_EVIDENCE = 249
R2 PAGE_EVIDENCE = 579
R4 PAGE_EVIDENCE DELTA = 7
R5 PAGE_EVIDENCE DELTA = 5455

R3 PAGE_EVIDENCE = 2845  <-- accepted but not durably present in current GitHub staging
```

Starting M4C without R3 would silently omit accepted evidence and violate the large-data / provenance / persistence rules.

## 5. Recovery boundary

This is **persistence recovery only**.

Forbidden:
- new R3 crawl;
- replaying R3 acquisition;
- fabricating/reconstructing missing page rows from summaries;
- treating R4 aggregate counts as a substitute for the missing R3 page-evidence corpus;
- starting M4C Work on the incomplete durable input set.

Required:
- recover the original R3 ZIP or the original nine unpacked files;
- upload the nine files unchanged into the existing R3 work_return directory;
- remote-read back file set / manifest / identities;
- then resume M4C preparation.

## 6. Current cursor

```text
M4A = ACCEPTED
M4B1 = ACCEPTED
M4B2 = ACCEPTED
M4Q = ACCEPTED_WITH_SOURCE_LIMITATION

M4C_PREPARATION = HOLD_R3_ARTIFACT_PERSISTENCE_RECOVERY
M4C_WORK_START_ALLOWED = false
M7 = BLOCKED
```
