# M4Q R2 — canonical ChatGPT Work targeted M4C recheck prompt

WORK_ID: OCTOPORT_SEO_M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1

CONTINUE THE EXISTING OCTOPORT SEO PROGRAM.

THIS IS AN EXECUTION TASK.
THIS IS THE TARGETED POST-M4Q-R2 M4C DEPENDENCY RECHECK ONLY.

THIS IS NOT A NEW PROJECT.
THIS IS NOT A BROAD M4B CRAWL.
THIS IS NOT YANDEX SEARCH ACQUISITION.
THIS IS NOT WORDSTAT.
THIS IS NOT ALICE.
THIS IS NOT M5.
THIS IS NOT M6 PROVIDER EXECUTION.
THIS IS NOT FINAL CLUSTERING.
THIS IS NOT QUERY->PAGE OWNERSHIP.
THIS IS NOT SITE ARCHITECTURE.
THIS IS NOT SIBLING-HOST IDENTITY HOLD RESOLUTION.

Repository:
MaksimUnimax/runtime-fixtures

Branch:
seo/wordstat-batch-01-2026-09-16

======================================================================
0. FIRST ACTION — LIVE PREFLIGHT
======================================================================

Fetch the live remote branch and record START_HEAD.

Read in full:

- docs/seo/LEVEL1/README.md
- docs/seo/EXECUTION_RULES.md
- docs/seo/WORK_HANDOFF_RULE.md
- docs/seo/QUALITY_FIRST_RESOURCE_RULE.md
- docs/seo/PRODUCT_TRUTH.md
- docs/seo/METHODOLOGY.md
- docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md
- docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md
- docs/seo/serp/competitors/M4Q_R2_PASS_B_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md
- docs/seo/serp/competitors/M4Q_R2_TARGETED_M4C_RECHECK_GATE_2026-09-23_R1.md
- docs/seo/serp/competitors/M4Q_R2_TARGETED_M4C_RECHECK_URLS_2026-09-23_R1.tsv
- docs/seo/serp/competitors/M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md
- docs/seo/serp/competitors/M4_PROGRESS.md

Read the accepted Pass B return files under:

docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/

Read the accepted M4C artifacts needed to reconcile entity, URL, page and candidate evidence, including at minimum:

- M4C_HARDENED_COMPETITOR_REGISTRY.tsv
- M4C_COVERAGE_LEDGER.tsv
- M4C_URL_LEDGER.tsv
- M4C_COMPETITOR_CANDIDATE_REGISTER.tsv
- M4C_M6_DEMAND_GAP_CANDIDATES.tsv
- M4C_RETURN_MANIFEST.json

Binding target authority:

docs/seo/serp/competitors/M4Q_R2_TARGETED_M4C_RECHECK_URLS_2026-09-23_R1.tsv

Required Git blob:

c567aeef24441e2c0e3e05a153dd6bdf33384201

Required target facts:

TARGET_ROWS = 59
UNIQUE_TARGET_URLS = 59
TARGET_REGISTRY_ENTITIES = 12

If the target blob differs or target rows are not exactly 59:

VERDICT = HOLD_AUTHORITY_DRIFT

and stop.

======================================================================
1. EXACT SCOPE
======================================================================

Process every one of the 59 frozen URLs.

For each target:

1. request the exact source ranking URL;
2. follow only legitimate HTTP/public-page redirects needed to reach the terminal page;
3. record all redirect/final identity;
4. record terminal state and HTTP status/observation;
5. if public HTML is legitimately accessible, inspect the page completely enough to capture:
   - final URL;
   - declared canonical where exposed;
   - title;
   - H1;
   - meaningful headings;
   - breadcrumb/taxonomy where visible;
   - page role;
   - relevant visible content/use-case evidence;
6. reconcile the final/current page against accepted M4C URL/page evidence;
7. extract evidence-supported candidate terms/use cases from this exact page only;
8. reconcile candidate terms to the accepted M4C candidate register;
9. state the exact M4C/M6 impact, if any.

DO NOT recursively follow ordinary links from the page.

DO NOT use navigation/footer/body links as new target authority.

A redirect/final/canonical URL reached directly from a frozen target may be recorded, but it does not authorize crawling its children.

======================================================================
2. PUBLIC-ACCESS RULE
======================================================================

Use only public legitimately accessible content.

Do not bypass:

- login;
- paywall;
- CAPTCHA;
- anti-bot;
- access controls;
- private APIs;
- robots restrictions.

Allowed terminal classifications include:

INSPECTED
REDIRECT_IN_SCOPE
REDIRECT_OUT_OF_SCOPE
NOT_FOUND
HTTP_ERROR
ROBOTS_OR_ACCESS_BLOCKED
AUTH_REQUIRED
CAPTCHA_OR_ANTIBOT
TIMEOUT
NON_HTML
DYNAMIC_UNRESOLVED
OTHER_EXPLICIT_TERMINAL

Every frozen target must have exactly one terminal accounting row.

A current failure never erases durable accepted historical M4C content.

======================================================================
3. HARD BOUNDARIES
======================================================================

The following are forbidden:

NEW YANDEX SEARCH CALLS
WORDSTAT CALLS
ALICE CALLS
DOMAIN->UNKNOWN-QUERY DISCOVERY
SEARCH-ENGINE QUERY EXPANSION
BROAD M4B FRONTIER REOPEN
ARBITRARY CHILD-LINK CRAWL
SIBLING-HOST IDENTITY HOLD RESOLUTION
FINAL CLUSTERING
FINAL PAGE OWNERSHIP
FINAL URL/H1/TITLE/IA DECISIONS

The 74 sibling-host AMBIGUOUS rows accepted in Pass B remain unchanged and outside this task.

Do not widen the competitor registry.

======================================================================
4. URL RECHECK LEDGER
======================================================================

Create:

M4Q_R2_TARGETED_URL_RECHECK_LEDGER.tsv

Exactly 59 data rows.

Required fields at minimum:

- target_id
- registry_id
- source_ranking_url
- best_current_rank
- source_execution_query_ids
- source_exact_queries
- fetch_attempted
- observed_at
- terminal_state
- http_status_or_observation
- redirect_chain
- final_url
- normalized_final_url
- declared_canonical
- normalized_canonical
- content_available
- m4c_existing_exact_url_status
- m4c_existing_equivalent_or_canonical_status
- m4c_proposed_url_state
- notes
- claim_boundary

No target may disappear.

======================================================================
5. TARGETED PAGE EVIDENCE
======================================================================

Create:

M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv

Use one row per target with content evidence where practical, and preserve target_id/URL lineage.

Required fields at minimum:

- target_id
- registry_id
- source_ranking_url
- final_url
- title
- h1
- headings
- breadcrumb_or_taxonomy
- page_role
- relevant_content_summary
- observed_capabilities_or_tasks
- observed_claims
- current_freshness_or_modtime_if_available
- evidence_basis
- confidence
- claim_boundary

If a target has no retrievable page content, it remains terminally accounted in URL_RECHECK_LEDGER and need not have fabricated page evidence.

======================================================================
6. CANDIDATE DELTA
======================================================================

Create:

M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv

Extract only actual wording/use cases supported by the inspected frozen pages.

Required fields at minimum:

- candidate_delta_id
- target_id
- registry_id
- source_url
- page_role
- raw_candidate_text
- normalized_comparison_key
- source_location_or_context
- reconciliation_status
- existing_m4c_candidate_ids
- semantic_notes
- proposed_m6_route
- claim_boundary

Allowed reconciliation states:

ALREADY_PRESENT
NEW_CANDIDATE
POSSIBLE_VARIANT
OUT_OF_SCOPE
AMBIGUOUS

Normalization may support exact-safe comparison only.
Do not silently merge synonyms/morphology.

NEW_CANDIDATE does not mean demand.
POSSIBLE_VARIANT does not mean semantic identity.

======================================================================
7. M4C / M6 RECONCILIATION
======================================================================

Create:

M4Q_R2_TARGETED_M4C_M6_RECONCILIATION.tsv

Exactly 59 target-level rows.

Required fields at minimum:

- target_id
- registry_id
- source_ranking_url
- terminal_state
- final_url
- page_role
- content_relevance
- m4c_change_class
- m4c_change_summary
- candidate_delta_count
- new_candidate_count
- possible_variant_count
- affected_existing_candidate_ids
- proposed_m6_effect
- search_visibility_demand_boundary
- recommended_next_state
- confidence
- evidence_refs
- notes

Conservative M4C change classes may include:

NO_MATERIAL_CHANGE
ADD_CURRENT_URL_EVIDENCE
ADD_CURRENT_PAGE_EVIDENCE
ADD_CURRENT_URL_AND_PAGE_EVIDENCE
TARGET_INACCESSIBLE_KEEP_DURABLE_HISTORY
OUT_OF_SCOPE
HOLD

M6 effects may include:

NO_CHANGE
KEEP_EXISTING_VALIDATION_ROUTE
ADD_NEW_CANDIDATE_FOR_LATER_VALIDATION
PRIORITIZE_EXISTING_VALIDATION_QUESTION
HOLD

