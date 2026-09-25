# Octoport SEO — M11 Main Chat acceptance — 2026-09-25 R1

Status: **ACCEPTED / FINAL PAGE OWNERSHIP + IA CLOSED / M12 PREFLIGHT OPEN**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

WORK_ID:
`OCTOPORT_SEO_M11_FINAL_PAGE_OWNERSHIP_IA_2026-09-25_R1`

## Publication lineage

```text
HANDOFF_HEAD = f781ff4a42a5f4f7b89dfbb19634be846eb29ec3
OWNER_UPLOAD_HEAD = ce48daed4b1963af68cdb42b818495f6cdce9649
OWNER_UPLOAD_PARENT = f781ff4a42a5f4f7b89dfbb19634be846eb29ec3
OWNER_UPLOAD_COMMITS_OVER_HANDOFF = 1
OWNER_UPLOAD_CHANGED_FILES = 11
OWNER_UPLOAD_PATH_SCOPE = docs/seo/work_return/M11_FINAL_PAGE_OWNERSHIP_IA_2026-09-25_R1/**
```

Exactly eleven required unpacked files were uploaded and no unrelated path changed.

## Work return identities

- `M11_ADVERSARIAL_DIAGNOSTIC.tsv` blob `eadd118df5342f8d03f7594d725176b4bfdc5362`
- `M11_CANNIBALIZATION_GUARD.tsv` blob `fa2b55c3091638a7b2d709389f66f05b8f7fe7aa`
- `M11_CLUSTER_FINAL_OWNERSHIP.tsv` blob `cf70289cb4399cd688798042fc05299119110ab2`
- `M11_EXISTING_SURFACE_DECISION.tsv` blob `876223cf28a323298de69cac64e106e295653f95`
- `M11_IA_EDGE_REGISTRY.tsv` blob `3563777b060c6168e60cec89ed086ce8c89616bb`
- `M11_MATERIAL_HOLD_RESOLUTION.tsv` blob `adff5c99708c2be441f14e6b542a012cc7c4bc40`
- `M11_PAGE_OWNER_REGISTRY.tsv` blob `068032bcd1ac4ae894f0778f991472661010d680`
- `M11_PAIRWISE_OWNER_COMPATIBILITY.tsv` blob `7291d10e24817d00b1931dd03aa0c1ccfae8928c`
- `M11_QA.md` blob `2f8be6aa929b502724027606d12fb89103b888f9`
- `M11_RETURN_MANIFEST.json` blob `00fe9b13b267741c3c22333debe7c43d60fd1824`
- `M11_SOURCE_MANIFEST.md` blob `2a91651985a6a90aea21955c4c8c48f548c684e4`

Owner-reported ZIP SHA-256:
`62a9eefb1c872f3a6d204d971d25c36d018840505d786260e6a5e541fd983307`.

## Independent Main Chat return-manifest QA

