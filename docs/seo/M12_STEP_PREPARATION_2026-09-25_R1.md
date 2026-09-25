# Octoport SEO — M12 page specs + content system — STEP PREPARATION — 2026-09-25 R1

Status: **PREPARATION COMPLETE / MAIN CHAT EXECUTION / NO WORK HANDOFF REQUIRED**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation parent HEAD: `dfc701e82256fbb97e226b2903b9f53329680d25`

## 1. Cursor

```text
M0..M11 = ACCEPTED
M12 = CURRENT PREPARATION
M13+ = BLOCKED
```

M12 purpose:
turn the two accepted M11 page owners into implementable, truthful page-job/content contracts without reopening the 102 held clusters.

## 2. Two-level authority

LEVEL 1:
- docs/seo/LEVEL1/README.md
- docs/seo/EXECUTION_RULES.md
- docs/seo/QUALITY_FIRST_RESOURCE_RULE.md
- docs/seo/WORK_HANDOFF_RULE.md
- docs/seo/METHODOLOGY.md
- docs/seo/PRODUCT_TRUTH.md

LEVEL 2:
- docs/seo/LEVEL2/README.md
- docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md
- docs/seo/LEVEL2/M12_PAGE_SPECS_CONTENT_RULES.md
  blob `0e0f78cfe7d51bf4e5b6925699ba07eb98890c2b`

Current accepted architecture:
- docs/seo/M11_MAIN_CHAT_ACCEPTANCE_2026-09-25_R1.md
  blob `972f35818e3a7e39ca7cd2b690a13d6ddb1f7c06`
- M11_CLUSTER_FINAL_OWNERSHIP.tsv
  blob `cf70289cb4399cd688798042fc05299119110ab2`
- M11_PAGE_OWNER_REGISTRY.tsv
  blob `068032bcd1ac4ae894f0778f991472661010d680`
- M11_IA_EDGE_REGISTRY.tsv
  blob `3563777b060c6168e60cec89ed086ce8c89616bb`
- M11_CANNIBALIZATION_GUARD.tsv
  blob `fa2b55c3091638a7b2d709389f66f05b8f7fe7aa`
- M11_EXISTING_SURFACE_DECISION.tsv
  blob `876223cf28a323298de69cac64e106e295653f95`

Failure history:
- docs/seo/FAILURE_LEDGER.md
  blob `2527cb7adb10a57795f0b80f16660b4475f6e825`

## 3. Work trigger

`WORK_TRIGGER_DECISION = MAIN_CHAT_SAFE / WORK_NOT_REQUIRED`.

Reason:
```text
INDEXABLE_PAGE_OWNERS = 2
ASSIGNED_CLUSTERS = 2
SECONDARY_ASSIGNED_CLUSTERS = 0
IA_EDGES = 2
HOLD_CLUSTERS_EXCLUDED_FROM_M12_TARGETS = 102
```

No large many-to-many transformation is required.
Main Chat can process 100% of the accepted target universe without sampling.

## 4. Fresh method research — 2026-09-25

Official Yandex sources checked:

1. Site content / quality:
https://www.yandex.com/support/webmaster/en/recommendations/webmaster-advice

Application:
page must provide substantial, useful, original product-specific value, not generic SEO filler.

2. Presenting information:
https://yandex.com/support/webmaster/en/recommendations/presentation

Application:
page purpose should be clear from the first screen; content should be logical, structured and accessible without hidden interaction.

3. Title:
https://www.yandex.com/support/webmaster/en/search-results/title

Application:
Title must be meaningful and page-specific; avoid generic titles; brand may be included.

4. Description:
https://yandex.com/support/webmaster/en/indexing-options/description

Application:
description must be unique, reflect actual content, avoid keyword stuffing and differ from Title.

5. Title + description/snippet composition:
https://www.yandex.com/support/webmaster/en/search-results/title-and-description

Application:
snippet may use page content, Title, Description and structured data; spec must align all of these semantically.

6. Site structure:
https://www.yandex.com/support/webmaster/en/recommendations/site-structure

