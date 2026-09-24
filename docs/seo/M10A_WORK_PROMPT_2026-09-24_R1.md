# M10A Search-only query->page / IA baseline — canonical ChatGPT Work prompt — R1

WORK_ID: `OCTOPORT_SEO_M10A_SEARCH_ONLY_PAGE_IA_BASELINE_2026-09-24_R1`

CONTINUE THE EXISTING OCTOPORT SEO PROGRAM.

THIS IS AN EXECUTION TASK.
THIS IS M10A SEARCH-ONLY QUERY->PAGE / IA BASELINE FREEZE ONLY.

THIS IS NOT A NEW PROJECT.
THIS IS NOT M9 REWORK.
THIS IS NOT M10B AI CASE SELECTION.
THIS IS NOT M10C ALICE / AI ACQUISITION.
THIS IS NOT M10D RECONCILIATION.
THIS IS NOT M11 FINAL PAGE OWNERSHIP.
THIS IS NOT URL / H1 / TITLE DESIGN.
THIS IS NOT SITE IMPLEMENTATION.

Repository: `MaksimUnimax/runtime-fixtures`
SEO branch: `seo/wordstat-batch-01-2026-09-16`
Current-site source branch: `main`
Prompt preparation parent HEAD: `8ee79eb21d6c9b16950da9aebe76261418f876f6`

======================================================================
0. ROADMAP / CURRENT CURSOR
======================================================================

```text
M0..M8 = ACCEPTED
M9 SEARCH-ONLY CLUSTERING / BOUNDARY RESOLUTION = ACCEPTED
M9 TERMINAL SEARCH-ONLY HOLD RECONCILIATION = ACCEPTED
M10A_SEARCH_BASELINE_GATE = OPEN_WITH_EXPLICIT_HOLDS

CURRENT PHYSICAL STEP =
M10A SEARCH-ONLY QUERY->PAGE / IA BASELINE FREEZE

M10B = BLOCKED UNTIL MAIN CHAT ACCEPTS THIS RETURN
M10C/D = BLOCKED
M11+ = BLOCKED
```

Goal:
freeze exactly what ordinary Search evidence alone currently authorizes for query->page ownership and IA, while preserving explicit HOLD where Search-only authority is insufficient.

Accepted current authority is intentionally all-HOLD at cluster ownership level. Do not manufacture owners/pages/IA to make the baseline look complete.

======================================================================
1. FIRST ACTION — LIVE PREFLIGHT
======================================================================

Fetch the live SEO branch and record `START_HEAD`.

Fetch the live `main` branch and record `START_SITE_MAIN_HEAD`.

Required current site main HEAD:
`f079c2e7199250397259ea9ede10a4f72694f5c1`.

If live `main` HEAD differs:
`HOLD_CURRENT_SITE_SOURCE_DRIFT`.

Do not silently use newer site source. Main Chat must re-freeze the current-site overlay first.

Read in full.

LEVEL 1:
- `docs/seo/LEVEL1/README.md`
- `docs/seo/EXECUTION_RULES.md`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md`
- `docs/seo/WORK_HANDOFF_RULE.md`
- `docs/seo/METHODOLOGY.md`
- `docs/seo/PRODUCT_TRUTH.md`

LEVEL 2:
- `docs/seo/LEVEL2/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M5_M10_SEARCH_ONLY_AND_ALICE_SEQUENCE_RULES.md`
- `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md`

Current stage authority:
- `docs/seo/M10A_PROGRESS.md`
- `docs/seo/M10A_STEP_PREPARATION_2026-09-24_R1.md`
- `docs/seo/M10A_SEARCH_ONLY_PAGE_IA_INPUT_MANIFEST_2026-09-24_R1.json`
- `docs/seo/M10A_PRE_HANDOFF_2026-09-24_R1.md`
- `docs/seo/M10A_CURRENT_SITE_SOURCE_OVERLAY_2026-09-24_R1.md`
- `docs/seo/M9_TERMINAL_HOLD_RECONCILIATION_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`

Failure history:
- `docs/seo/FAILURE_LEDGER.md`

Binding identities:
```text
M10A_PROGRESS_BLOB = 1c0e467e8a9b1bac7b391795172486d4c6b5b77e
STEP_PREPARATION_BLOB = ea07a677d59150f6519a8893c135eb0f81d496a7
INPUT_MANIFEST_BLOB = 4ab96efc02cf81198599caaf81dcd5f601d8ba0d
PRE_HANDOFF_BLOB = beed81e788fb642d2fa3c7dd7a8006fbd9fe1496
CURRENT_SITE_OVERLAY_BLOB = b5f41ff4d0db562cc2346b672e412880585188ef
M9_TERMINAL_ACCEPTANCE_BLOB = f35e5132d64ade78ce6c8fb8a2aea2292f41c02a
M9H_CARRY_BLOB = 8fbc7b9669b19838a58efa7a6d8213dbc073b707
M9H_MATERIAL_HOLD_BLOB = 6aba4c4716d57605af9f2ae3b11b77db701d8ba1
M9_CLUSTER_MASTER_BLOB = 5d9d86bf87a3c6306db496a577b954ea0cfe4efc
M9_CLUSTER_MEMBERSHIP_BLOB = 7df5d573e823c3eea49f0010ad13b78d0a396215
PRODUCT_TRUTH_BLOB = 6a469d5743142d3e476afa5d2cda653fd411ecb8
M1_BASELINE_BLOB = f13d34fe7c29746a4ee275935432a29689dcf1df
```

Any mismatch -> `HOLD_INPUT_IDENTITY`.

======================================================================
2. FROZEN CURRENT SITE SOURCE
======================================================================

Use only exact source at:
`main@f079c2e7199250397259ea9ede10a4f72694f5c1`.

Required source identities:
```text
apps/site/public/index.html
blob 3123a714e2092fb156eebe498ef97bb5969567f6
canonical https://octoport.ru/