```text
RETURN_FILES = 11/11
RETURN_MANIFEST_NON_SELF_SHA256 = PASS
RETURN_MANIFEST_NON_SELF_BYTES = PASS
RETURN_MANIFEST_NON_SELF_LINES = PASS
RETURN_MANIFEST_TSV_ROWS_COLUMNS = PASS

CLUSTER_ROWS = 104/104
EXACT_M9_CLUSTER_SET = PASS
EXACT_M10A_CLUSTER_SET = PASS
M8_MEMBER_JOIN_FIELDS = PASS
M9_CLUSTER_FIELDS = PASS
M10A_FROZEN_FIELDS = PASS

OWNER_ASSIGNED = 2
HOLD_NO_FINAL_OWNER = 102
PAGE_OWNER_REGISTRY_ROWS = 2
PLANNED_OWNER_ROWS = 1
EXISTING_OWNER_ROWS = 1
OWNER_REGISTRY_MEMBER_PARTITION = PASS
PLANNED_OWNER_ID_SHA256_RECOMPUTE = PASS

PAIRWISE_ROWS = 5356/5356
PAIRWISE_M9_30_COLUMN_PREFIX = EXACT
MERGE_SUPPORTED = 28/28
SPLIT_SUPPORTED = 3835/3835
HOLD_BOUNDARY = 1493/1493
PAIRWISE_OWNER_ID_MAPPING = PASS
PAIRWISE_DISPOSITION_MAPPING = PASS
MERGE_SEPARATE_OWNER_VIOLATIONS = 0
SPLIT_SAME_OWNER_VIOLATIONS = 0

MATERIAL_HOLD_ROWS = 1399/1399
MATERIAL_HOLD_M10A_20_COLUMN_PREFIX = EXACT
MATERIAL_HOLD_OWNER_ID_MAPPING = PASS
MATERIAL_PAIRS_WITH_BOTH_ENDPOINTS_ASSIGNED = 0
NON_OWNER_UNRESOLVED = 1399/1399
IMPLICIT_MATERIAL_HOLD_RESOLUTION = 0

EXISTING_SURFACE_ROWS = 4/4
EXISTING_SURFACE_M10A_PREFIX = EXACT
SITE_BLOB_DRIFT = 0

IA_EDGES = 2
IA_EDGE_ID_SHA256_RECOMPUTE = PASS
INVALID_IA_ENDPOINTS = 0
SELF_EDGES = 0
DUPLICATE_EDGE_TUPLES = 0
PARENT_CHILD_CYCLES = 0
ORPHAN_ASSIGNED_INDEXABLE_OWNERS = 0

CANNIBALIZATION_GUARD_ROWS = 3
DUPLICATE_PAGE_PURPOSE = 0
FAKE_CREATE = 0
PRODUCT_TRUTH_CONFLICT = 0

ADVERSARIAL_IDS = 24/24 EXACT
ADVERSARIAL_PASS = 24/24
```

## Accepted analytical owners

### 1. Existing HOME

```text
PAGE_OWNER_ID = M11PAGE_EXISTING_HOME
CLUSTER = M9CL_3f05678ef9d62960
QUERY/TASK = подключить ии к маркетплейсу
ROUTE = HOME
ACTION = KEEP
PRIORITY = P1_CORE
```

Independent evidence check:
- accepted M8: exact organic Search observation;
- Product Truth: chosen user AI -> Octoport -> permitted Ozon/WB seller data;
- current physical HOME explicitly explains this connector task;
- M10D Case02 = DE_RISK / NARROW_HOLD, but owner is not based on AI alone;
- all eight material boundaries incident to this owner terminate on HOLD clusters.

Current HOME remains byte-identical:
`3123a714e2092fb156eebe498ef97bb5969567f6`.

### 2. Planned seller-owned analytics page job

```text
PAGE_OWNER_ID = M11PAGE_aaa90aa723a3694c
CLUSTER = M9CL_db048338baaeca8c
QUERY/TASK = ии для аналитики маркетплейсов
ROUTE = FEATURE_OR_USE_CASE
ACTION = CREATE
PRIORITY = P4_EXPLORATORY
```

Independent evidence check:
- accepted M8 demand state = `M2R_DIRECT_RESULT|TESTED_SEED`;
- accepted M8 Search state = `EXACT_ORGANIC_QUERY_OBSERVED`;
- product fit = `SUPPORTED_WITH_BOUNDARY`;
- user job = inspect and understand seller-owned sales/report data with selected AI;
- M10D Case09 = target-specific `DE_RISK / NARROW_HOLD`, narrowing own-store vs external-intelligence ambiguity;
- CREATE is therefore not AI-only;
- the owner group contains one cluster, so no unresolved material boundary is hidden inside the page group;
- all 39 external material boundaries terminate on clusters that remain HOLD.

Planned deterministic owner signature:
```text
FEATURE_OR_USE_CASE
GENERIC
Inspect and understand seller-owned sales and report data with an owned AI
M9CL_db048338baaeca8c
```

Recomputed:
`M11PAGE_aaa90aa723a3694c` = PASS.

## Search separation between the two owners

