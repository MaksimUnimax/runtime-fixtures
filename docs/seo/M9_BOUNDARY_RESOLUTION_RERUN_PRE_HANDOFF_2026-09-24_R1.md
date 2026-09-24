# Octoport SEO — M9 boundary-resolution full rerun — PRE-HANDOFF — 2026-09-24 R1

WORK_ID: `OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1`
ROADMAP_STAGE: `M9 / W2.1 FULL RERUN`
Status: **READY FOR WORK PROMPT AFTER REMOTE READBACK**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
CURRENT_REMOTE_HEAD: `88602f27d91c5494b34b2e90b84728f95de61cb4`

## Accepted chain

```text
M0..M8 = ACCEPTED
M9 R2 = ACCEPTED_BOUNDED_AUTHORITY
M9 BOUNDARY-RESOLUTION PRE-ACQ = ACCEPTED
M9 WAVE1 PROVIDER LIFECYCLE = PASS_COMPLETE
M9 WAVE1 COMPLETE EXPORT = ACCEPTED
M9 WAVE1 TOP20 OVERLAP PROJECTION = ACCEPTED

M10A = BLOCKED
```

## Binding rerun manifest

`docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_INPUT_MANIFEST_2026-09-24_R1.json`

Blob:
`028f632cc01e4cef27d9dbcbbe19db3b83fe94de`.

Base R2 manifest:
`docs/seo/M9_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-24_R2.json`
blob `424f2e61c54388c90fb5cc91495f7f5c8f81898b`.

## New Search authority

Current anchor map:
`docs/seo/M9_BOUNDARY_RESOLUTION_SEARCH_ANCHOR_MAP_2026-09-24_R1.tsv`
blob `5c9aa993f9d17c1434deb0da059e316a98da54f1`.

```text
OLD_CURRENT_SEARCH_ANCHORS = 22
NEW_WAVE1_SEARCH_ANCHORS = 25
CURRENT_SEARCH_ANCHORS = 47
NO_CURRENT_EXACT_SERP = 57
```

Expected complete-pair comparability after rerun:

```text
BOTH_CURRENT_SERP = C(47,2) = 1081
ONE_CURRENT_SERP = 47 * 57 = 2679
NO_CURRENT_SERP = C(57,2) = 1596
TOTAL = 5356
```

Comparability deltas relative to accepted M9 R2:

```text
OLD_NEW: 550 pairs ONE -> BOTH
NEW_NEW: 300 pairs NO -> BOTH
NEW_REMAINING: 1425 pairs NO -> ONE

CHANGED_COMPARABILITY = 2275
UNCHANGED_COMPARABILITY = 3081
```

## Search overlap evidence

Old 22:
`M4Q_R2_SERP_RESULT_LEDGER.tsv`
blob `41041493677627bfaf30de8eb7ec88a52ceb0a91`.

New 25:
`docs/seo/serp/raw/M9_BOUNDARY_RESOLUTION_WAVE1_2026-09-24_R1/M9BR_WAVE1_TOP20_URL_DOMAIN.tsv.gz.b64`
blob `cb2d10581aff2810549fc1a9841b51edb652d428`.

Decoded new projection:

```text
ROWS = 500
INDICES = 0..24
RANKS = 1..20 per index
TSV_BYTES = 45666
TSV_SHA256 = b01d9c0ccbbfb2c7cfcb5af33762c7d9a74c686c2102e5d1419e1bf97491bb95
```

Projection remote decode/readback = PASS.

## Frozen vs recomputed pair fields

Accepted M9 R2 pairwise ledger:
`docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2/M9_PAIRWISE_CLUSTER_EVIDENCE.tsv`
blob `1ed11a2f135e7f7a8749c80be9efb971e267eda2`.

Freeze for every pair unless an actual input-identity defect is proven:
- pair_id and pair members;
- canonical texts;
- preliminary families;
- user_task_relation;
- intent_relation;
- marketplace_scope_relation;
- product_fit_relation;
- result_page_type_relation.

Recompute for **all 5,356 pairs**, not only the 2,275 comparability changes:
- Search comparability;
- current query IDs;
- exact URL/domain overlap metrics;
- Search evidence refs;
- evidence grade;
- pair decision;
- pair reason code;
- rationale;
- claim boundary.

Then rebuild HOLD ledger and clusters from scratch.

## Page-type boundary

The 25 new Search anchors create **no new page-type authority**.

Do not infer page type from:
- Search titles;
- snippets;
- URLs;
- raw XML;
- normalized result content.

Accepted R2 page-type relation remains frozen.

## Method

Use the accepted R2 method unchanged:
- exact URL overlap > domain overlap;
- Search overlap is evidence, not an automatic verdict;
- no universal numeric overlap threshold;
- zero overlap alone never proves split;
- complete-link / fail-closed clustering;
- external material HOLD forbids retained state;
- no transitive overmerge.

Do not create a new clustering method.

## Hard execution boundary

```text
PROVIDER_CALLS = 0
WEB_ACQUISITION = 0
WORDSTAT_EXECUTION = 0
YANDEX_SEARCH_EXECUTION = 0
ALICE_INPUT_ROWS = 0
GENSEARCH_EXECUTION = 0
GITHUB_WRITES_BY_WORK = 0
M10A_PAGE_OWNERSHIP_DECISIONS = 0
URL_H1_TITLE_IA_DECISIONS = 0
```

No partial pair patch.

## Outputs — exactly 9

1. `M9_SOURCE_MANIFEST.md`
2. `M9_IDENTITY_ELIGIBILITY_LEDGER.tsv`
3. `M9_PAIRWISE_CLUSTER_EVIDENCE.tsv`
4. `M9_CLUSTER_MASTER.tsv`
5. `M9_CLUSTER_MEMBERSHIP.tsv`
6. `M9_HOLD_BOUNDARY_LEDGER.tsv`
7. `M9_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M9_QA.md`
9. `M9_RETURN_MANIFEST.json`

Work returns one ZIP with exactly those 9 files and does not write GitHub.

Owner staging after return:
`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/`

## Downstream stop

Do not continue to M10A.

Main Chat must independently full-volume audit the Work return and explicitly accept the new M9 authority first.