Application:
each page gets one unique URL that gives a clue to content, remains shallow and is reachable by normal links.

7. Schema.org:
https://yandex.com/support/webmaster/en/schema-org/what-is-schema-org
https://yandex.com/support/webmaster/en/schema-org/semantic-faq

Application:
schema is optional and only where entity/content type is actually supported; markup does not directly raise ranking; no fake FAQ/schema.

## 5. Accepted M11 target universe

Exactly two indexable page owners:

### Owner 1 — existing HOME
```text
PAGE_OWNER_ID = M11PAGE_EXISTING_HOME
CLUSTER_ID = M9CL_3f05678ef9d62960
PRIMARY_QUERY = подключить ии к маркетплейсу
USER_JOB = Connect an owned web AI to permitted Ozon/WB seller data
ROUTE = HOME
ACTION = KEEP
PRIORITY = P1_CORE
CANONICAL_EXISTING_URL = https://octoport.ru/
```

Demand provenance:
```text
M2R evidence type = EMPTY_SUCCESS_SEED
observed_count = NOT_RETURNED
seed_total_count = NOT_RETURNED
region = 225
device = DEVICE_ALL
source = B01/B01-13
```

Hard:
do not rewrite EMPTY_SUCCESS_SEED as zero demand.

Search:
`EXACT_ORGANIC_QUERY_OBSERVED`.

### Owner 2 — planned seller-owned analytics page
```text
PAGE_OWNER_ID = M11PAGE_aaa90aa723a3694c
CLUSTER_ID = M9CL_db048338baaeca8c
PRIMARY_QUERY = ии для аналитики маркетплейсов
USER_JOB = Inspect and understand seller-owned sales and report data with an owned AI
ROUTE = FEATURE_OR_USE_CASE
ACTION = CREATE
PRIORITY = P4_EXPLORATORY
```

Demand provenance:
```text
M2R/B01 direct observed_count = 15
B02 tested seed total = 15
B02 direct result observed_count = 15
M2R-A01 direct result observed_count = 15
M2R-A01 broad seed_total_count = 4290
region = 225
device = DEVICE_ALL
```

The exact query metric for the page is `15 observed`; do not present `4290` as query frequency because it is the broad seed total.

Search:
`EXACT_ORGANIC_QUERY_OBSERVED`.

## 6. Coverage boundary

Only these two clusters may be primary/secondary page coverage in M12.

```text
M11_ASSIGNED_CLUSTERS = 2
M11_HOLD_CLUSTERS = 102
M12_TARGET_CLUSTERS = 2
M12_HOLD_CLUSTER_IMPORT = 0
```

No held query/topic may become:
- primary target;
- secondary target;
- FAQ target;
- required content block;
- schema target;
merely because it is semantically adjacent.

Held topics may be mentioned only as negative/coverage boundaries where necessary to avoid overclaim/cannibalization.

## 7. Planned URL rule

M12 must assign one canonical planned URL for the CREATE owner.

Requirements:
- one unique URL;
- lowercase ASCII;
- one shallow path segment unless a deeper path has explicit architecture value;
- descriptive clue to the page job;
- no duplicate current route;
- no keyword stuffing;
- no final implementation occurs in M12.

HOME remains `https://octoport.ru/`.

## 8. Page-spec required fields

For each of exactly two indexable owners record:
```text
page_owner_id
canonical_planned_url
owner_origin
physical_action
route_class
primary_cluster_id
primary_query
primary_query_metric_state
primary_query_metric_value
primary_query_metric_provenance
secondary_queries
secondary_query_metrics
user_job
intent
marketplace_scope
seo_priority
seo_priority_basis
product_promise_boundary
own_coverage
covered_elsewhere
expected_content_type
content_angle
h1_target_state
title_target_state
description_guidance
required_semantic_blocks
required_product_proof
faq_state
faq_requirements
internal_links_in
internal_links_out
parent_child_relation
canonical_state
indexing_state
schema_eligibility
alice_ai_source_readiness_notes
implementation_state
evidence_refs
claim_boundary
```

