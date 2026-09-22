# Octoport SEO — M4C synthesis pre-step research and execution gate R1

Date: 2026-09-22
Status: PREPARED / REMOTE READBACK REQUIRED BEFORE WORK
WORK_ID: OCTOPORT_SEO_M4C_SYNTHESIS_2026-09-22_R1
Repository: MaksimUnimax/runtime-fixtures
Branch: seo/wordstat-batch-01-2026-09-16
Preparation base HEAD: f33bbbd4a5be4769ce199e68c8024875821d5041

## Purpose

M4C is the synthesis/reconciliation layer for accepted M4 competitor evidence. It does not acquire a new corpus and does not decide final clusters, page ownership, IA, URL, H1 or Title.

M4C must create one lossless current competitor evidence package from accepted M4A + M4B1 + M4B2 + M4Q evidence for later M5 hypotheses and M6 demand/gap validation.

## Current accepted state

M4A_R3 = ACCEPTED
M4A_REGISTRY_ENTITIES = 60

M4B1_HISTORICAL_FINAL_ACCEPTANCE = PRESERVED
M4B1_R3_REACQUISITION_R1 = ACCEPTED_AS_CURRENT_EVIDENCE
CURRENT_R3_URL_ROWS = 11222
CURRENT_R3_PAGE_EVIDENCE_ROWS = 5118
CURRENT_R3_CANDIDATE_ROWS = 5116
CURRENT_POST_R3_MERGED_UNIVERSE = 12834
CURRENT_PUBLIC_DRIFT_DETECTED = true

M4B2 = ACCEPTED
M4B2_URL_ROWS = 1476
M4B2_PAGE_EVIDENCE_ROWS = 1412
M4B2_CANDIDATE_ROWS = 1412

M4Q = ACCEPTED_WITH_SOURCE_LIMITATION
RANKING_QUERY_LANE = SOURCE_UNAVAILABLE_DECLARED_LIMITATION
RANKING_QUERY_OBSERVATIONS_ACQUIRED = 0
ZERO_OBSERVATIONS_MEANS_ZERO_RANKING_QUERIES = false

## Fresh external method check

Rechecked 2026-09-22:
- https://yandex.ru/support/webmaster/ru/recommendations/intro
- https://yandex.ru/support/webmaster/ru/yandex-indexing/webmaster-advice
- https://yandex.com/support/webmaster/en/search-quality

Yandex continues to frame Search around useful/relevant answers for users and describes ranking as depending on query, page content, interaction history and many other signals.

Project application:
COMPETITOR_TOPIC != PROVEN_DEMAND
COMPETITOR_CLAIM != OCTOPORT_PRODUCT_FACT
COMPETITOR_PATTERN != FINAL_PAGE_DECISION

## Work trigger

M4C requires full-volume cross-file reconciliation across R1/R2/fresh R3/durable R4-R5/A1 plus M4B2, with known overlaps and different freshness states.

WORK_TRIGGER = MET

Sampling, first-N and truncation are forbidden.

## Frozen inputs

Exact required files and blob identities:
docs/seo/serp/competitors/M4C_AUTHORITY_MANIFEST_2026-09-22_R1.tsv

No unlisted input may silently become authority.

## Reconciliation model

Every source occurrence remains attributable to its exact source layer/file/row.

Current URL identity:
ENTITY_URL_KEY = registry_id + normalized_comparison_url

Preserve cross-entity collisions.

Fresh R3 is current R3 evidence but not historical R3 bytes. Durable R4/R5/A1 evidence remains valid and can overlap with fresh R3.

Do not add phase totals arithmetically.

Preserve separately:
FRESHEST_ACCESS_OBSERVATION
BEST_AVAILABLE_CONTENT_EVIDENCE

A fresh execution-environment failure must not erase durable successful historical content evidence. If older content is used, label it historical rather than fresh.

Candidate register is occurrence-lossless. A normalized-key match may form a comparison group but is not semantic-identity proof.

## Required outputs — exactly 11

1. M4C_SOURCE_MANIFEST.md
2. M4C_HARDENED_COMPETITOR_REGISTRY.tsv
3. M4C_COVERAGE_LEDGER.tsv
4. M4C_URL_LEDGER.tsv
5. M4C_PAGE_EVIDENCE.tsv
6. M4C_TASK_CAPABILITY_CLAIM_CONTENT_MATRIX.tsv
7. M4C_COMPETITOR_CANDIDATE_REGISTER.tsv
8. M4C_M5_AI_HYPOTHESIS_INPUTS.tsv
9. M4C_M6_DEMAND_GAP_CANDIDATES.tsv
10. M4C_QA.md
11. M4C_RETURN_MANIFEST.json