Exact M9 pair:
`M9PAIR_3c5ff38a5ecaf8d0`.

```text
USER_TASK_RELATION = DIFFERENT
INTENT_RELATION = SAME
MARKETPLACE_SCOPE_RELATION = SAME
SEARCH_COMPARABILITY = BOTH_CURRENT_SERP
TOP10_EXACT_URL_JACCARD = 0.052632
TOP20_EXACT_URL_JACCARD = 0.052632
PAIR_DECISION = SPLIT_SUPPORTED
PAIR_REASON = S_TASK_DIFFERENT
```

Therefore HOME and seller-owned analytics are validly separate page jobs.

## Material HOLD preservation

No material M10A boundary was force-resolved.

```text
RESOLVED_SAME_OWNER = 0
RESOLVED_SEPARATE_OWNERS = 0
REMAINS_HOLD = 0
NON_OWNER_UNRESOLVED = 1399
```

This is accepted: M11 assigns two owners while preserving every unresolved owner boundary against the 102 held clusters.

## Existing surfaces

```text
HOME = SEO_OWNER_KEEP
INSTALL = SUPPORTING_SURFACE_KEEP
PRIVACY = NO_SEARCH_TARGET_KEEP
SUPPORT = SUPPORTING_SURFACE_KEEP
```

Physical existence did not automatically create Search ownership.

## IA

Accepted required edges:
- `HOME -> planned analytics` = PARENT_CHILD;
- `planned analytics -> HOME` = CONTEXTUAL_INTERNAL_LINK.

No planned URL or final anchor text is selected.

## Adversarial wording clarification

Work AD10 says:
`all 3835 SPLIT pairs separate owners`.

Main Chat interprets the actual hard invariant more precisely:

```text
FOR EVERY SPLIT_SUPPORTED PAIR:
IF BOTH ENDPOINT CLUSTERS HAVE ASSIGNED OWNERS
THEN OWNER_A != OWNER_B.
```

Independent full-volume check:
`SPLIT_SAME_OWNER_VIOLATIONS = 0`.

Pairs with one or two HOLD endpoints correctly remain `NOT_APPLICABLE_HOLD_OWNER / NON_OWNER_PAIR`.
The TSV logic is correct; only AD10 prose was over-broad. No rework required.

## Hard boundaries

```text
M8_MUTATIONS = 0
M9_MUTATIONS = 0
M10A_MUTATIONS = 0
M10D_MUTATIONS = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
SITE_MUTATIONS = 0
FINAL_PLANNED_URLS = 0
FINAL_H1_TITLE_DESCRIPTION = 0
M12_EXECUTION = 0
FAKE_CREATE = 0
DUPLICATE_PAGE_PURPOSE = 0
PRODUCT_TRUTH_CONFLICT = 0
OPEN_CRITICAL_DEFECTS = 0
```

## Quality score

```text
1 goal/output completeness = 10/10
2 method/source support = 10/10
3 input evidence/provenance integrity = 10/10
4 coverage/completeness = 10/10
5 analytical correctness/claim boundaries = 10/10
6 adversarial QA quality = 9/10
7 persistence/readback/reproducibility = 10/10
8 owner/client usability/plain language = 9/10
9 information gain/execution efficiency = 10/10
10 downstream readiness = 10/10

QUALITY_TOTAL = 98/100
QUALITY_SCORE = 9.8/10
```

The one-point adversarial deduction is the non-blocking over-broad AD10 wording corrected above.

## Acceptance

```text
M11 = ACCEPTED
M11_FINAL_PAGE_OWNERSHIP_IA = CLOSED
ASSIGNED_PAGE_OWNERS = 2
HOLD_CLUSTERS = 102
M12_PREFLIGHT = OPEN
M12_EXECUTION = NOT_YET_RELEASED
M13+ = BLOCKED
```

M12 may now specify only the two accepted owner page jobs plus supporting existing-surface responsibilities where the M12 Level2 contract permits them.

M12 must not convert the 102 held clusters into page targets or secondary coverage without a separately accepted reopen.