No secondary query is invented. If M11 assigned none:
`secondary_queries = NONE_ASSIGNED`.

## 9. Content/proof rules

HOME proof may use current product mechanics:
- chosen user AI;
- browser bridge;
- Ozon + Wildberries;
- read-only launch;
- data/results returned to same AI/dialog;
- beta is not publicly open.

Analytics page proof may use only:
- permitted seller-owned data;
- sales/report reading/analysis/explanation;
- selected user AI;
- no external competitor/niche intelligence unless endpoint-level product truth later authorizes it;
- no statutory accounting advice;
- no autonomous write-back.

No fake screenshots, case studies, customer numbers, performance claims, prices or public availability.

## 10. FAQ / schema

Default:
```text
FAQ_STATE = NOT_REQUIRED_UNLESS_ACCEPTED_EVIDENCE_SHOWS_DISTINCT_USER_NEED
SCHEMA = ONLY_IF_ACTUAL_PAGE_ENTITY/CONTENT_TYPE_IS_SUPPORTED
```

Do not add FAQ merely for SEO.
Do not add QAPage for editorial FAQ.
Do not assume SoftwareApplication schema on a use-case page unless M12 can prove the page is actually a software-application description matching supported fields.

## 11. IA / internal links

Accepted M11 edges:
- HOME -> analytics planned owner = PARENT_CHILD
- analytics planned owner -> HOME = CONTEXTUAL_INTERNAL_LINK

M12 defines link role/guidance, not final anchor copy if wording is not evidence-backed.

No orphan target.

## 12. Required outputs — Main Chat execution

1. `M12_SOURCE_MANIFEST.md`
2. `M12_PAGE_SPEC_REGISTRY.tsv` — exactly 2 rows
3. `M12_CONTENT_BLOCK_CONTRACT.tsv` — full required block inventory for two owners
4. `M12_INTERNAL_LINK_CONTRACT.tsv` — exactly 2 accepted IA relationships
5. `M12_PROOF_TRUST_REQUIREMENTS.tsv` — exact proof obligations / forbidden claims
6. `M12_ADVERSARIAL_DIAGNOSTIC.tsv`
7. `M12_QA.md`

No ZIP/Work relay because Work is not triggered.

## 13. Hard gates

```text
PAGE_SPEC_ROWS = 2/2
PAGE_OWNER_ID_SET = exact M11 assigned owners
M11_HOLD_CLUSTERS_IMPORTED = 0
PRIMARY_OWNER_MATCHES_M11 = true
QUERY_METRICS_PROVENANCE = PASS
EMPTY_SUCCESS_SEED_NOT_ZERO = true
ANALYTICS_QUERY_OBSERVED_COUNT = 15
BROAD_SEED_4290_NOT_USED_AS_QUERY_METRIC = true
PRODUCT_PROMISE_TRUTHFUL = true
COVERAGE_BOUNDARY_EXPLICIT = true
INTERNAL_LINK_RELATIONSHIPS = 2/2
ORPHAN_TARGETS = 0
FAKE_FAQ = 0
FAKE_SCHEMA = 0
FAKE_PROOF = 0
FINAL_IMPLEMENTATION = 0
SITE_MUTATIONS = 0
OPEN_CRITICAL_SPEC_DEFECTS = 0
```

## 14. Stop/HOLD

Stop M12 execution if:
- M11 acceptance/blob drifts;
- either assigned owner disappears/changes;
- current HOME content materially changes before spec execution;
- exact M2R metric provenance cannot be reproduced;
- Product Truth changes materially.

A missing proof obligation becomes `PROOF_REQUIRED`, not an invented assertion.

## 15. Downstream boundary

M12 may define planned URL/H1/Title/description/content contract.

M12 does NOT:
- edit site files;
- decide robots/sitemap/HTTP implementation details beyond page-level desired indexing/canonical state;
- execute technical SEO M13;
- implement M14.

M13 remains blocked until Main Chat accepts M12.
