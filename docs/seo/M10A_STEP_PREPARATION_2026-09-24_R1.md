# Octoport SEO — M10A Search-only ownership / IA baseline — STEP PREPARATION — 2026-09-24 R1

Status: **PREPARATION COMPLETE / WORK REQUIRED / HANDOFF NOT YET ISSUED**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation parent HEAD: `e86421d4e5861c0514da52ec8681b3fcfdac3585`

## 1. Roadmap cursor

```text
M0..M8 = ACCEPTED
M9 SEARCH-ONLY CLUSTERING + BOUNDARY RESOLUTION = ACCEPTED
M9 TERMINAL SEARCH-ONLY HOLD RECONCILIATION = ACCEPTED
M10A_SEARCH_BASELINE_GATE = OPEN_WITH_EXPLICIT_HOLDS

M10A = CURRENT PREPARATION
M10B/C/D = BLOCKED
M11+ = BLOCKED
```

M10A purpose: freeze what ordinary Search evidence alone would implement before any Alice/AI evidence is selected or acquired.

## 2. Governing authority

Read/applied:
- `docs/seo/LEVEL2/M5_M10_SEARCH_ONLY_AND_ALICE_SEQUENCE_RULES.md` blob `2c63e4228f9cc6f2d26555fcb02d445baafb1000`;
- `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md` blob `2f87943fbe9037c58276d2dd3a805d070bd070a4`;
- `docs/seo/WORK_HANDOFF_RULE.md` blob `71a031e74b921dade5998beb842fb3afcc4478e7`;
- accepted M9 terminal closure and current product/site authority.

Hard sequence:
```text
SEARCH-ONLY BASELINE FIRST
-> M10B FINAL AI CASE SELECTION
-> M10C AI EVIDENCE
-> M10D CAUSAL RECONCILIATION
-> M11 FINAL PAGE OWNERSHIP / IA
```

No Alice/AI evidence may enter M10A.

## 3. Accepted M9 input state

```text
CLUSTER_ROWS = 104
CLUSTER_STATE = HOLD_CLUSTER_BOUNDARY for 104/104
M10A_CARRY = CARRY_SEARCH_ONLY_HOLD_TO_M10A for 104/104
CURRENT_SEARCH_ANCHORS = 65
NO_CURRENT_EXACT_SERP = 39
MATERIAL_HOLD = 1399
MERGE_SUPPORTED = 28
AUTHORIZED_SEARCH_PROVIDER_CALLS = 0
```

Main Chat acceptance:
`docs/seo/M9_TERMINAL_HOLD_RECONCILIATION_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`
blob `f35e5132d64ade78ce6c8fb8a2aea2292f41c02a`.

## 4. Current site source refresh

Accepted M1 remains `PASS / PRELAUNCH NO-PRODUCTION-SITE BASELINE`.

Current `main` read-only refresh:
`docs/seo/M10A_CURRENT_SITE_SOURCE_OVERLAY_2026-09-24_R1.md`
blob `b5f41ff4d0db562cc2346b672e412880585188ef`.

Current main HEAD:
`f079c2e7199250397259ea9ede10a4f72694f5c1`.

Physical source surfaces now present:
```text
/         = existing prelaunch product landing foundation
/install  = existing installation/status/help surface
/privacy  = existing privacy/data-handling surface
/support  = existing support/beta/help surface
```

Home, robots and sitemap blobs are unchanged from accepted M1. Install/privacy/support are new source pages since M1. The sitemap still lists only `/`.

Physical existence does not imply Search ownership.

## 5. Fresh external method check — 2026-09-24

Official Yandex Webmaster sources checked:

1. Site structure:
https://www.yandex.com/support/webmaster/en/recommendations/site-structure

Project application: keep a clear crawlable link structure and distinct URLs for genuinely distinct documents; do not create technical/duplicate search surfaces merely to increase page count.

2. Managing groups of search queries:
https://www.yandex.com/support/webmaster/en/service/search-queries

3. Search query monitoring:
https://www.yandex.com/support/webmaster/en/service/popular-queries

Project application: query and URL behavior are separately observable; page ownership must remain evidence-backed rather than inferred from current physical URLs.

Fresh method verdict:
```text
FRESH_METHOD_RESEARCH = PASS
LEVEL2_CONTRADICTION = false
PHYSICAL_PAGE_EXISTS != SEARCH_OWNER
UNRESOLVED_CLUSTER != CREATE_PAGE
```

## 6. M10A interpretation of current all-HOLD M9 authority