apps/site/public/install.html
blob 99bc456742375219779ae9c611580e389b81c7a1
canonical https://octoport.ru/install

apps/site/public/privacy.html
blob bb975f29e3fbe8e1cfeb1fa19f397f9e5dc1f101
canonical https://octoport.ru/privacy

apps/site/public/support.html
blob 2ebb8fdab73c50d98a3af70198f98813cbab942b
canonical https://octoport.ru/support

apps/site/public/robots.txt
blob 446df898e31b99b230e8a49a7c94a45e4df96228

apps/site/public/sitemap.xml
blob fdceb2ff477941104373850846c33bac2a5d3ced
```

These are SOURCE facts only.

Do NOT claim all four are deployed/indexed.
Do NOT mutate source.
Do NOT add them to sitemap.
Do NOT treat physical existence as Search ownership.

======================================================================
3. IMMUTABLE M9 SEARCH-ONLY AUTHORITY
======================================================================

Direct inputs:
- `docs/seo/work_return/M9_TERMINAL_HOLD_RECONCILIATION_2026-09-24_R1/M9H_M10A_CARRY_FORWARD.tsv`
- `docs/seo/work_return/M9_TERMINAL_HOLD_RECONCILIATION_2026-09-24_R1/M9H_MATERIAL_HOLD_DISPOSITION.tsv`
- `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/M9_CLUSTER_MASTER.tsv`
- `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/M9_CLUSTER_MEMBERSHIP.tsv`

Hard current state:
```text
M9_CLUSTERS = 104
M9_MEMBERSHIP_ROWS = 104
M9_CLUSTER_STATE_HOLD_CLUSTER_BOUNDARY = 104
M9H_CARRY_SEARCH_ONLY_HOLD_TO_M10A = 104
MATERIAL_HOLD_PAIRS = 1399
CURRENT_SEARCH_ANCHORS = 65
NO_CURRENT_EXACT_SERP = 39
SUPPORTED_MERGE_EDGES = 28
```

Every cluster/membership row is immutable.

Do not:
- merge clusters;
- split clusters;
- change cluster IDs;
- change cluster states;
- change member IDs;
- resolve material HOLD pairs;
- infer page type from Search snippets/URLs/titles;
- introduce Alice/AI evidence.

======================================================================
4. M10A SEARCH-ONLY BASELINE RULE
======================================================================

Level-2 requires for each M9 cluster:
- provisional primary page owner OR HOLD;
- page role/type;
- existing vs planned relation;
- parent/child IA relationship;
- internal-link responsibility;
- cannibalization boundary;
- explicit HOLD where insufficient.

Current M9 terminal closure explicitly carries 104/104 clusters as HOLD.

Therefore, under current authority, all 104 baseline rows must preserve:
```text
search_owner_state = HOLD_NO_SEARCH_ONLY_OWNER
provisional_primary_page_owner = NONE_HOLD
page_role_type = HOLD_NOT_AUTHORIZED_BY_SEARCH_ONLY_BASELINE
existing_page_relation = NO_EXISTING_SEARCH_OWNER_ASSIGNED
planned_page_relation = NO_PLANNED_SEARCH_PAGE_AUTHORIZED
parent_child_ia_state = HOLD_NOT_AUTHORIZED
internal_link_responsibility_state = HOLD_NOT_AUTHORIZED
carry_forward_state = CARRY_SEARCH_ONLY_HOLD_TO_M10A
```

This is not a shortcut.
It is the accepted Search-only result.

Do not assign `/`, `/install`, `/privacy`, `/support` merely because they exist.
Do not create a synthetic future URL/page.

======================================================================
5. CURRENT SITE SURFACE LEDGER
======================================================================

Produce exactly 4 rows, one for each frozen source page.

Required columns:
```text
source_path
canonical_url
source_blob
source_branch
source_head
source_surface_role
sitemap_listed
current_physical_surface_state
m9_search_owner_implied
search_owner_state
m10a_mutation_authorized
evidence_refs
claim_boundary
```

Required `search_owner_state` for 4/4:
`CURRENT_PHYSICAL_SURFACE_ONLY_NO_M9_SEARCH_OWNER_IMPLIED`.

`m9_search_owner_implied = false` for 4/4.
`m10a_mutation_authorized = false` for 4/4.

Sitemap-listed:
- `/` = true;
- install/privacy/support = false.

Source role must come only from current source content/overlay, not Search inference.

======================================================================
6. CLUSTER PAGE / IA BASELINE
======================================================================

Produce exactly 104 rows, one per accepted M9 cluster/member.

Required columns:
```text
cluster_id
cluster_state
semantic_identity_id
canonical_cluster_label
primary_user_job
intent_primary
marketplace_scope
product_fit_boundary
current_search_anchor_state
current_query_id
current_material_hold_degree
supported_merge_degree
search_owner_state
provisional_primary_page_owner
page_role_type
existing_page_relation
planned_page_relation
parent_child_ia_state
internal_link_responsibility_state
cannibalization_boundary_state
carry_forward_state
m10b_reopen_trigger
upstream_refs
claim_boundary
```

Copy cluster/member/search/degree fields from frozen accepted authority; recompute/join independently and verify.

All 104 rows:
```text
cluster_state = HOLD_CLUSTER_BOUNDARY
search_owner_state = HOLD_NO_SEARCH_ONLY_OWNER
provisional_primary_page_owner = NONE_HOLD
page_role_type = HOLD_NOT_AUTHORIZED_BY_SEARCH_ONLY_BASELINE
existing_page_relation = NO_EXISTING_SEARCH_OWNER_ASSIGNED
planned_page_relation = NO_PLANNED_SEARCH_PAGE_AUTHORIZED
parent_child_ia_state = HOLD_NOT_AUTHORIZED
internal_link_responsibility_state = HOLD_NOT_AUTHORIZED
carry_forward_state = CARRY_SEARCH_ONLY_HOLD_TO_M10A
```

`cannibalization_boundary_state`:
- if current_material_hold_degree > 0 -> `OPEN_MATERIAL_PAGE_BOUNDARIES`;
- if current_material_hold_degree = 0 -> `HOLD_CLUSTER_WITHOUT_MATERIAL_PAIR`.

Expected:
```text
POSITIVE_MATERIAL_HOLD_DEGREE_CLUSTERS = 103
ZERO_MATERIAL_HOLD_DEGREE_CLUSTERS = 1
```

`m10b_reopen_trigger` must only state what later evidence would be needed; it must not select an AI case or write an AI prompt.

======================================================================
7. CANNIBALIZATION / PAGE-BOUNDARY LEDGER
======================================================================

Produce exactly 1,399 rows, exact pair-id set equal to accepted M9H material HOLD disposition.

Required columns:
```text
pair_id
cluster_id_a
cluster_id_b
semantic_identity_id_a
semantic_identity_id_b
canonical_text_a
canonical_text_b
anchor_availability_class
current_query_id_a
current_query_id_b
terminal_search_only_disposition
m10a_boundary_state
same_page_authorized
separate_page_authorized
owner_state_a
owner_state_b
carry_forward_state
reopen_trigger
evidence_refs
claim_boundary
```

Hard for all 1,399:
```text
m10a_boundary_state = HOLD_PAGE_OWNERSHIP_BOUNDARY
same_page_authorized = false
separate_page_authorized = false
owner_state_a = HOLD_NO_SEARCH_ONLY_OWNER
owner_state_b = HOLD_NO_SEARCH_ONLY_OWNER
carry_forward_state = CARRY_SEARCH_ONLY_HOLD_TO_M10A
```

Do not convert:
- `TERMINAL_CURRENT_SEARCH_CONFLICT` into SAME_PAGE or SEPARATE_PAGE;
- `HOLD_NO_SAFE_EXACT_QUERY_AUTHORITY` into SAME_PAGE or SEPARATE_PAGE.

======================================================================
8. AI / DOWNSTREAM EXCLUSION
======================================================================

Hard:
```text
M5_HYPOTHESIS_REGISTER_USED_AS_INPUT = 0
ALICE_INPUT_ROWS = 0
AI_PROVIDER_EVIDENCE_ROWS = 0
FINAL_AI_CASE_SELECTIONS = 0

