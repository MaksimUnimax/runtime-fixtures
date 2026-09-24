# M9 Search-only SERP + user-task clustering — PRE-HANDOFF R1

WORK_ID: `OCTOPORT_SEO_M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R1`
ROADMAP_STAGE: `M9 / W2`
Status: **READY FOR WORK PROMPT AFTER REMOTE READBACK**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
CURRENT_REMOTE_HEAD: `52aa508a3d18b14c840a80c165d83a5f0fcc82f3`

## WHY_WORK_REQUIRED

```text
M8_TOTAL_IDENTITIES = 7913
CLUSTER_ELIGIBLE_WORKING = 104
PAIRWISE_ROWS = 5356
DIRECT_INPUT_FILES = 18

NEEDS:
- complete 7,913-row eligibility accounting;
- complete 5,356-pair evidence matrix;
- Search URL-overlap joins;
- conflict-free clustering;
- HOLD-boundary preservation;
- independent adversarial QA.
```

Work required; no sampling.

## AUTHORITIES

Step preparation:
`docs/seo/M9_STEP_PREPARATION_2026-09-24_R1.md`
blob `6ec22f7b586b05f0987b367c3dcb4d83914c0524`

Direct manifest:
`docs/seo/M9_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-24_R1.json`
blob `5b208b4d170e01b6775772fe00fb01928fd442da`

M8 acceptance:
`docs/seo/M8_R3_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-24_R1.md`

Applicable Level 2:
`docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md`

## ALLOWED INPUTS

Exactly the 18 files in the M9 direct manifest.

Audit fallback outside the manifest is allowed only for a named provenance discrepancy and must be reported.

## PROHIBITED INPUTS

- M5 hypothesis semantic use;
- Alice / GenSearch / AI-search evidence;
- M8 REVIEW_HOLD as ordinary cluster member;
- M8 EXCLUDED as cluster member;
- M8 BRAND_DEFENSE as ordinary Search cluster member;
- new provider/web acquisition;
- lexical/preliminary-family similarity as sufficient cluster proof.

## ELIGIBILITY

Exactly 7,913 rows:

```text
CLUSTER_ELIGIBLE = 104
CARRIED_REVIEW_HOLD = 5064
EXCLUDED_NOT_CLUSTERED = 2737
BRAND_DEFENSE_SEPARATE = 8
```

Only 104 Working identities enter pairwise clustering.

## PAIRWISE UNIVERSE

Exactly:

`104 * 103 / 2 = 5356` unordered pairs.

Search evidence states:

```text
BOTH_EXACT_SERP = 231
ONE_EXACT_SERP = 1804
NO_EXACT_SERP = 3321
```

Missing SERP must not be encoded as zero overlap.

## PAIR DECISION

Exactly one per pair:

```text
MERGE_SUPPORTED
SPLIT_SUPPORTED
HOLD_BOUNDARY
```

No universal overlap threshold.

Exact URL overlap > domain overlap as evidence strength.

Merge requires task/intent/product/scope compatibility plus Search support where comparable.

## CLUSTER CONSTRUCTION

Deterministic cluster ID:

`M9CL_<first16 SHA256(sorted member semantic_identity_ids joined by newline)>`.

Retained multi-member cluster:

```text
ALL INTRA-CLUSTER PAIRS = MERGE_SUPPORTED
NO SPLIT PAIR
NO HOLD PAIR
AT LEAST ONE EXACT-SERP MEMBER
```

No transitive chain overmerge.

Cluster states:

```text
RETAINED_CLUSTER
RETAINED_SINGLETON
HOLD_CLUSTER_BOUNDARY
```

Every one of 104 eligible identities appears exactly once in membership.

## OUTPUTS — EXACTLY 9

1. `M9_SOURCE_MANIFEST.md`
2. `M9_IDENTITY_ELIGIBILITY_LEDGER.tsv`
3. `M9_PAIRWISE_CLUSTER_EVIDENCE.tsv`
4. `M9_CLUSTER_MASTER.tsv`
5. `M9_CLUSTER_MEMBERSHIP.tsv`
6. `M9_HOLD_BOUNDARY_LEDGER.tsv`
7. `M9_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M9_QA.md`
9. `M9_RETURN_MANIFEST.json`

## HARD COUNTS

```text
ELIGIBILITY_ROWS = 7913
PAIRWISE_ROWS = 5356
MEMBERSHIP_ROWS = 104
PAIRWISE_DUPLICATES = 0
PAIRWISE_SELF_PAIRS = 0
IDENTITY_MULTI_CLUSTER_MEMBERSHIP = 0
```

## REQUIRED FAIL-CLOSED CHECKS

```text
MISSING_SERP_AS_ZERO_OVERLAP = 0
UNIVERSAL_OVERLAP_THRESHOLD_USED = 0
PRELIMINARY_FAMILY_AS_CLUSTER_PROOF = 0
LEXICAL_SIMILARITY_AS_CLUSTER_PROOF = 0

RETAINED_CLUSTER_INTERNAL_SPLIT_PAIR = 0
RETAINED_CLUSTER_INTERNAL_HOLD_PAIR = 0
RETAINED_MULTIMEMBER_CLUSTER_WITHOUT_SEARCH_ANCHOR = 0

M8_REVIEW_HOLD_CLUSTERED = 0
M8_EXCLUDED_CLUSTERED = 0
M8_BRAND_DEFENSE_ORDINARY_CLUSTERED = 0

ALICE_INPUT_ROWS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0
```

## ADVERSARIAL QA

Must test chain-overmerge, giant F3 cluster, Search/page-type conflicts, no-SERP merges, marketplace overmerge, commercial-vs-informational mixing, F1-vs-F2 mixing, report-vs-ad-analysis, singleton proliferation, internal pair conflicts and accidental admission of non-eligible M8 states.

Systematic defect:
`FIX MECHANISM -> RERUN COMPLETE 5,356 PAIRS -> SIBLING CHANGE REPORT`.

## STOP CONDITIONS

```text
HOLD_AUTHORITY_DRIFT
HOLD_INPUT_IDENTITY
HOLD_PAIRWISE_ACCOUNTING
HOLD_CLUSTER_CONTRACT_DEFECT
```

Cluster-level HOLD is valid.

## WORK / PROVIDER POLICY

```text
WORK = REQUIRED
PROVIDER_CALLS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES_BY_WORK = 0
ALICE_CALLS = 0
```

## PUBLICATION

One ZIP, exactly 9 final files.

Owner staging:
`docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R1/`

Upload URL:
`https://github.com/MaksimUnimax/runtime-fixtures/upload/seo/wordstat-batch-01-2026-09-16/docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R1/`

## HANDOFF VERDICT

```text
WORK_ID = OCTOPORT_SEO_M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R1
ROADMAP_STAGE = M9 / W2
WHY_WORK_REQUIRED = FROZEN
ALLOWED_INPUT_FILES = FROZEN
PROHIBITED_INPUTS = FROZEN
EXACT_EXECUTION_GOAL = FROZEN
REQUIRED_OUTPUT_FILES = 9
PAIRWISE_UNIVERSE = 5356
SCHEMA_AND_LINEAGE = FROZEN
HARD_GATES = FROZEN
STOP_CONDITIONS = FROZEN
PUBLICATION_POLICY = FROZEN
WORK_PROMPT_ALLOWED_BEFORE_THIS_FILE_READBACK = false
```