## Output contract

M4C_HARDENED_COMPETITOR_REGISTRY.tsv:
exactly 60 authorized M4A registry entities; preserve M4A strength/collision authority and add M4B/M4Q synthesis only.

M4C_COVERAGE_LEDGER.tsv:
exactly 60 rows; show M4B lane, source phases, bounded-frontier state, evidence counts and limitations.

M4C_URL_LEDGER.tsv:
one row per deduped ENTITY_URL_KEY with complete multi-phase provenance and no R3/R4/R5 double count.

M4C_PAGE_EVIDENCE.tsv:
one row per entity URL with best available structured content evidence where available; preserve freshness class and contributing evidence IDs.

M4C_TASK_CAPABILITY_CLAIM_CONTENT_MATRIX.tsv:
long-form evidence-backed matrix with page provenance, counts, Octoport overlap/difference and action-boundary notes.

M4C_COMPETITOR_CANDIDATE_REGISTER.tsv:
one row per source candidate occurrence with raw wording and exact provenance; grouping fields may be added without deleting occurrences.

M4C_M5_AI_HYPOTHESIS_INPUTS.tsv:
hypotheses only; no AI provider acquisition.

M4C_M6_DEMAND_GAP_CANDIDATES.tsv:
grouped actionable candidates requiring later demand/gap validation with full contributing provenance.

## Hard QA

LIVE_BRANCH_FETCHED = true
FROZEN_AUTHORITY_BLOBS_MATCH = true
UNLISTED_INPUT_FILES_USED = 0
FRESH_PROVIDER_OR_WEB_ACQUISITION = 0

M4A_REGISTRY_ENTITIES = 60
M4C_REGISTRY_ROWS = 60
M4C_COVERAGE_ROWS = 60
M4B1_REGISTRY_ENTITIES = 45
M4B2_REGISTRY_ENTITIES = 15
MISSING_REGISTRY_IDS = 0
UNAUTHORIZED_REGISTRY_IDS = 0

CURRENT_R3_URL_ROWS = 11222
CURRENT_R3_PAGE_ROWS = 5118
CURRENT_R3_CANDIDATE_ROWS = 5116
M4B2_URL_ROWS = 1476
M4B2_PAGE_ROWS = 1412
M4B2_CANDIDATE_ROWS = 1412

ALL_SOURCE_URL_OCCURRENCES_ACCOUNTED = true
ALL_SOURCE_PAGE_EVIDENCE_ROWS_ACCOUNTED = true
ALL_SOURCE_CANDIDATE_OCCURRENCES_ACCOUNTED = true
URL_ENTITY_KEY_DUPLICATES_IN_FINAL = 0
SILENT_URL_LOSS = 0
SILENT_PAGE_EVIDENCE_LOSS = 0
SILENT_CANDIDATE_LOSS = 0

CURRENT_R3_R4_R5_OVERLAPS_EXPLICITLY_RECONCILED = true
HISTORICAL_ADDITIVE_TOTAL_USED_AS_DEDUPE_AUTHORITY = false
FRESH_ACCESS_FAILURE_ERASED_DURABLE_CONTENT_EVIDENCE = 0

RANKING_QUERY_LANE = SOURCE_UNAVAILABLE_DECLARED_LIMITATION
M4Q_ZERO_ROWS_INTERPRETED_AS_ZERO_QUERIES = false

COMPETITOR_TOPIC_AS_PROVEN_DEMAND = 0
COMPETITOR_CLAIM_AS_OCTOPORT_FACT = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0
ALICE_CALLS = 0
WORDSTAT_CALLS = 0
SEARCH_PROVIDER_CALLS = 0

OPEN_CRITICAL_DEFECTS = 0

## Stop conditions

HOLD_AUTHORITY_DRIFT if a frozen required blob changed.
HOLD_INPUT_ACCOUNTING if accepted source occurrences cannot be reconciled losslessly.
PARTIAL_REWORK_REQUIRED if overlap reconciliation requires silent loss.

Do not fake PASS.

## Publication

Work writes nothing to GitHub.

Work returns one ZIP containing exactly the 11 final files.

Owner uploads all 11 unpacked files together to:
docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/

Main Chat performs remote readback and independent acceptance.

M4C_PREPARATION = COMPLETE
M4C_WORK_START_ALLOWED = false until release remote readback
M7 = BLOCKED