M10B_EXECUTION = 0
M10C_EXECUTION = 0
M10D_EXECUTION = 0
M11_EXECUTION = 0
```

Do not read M5 hypothesis rows to influence M10A decisions.

M10A must be independently reconstructable from Search-only authority + product truth + current site.

======================================================================
9. PRODUCT TRUTH BOUNDARY
======================================================================

Use `docs/seo/PRODUCT_TRUTH.md` only to prevent unsupported page promises.

Because no Search-only page owner/page role is authorized, product truth may not be used to create a page merely because Octoport can support a task.

Hard:
`PRODUCT_CAPABILITY_AS_PAGE_CREATION_PROOF = 0`.

======================================================================
10. REQUIRED OUTPUTS — EXACTLY 7
======================================================================

1. `M10A_SOURCE_MANIFEST.md`
2. `M10A_EXISTING_SITE_SURFACE.tsv`
3. `M10A_CLUSTER_PAGE_IA_BASELINE.tsv`
4. `M10A_CANNIBALIZATION_BOUNDARY.tsv`
5. `M10A_ADVERSARIAL_DIAGNOSTIC.tsv`
6. `M10A_QA.md`
7. `M10A_RETURN_MANIFEST.json`

Exactly these seven files in one ZIP.
No scripts, caches, source copies or temporary files.

======================================================================
11. ADVERSARIAL QA
======================================================================

Independently test at least:
1. exact 104 cluster ID/member set versus accepted M9;
2. exact 1,399 material pair-id set;
3. 104/104 explicit M9H carry-forward states;
4. 65/39 anchor-state accounting;
5. 103 positive material-degree + 1 zero-degree cluster;
6. current Home is not auto-assigned to generic/high-value clusters;
7. install/privacy/support are not auto-assigned because they physically exist;
8. no planned page created from user-task/product capability alone;
9. no page role inferred from M9 Search title/snippet/URL;
10. no parent/child IA invented;
11. no internal-link owner contract invented;
12. no SAME_PAGE/SEPARATE_PAGE decision introduced for 1,399 HOLD boundaries;
13. no M5 hypothesis/Alice evidence used;
14. no final AI case selected;
15. source sitemap/current pages remain descriptive only;
16. no URL/H1/Title or site mutation.

Any mechanism defect:
```text
ROOT CAUSE
-> AFFECTED UNIVERSE
-> FIX PRODUCER
-> RERUN COMPLETE 104 + 1399 UNIVERSE
-> REGRESSION
```

No example-only patch.

======================================================================
12. HARD GATES
======================================================================

```text
EXISTING_SITE_SURFACE_ROWS = 4/4
CURRENT_SITE_SOURCE_HEAD_MATCH = true