No candidate becomes demand-accepted in this task.

======================================================================
8. FULL QA
======================================================================

Create:

M4Q_R2_TARGETED_RECHECK_QA.md

At minimum report:

FROZEN_TARGET_BLOB_MATCH = true
TARGET_ROWS = 59/59
UNIQUE_TARGET_URLS = 59/59
TARGETS_TERMINAL_ACCOUNTED = 59/59
SILENT_TARGET_LOSS = 0
DUPLICATE_TARGET_IDS = 0
UNAUTHORIZED_URL_EXPANSION = 0
BROAD_FRONTIER_EXPANSION = 0

INSPECTED =
REDIRECT_TERMINAL =
NOT_FOUND =
HTTP_ERROR =
ROBOTS_OR_ACCESS_BLOCKED =
AUTH_REQUIRED =
CAPTCHA_OR_ANTIBOT =
TIMEOUT =
NON_HTML =
DYNAMIC_UNRESOLVED =
OTHER_TERMINAL =

PAGE_EVIDENCE_ROWS =
CANDIDATE_DELTA_ROWS =
ALREADY_PRESENT =
NEW_CANDIDATE =
POSSIBLE_VARIANT =
OUT_OF_SCOPE =
AMBIGUOUS =

M4C_NO_MATERIAL_CHANGE =
M4C_ADD_CURRENT_URL_EVIDENCE =
M4C_ADD_CURRENT_PAGE_EVIDENCE =
M4C_ADD_CURRENT_URL_AND_PAGE_EVIDENCE =
M4C_TARGET_INACCESSIBLE_KEEP_DURABLE_HISTORY =
M4C_OUT_OF_SCOPE =
M4C_HOLD =

SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_PAGE_TOPIC_AS_DEMAND = 0
COMPETITOR_CLAIM_AS_OCTOPORT_FACT = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0

YANDEX_SEARCH_CALLS = 0
WORDSTAT_CALLS = 0
ALICE_CALLS = 0
GITHUB_WRITES = 0

If 59/59 terminal accounting cannot be achieved, do not fake PASS.

======================================================================
9. REQUIRED OUTPUTS — EXACTLY SEVEN
======================================================================

Produce exactly:

1. M4Q_R2_TARGETED_M4C_SOURCE_MANIFEST.md
2. M4Q_R2_TARGETED_URL_RECHECK_LEDGER.tsv
3. M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv
4. M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv
5. M4Q_R2_TARGETED_M4C_M6_RECONCILIATION.tsv
6. M4Q_R2_TARGETED_RECHECK_QA.md
7. M4Q_R2_TARGETED_RECHECK_RETURN_MANIFEST.json

The return manifest must record exact bytes/SHA256/row counts for the six non-self files and use the established self-hash exclusion policy.

No extra final files in the ZIP.

======================================================================
10. STOP CONDITIONS
======================================================================

HOLD_AUTHORITY_DRIFT
if frozen target/rules/current accepted authorities materially changed.

PARTIAL_REWORK_REQUIRED
if any frozen target lacks a terminal accounting state.

Do not stop merely because some target URLs are inaccessible; classify them terminally and continue the remaining frozen set.

Do not replace an inaccessible exact URL with an invented Search-discovered substitute.

======================================================================
11. BEFORE RETURN
======================================================================

Re-fetch remote branch and record END_OBSERVED_HEAD.

Classify authority drift.

No GitHub writes.

======================================================================
12. PUBLICATION
======================================================================

Create one downloadable ZIP containing exactly the seven final files.

Owner will extract and upload all seven files together to:

docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/

======================================================================
13. FINAL RESPONSE
======================================================================

State at minimum:

WORK_ID =
START_HEAD =
END_OBSERVED_HEAD =
AUTHORITY_DRIFT_STATUS =
VERDICT =

TARGET_ROWS = 59/59
TARGETS_TERMINAL_ACCOUNTED = 59/59
SILENT_TARGET_LOSS = 0

PAGE_EVIDENCE_ROWS =
CANDIDATE_DELTA_ROWS =
NEW_CANDIDATE_ROWS =
POSSIBLE_VARIANT_ROWS =

M4C_CHANGED_TARGETS =
M4C_NO_MATERIAL_CHANGE_TARGETS =
M4C_HOLD_TARGETS =

YANDEX_SEARCH_CALLS = 0
WORDSTAT_CALLS = 0
ALICE_CALLS = 0
GITHUB_WRITES = 0

FILES_IN_ZIP = 7
ZIP_SHA256 =

Provide one real downloadable ZIP.

Do not continue to M5/M6 execution/M7/clustering/page ownership.