All 104 accepted M9 clusters are explicitly carried into M10A as Search-only HOLDs.

Therefore M10A must **not** resolve any cluster into Home, install, privacy, support or a new planned page merely to complete an architecture table.

For every cluster the baseline must freeze:
- Search-only owner state;
- provisional primary page owner or HOLD;
- page role/type state;
- existing/planned relation;
- parent/child IA state;
- internal-link responsibility state;
- cannibalization boundary state;
- exact M9 evidence refs and reopen trigger.

Because accepted M9 authority carries all 104 as HOLD:
```text
SEARCH_OWNER_STATE = HOLD_NO_SEARCH_ONLY_OWNER for 104/104
PROVISIONAL_PRIMARY_PAGE_OWNER = NONE_HOLD for 104/104
PAGE_ROLE_TYPE = HOLD_NOT_AUTHORIZED_BY_SEARCH_ONLY_BASELINE for 104/104
EXISTING_PAGE_OWNER_ASSIGNMENT = 0
PLANNED_SEARCH_PAGE_CREATE_AUTHORIZATION = 0
PARENT_CHILD_IA_ASSIGNMENT = 0
INTERNAL_LINK_OWNER_CONTRACT = 0
```

This is a valid Search-only baseline: it records that ordinary Search evidence is insufficient to decide those owners while preserving the current physical site.

## 7. Existing site surface treatment

M10A records the four current source surfaces separately.

Required state for all four:
`CURRENT_PHYSICAL_SURFACE_ONLY / NO_M9_SEARCH_OWNER_IMPLIED`.

M10A must not change sitemap/indexing/canonical/source code.

## 8. Cannibalization boundary

The accepted 1,399 material HOLD pair set remains the complete unresolved Search-only cannibalization/page-boundary authority.

M10A must preserve one boundary row per pair and must not decide SAME_PAGE or SEPARATE_PAGE.

Required decision state:
`HOLD_PAGE_OWNERSHIP_BOUNDARY` for 1399/1399.

The row must retain cluster/identity endpoints, current anchor availability, terminal Search-only disposition, carry-forward state and reopen trigger.

## 9. Work trigger

Work is required because the baseline must reconcile:
- 104 cluster rows;
- 1,399 material HOLD boundaries;
- current site source overlay;
- product truth;
- exact no-AI/no-owner constraints;
- full-volume lineage and adversarial QA.

Sampling/first-N is forbidden.

`WORK_TRIGGER_DECISION = WORK_REQUIRED`.

## 10. Required outputs — exactly 7

1. `M10A_SOURCE_MANIFEST.md`
2. `M10A_EXISTING_SITE_SURFACE.tsv`
3. `M10A_CLUSTER_PAGE_IA_BASELINE.tsv`
4. `M10A_CANNIBALIZATION_BOUNDARY.tsv`
5. `M10A_ADVERSARIAL_DIAGNOSTIC.tsv`
6. `M10A_QA.md`
7. `M10A_RETURN_MANIFEST.json`

## 11. Hard gates

```text
EXISTING_SITE_SURFACE_ROWS = 4/4
CLUSTER_BASELINE_ROWS = 104/104
CANNIBALIZATION_BOUNDARY_ROWS = 1399/1399

SEARCH_OWNER_HOLD = 104/104
PAGE_ROLE_HOLD = 104/104
EXISTING_SEARCH_OWNER_ASSIGNMENTS = 0
PLANNED_SEARCH_PAGE_CREATE_AUTHORIZATIONS = 0
PARENT_CHILD_IA_ASSIGNMENTS = 0
INTERNAL_LINK_OWNER_CONTRACTS = 0

HOLD_PAGE_OWNERSHIP_BOUNDARY = 1399/1399

M9_CLUSTER_ID_DRIFT = 0
M9_CLUSTER_STATE_DRIFT = 0
M9_CLUSTER_MEMBERSHIP_DRIFT = 0
M9_MATERIAL_HOLD_PAIR_SET_DRIFT = 0

ALICE_INPUT_ROWS = 0
AI_PROVIDER_EVIDENCE_ROWS = 0
FINAL_AI_CASE_SELECTIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0
SITE_MUTATIONS = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0

SEARCH_ONLY_BASELINE_FROZEN_BEFORE_AI = true
OPEN_CRITICAL_DEFECTS = 0
```

## 12. Downstream boundary

Work must stop after M10A.

Main Chat independently audits the return. Only accepted M10A may open M10B final AI diagnostic case selection.