CLUSTER_BASELINE_ROWS = 104/104
CLUSTER_ID_SET_MATCH = true
MEMBERSHIP_SET_MATCH = true
SEARCH_ANCHOR_STATE_MATCH = 104/104
MATERIAL_HOLD_DEGREE_MATCH = 104/104
SUPPORTED_MERGE_DEGREE_MATCH = 104/104

SEARCH_OWNER_HOLD = 104/104
PROVISIONAL_OWNER_NONE_HOLD = 104/104
PAGE_ROLE_HOLD = 104/104
EXISTING_SEARCH_OWNER_ASSIGNMENTS = 0
PLANNED_SEARCH_PAGE_CREATE_AUTHORIZATIONS = 0
PARENT_CHILD_IA_ASSIGNMENTS = 0
INTERNAL_LINK_OWNER_CONTRACTS = 0

POSITIVE_MATERIAL_HOLD_DEGREE_CLUSTERS = 103/103
ZERO_MATERIAL_HOLD_DEGREE_CLUSTERS = 1/1

CANNIBALIZATION_BOUNDARY_ROWS = 1399/1399
MATERIAL_HOLD_PAIR_SET_MATCH = true
HOLD_PAGE_OWNERSHIP_BOUNDARY = 1399/1399
SAME_PAGE_AUTHORIZATIONS = 0
SEPARATE_PAGE_AUTHORIZATIONS = 0

