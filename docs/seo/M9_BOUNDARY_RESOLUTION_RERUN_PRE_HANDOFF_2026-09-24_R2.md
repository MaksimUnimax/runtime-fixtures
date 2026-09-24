# Octoport SEO — M9 boundary-resolution full rerun after Wave-2 — PRE-HANDOFF — 2026-09-24 R2

WORK_ID: `OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2`
ROADMAP_STAGE: `M9 / W2.2 FULL SEARCH-AUTHORITY RERUN`
Status: **READY FOR WORK PROMPT AFTER REMOTE READBACK**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
PREPARATION_PARENT_HEAD: `cdcf95dff34cc92630044e251da205b2c12bbd38`

## Accepted chain

```text
M0..M8 = ACCEPTED
M9 R2 = ACCEPTED_BOUNDED_AUTHORITY
M9 BOUNDARY-RESOLUTION PRE-ACQ = ACCEPTED
M9 WAVE1 = ACCEPTED
M9 FULL RERUN R1 = PASS_WITH_HOLD_BOUNDARIES / MAIN CHAT ACCEPTED
M9 WAVE2 = 18/18 SEARCH EVIDENCE ACCEPTED
M10A = BLOCKED
```

## Binding input manifest

`docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_INPUT_MANIFEST_2026-09-24_R2.json`
blob `fb010d0fd96750a3cec3f3d2efa2ae504e5b88d6`.

## Current Search authority

```text
OLD_CURRENT_SEARCH_ANCHORS_BEFORE_WAVE2 = 47
NEW_WAVE2_SEARCH_ANCHORS = 18
CURRENT_SEARCH_ANCHORS = 65
NO_CURRENT_EXACT_SERP = 39

BOTH_CURRENT_SERP = C(65,2) = 2080
ONE_CURRENT_SERP = 65 * 39 = 2535
NO_CURRENT_SERP = C(39,2) = 741
TOTAL = 5356

OLD47_NEW18: 846 ONE -> BOTH
NEW18_NEW18: 153 NONE -> BOTH
NEW18_REMAINING39: 702 NONE -> ONE
CHANGED_COMPARABILITY_VS_R1 = 1701
UNCHANGED_COMPARABILITY_VS_R1 = 3655
```

Current 65-anchor map:
`docs/seo/M9_BOUNDARY_RESOLUTION_SEARCH_ANCHOR_MAP_2026-09-24_R2.tsv`
blob `32b6ec36c1707808519d7f885f511f4258f117e1`.

Wave-2 current overlap projection:
`docs/seo/serp/raw/M9_BOUNDARY_RESOLUTION_WAVE2_2026-09-24_R1/M9BR_WAVE2_TOP20_URL_DOMAIN.tsv.gz.b64`
blob `427185ac67687352f318f2a7f73b81fce3acd22b`.

```text
ROWS = 360
INDICES = 0..17
RANKS = 1..20 per index
DECODED_TSV_BYTES = 32421
DECODED_TSV_SHA256 = d4ff38e0cdb4869bd6968314facd6f5bdeffd45fac5d37a8b43845f2a45f4c2b
TOP10_UNIQUE_URLS = 10/10 FOR 18/18
TOP20_UNIQUE_URLS = 20/20 FOR 18/18
```

## Frozen baseline

Accepted R1 pairwise baseline:
`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_PAIRWISE_CLUSTER_EVIDENCE.tsv`
blob `e1c3e6adcc2763296d87a9863620154d8fed0963`.

Freeze all non-Search pair fields. Recompute Search-dependent fields, evidence grade, decision, HOLD ledger and clusters for all 5,356 pairs. Do not patch only the 1,701 comparability changes.

Wave-2 Search evidence creates no new page-type authority. Search result titles/snippets/URLs/domains/raw XML must not be used to invent page type.

## Execution boundary

```text
PROVIDER_CALLS = 0
BRIDGE_COMMANDS = 0
WEB_ACQUISITION = 0
WORDSTAT_EXECUTION = 0
YANDEX_SEARCH_EXECUTION = 0
ALICE_INPUT_ROWS = 0
GENSEARCH_EXECUTION = 0
GITHUB_WRITES_BY_WORK = 0
M10A_PAGE_OWNERSHIP_DECISIONS = 0
URL_H1_TITLE_IA_DECISIONS = 0
```

Required Work return remains exactly nine files: source manifest, identity eligibility, full 5,356 pairwise ledger, cluster master, membership, HOLD ledger, adversarial diagnostic, QA, return manifest.

Owner staging after Work return:
`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/`

Main Chat must independently audit the complete Work return before M10A can open.