M9_CLUSTER_ID_DRIFT = 0
M9_CLUSTER_STATE_DRIFT = 0
M9_CLUSTER_MEMBERSHIP_DRIFT = 0
M9_MATERIAL_HOLD_PAIR_SET_DRIFT = 0

M5_HYPOTHESIS_REGISTER_USED_AS_INPUT = 0
ALICE_INPUT_ROWS = 0
AI_PROVIDER_EVIDENCE_ROWS = 0
FINAL_AI_CASE_SELECTIONS = 0
PRODUCT_CAPABILITY_AS_PAGE_CREATION_PROOF = 0

PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
SITE_MUTATIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0

SEARCH_ONLY_BASELINE_FROZEN_BEFORE_AI = true
OPEN_CRITICAL_DEFECTS = 0
```

======================================================================
13. STOP CONDITIONS
======================================================================

```text
HOLD_INPUT_IDENTITY
HOLD_CURRENT_SITE_SOURCE_DRIFT
HOLD_CLUSTER_SET_MISMATCH
HOLD_MATERIAL_BOUNDARY_SET_MISMATCH
HOLD_M9_AUTHORITY_DRIFT
HOLD_UNAUTHORIZED_OWNER_ASSIGNMENT
HOLD_UNAUTHORIZED_PAGE_CREATION
HOLD_AI_CONTAMINATION
```

Do not repair a HOLD by guessing an owner/page/IA relationship.

======================================================================
14. BEFORE RETURN
======================================================================

Re-fetch SEO branch and `main`.

Record:
`END_OBSERVED_HEAD` and `END_SITE_MAIN_HEAD`.

If `main` moved from frozen current-site HEAD, stop with `HOLD_CURRENT_SITE_SOURCE_DRIFT` even if frozen blobs remain accessible.

If only M10A prompt/progress/staging authority changed on SEO branch while frozen input blobs remain identical, use:
`AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED`.

======================================================================
15. PUBLICATION
======================================================================

Create one downloadable ZIP containing exactly the 7 final files.
Work must not write GitHub.

Owner staging:
`docs/seo/work_return/M10A_SEARCH_ONLY_PAGE_IA_BASELINE_2026-09-24_R1/`

======================================================================
16. DOWNSTREAM STOP
======================================================================

DO NOT CONTINUE TO M10B.

Main Chat must independently audit and explicitly accept M10A.

Only then may M10B final AI diagnostic case selection begin.

======================================================================
17. FINAL RESPONSE FORMAT
======================================================================

Return:
```text
WORK_ID = OCTOPORT_SEO_M10A_SEARCH_ONLY_PAGE_IA_BASELINE_2026-09-24_R1
START_HEAD =
END_OBSERVED_HEAD =
START_SITE_MAIN_HEAD =
END_SITE_MAIN_HEAD =
AUTHORITY_DRIFT_STATUS =
VERDICT =

EXISTING_SITE_SURFACE_ROWS = 4/4
CURRENT_SITE_SOURCE_HEAD_MATCH = true

CLUSTER_BASELINE_ROWS = 104/104
SEARCH_OWNER_HOLD = 104/104
PROVISIONAL_OWNER_NONE_HOLD = 104/104
PAGE_ROLE_HOLD = 104/104
EXISTING_SEARCH_OWNER_ASSIGNMENTS = 0
PLANNED_SEARCH_PAGE_CREATE_AUTHORIZATIONS = 0
PARENT_CHILD_IA_ASSIGNMENTS = 0
INTERNAL_LINK_OWNER_CONTRACTS = 0

POSITIVE_MATERIAL_HOLD_DEGREE_CLUSTERS = 103/103
ZERO_MATERIAL_HOLD_DEGREE_CLUSTERS = 1/1

CANNIBALIZATION_BOUNDARY_ROWS = 1399/1399
HOLD_PAGE_OWNERSHIP_BOUNDARY = 1399/1399
SAME_PAGE_AUTHORIZATIONS = 0
SEPARATE_PAGE_AUTHORIZATIONS = 0

M5_HYPOTHESIS_REGISTER_USED_AS_INPUT = 0
ALICE_INPUT_ROWS = 0
AI_PROVIDER_EVIDENCE_ROWS = 0
FINAL_AI_CASE_SELECTIONS = 0

SEARCH_ONLY_BASELINE_FROZEN_BEFORE_AI = true
M10B_GATE_RECOMMENDATION =

PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
SITE_MUTATIONS = 0

OPEN_CRITICAL_DEFECTS =
FILES_IN_ZIP = 7
ZIP_SHA256 =
```

Provide one real downloadable ZIP.
Do not continue to M10B.
