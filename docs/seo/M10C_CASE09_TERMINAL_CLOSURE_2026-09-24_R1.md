# Octoport SEO — M10C Case09 terminal GenSearch evidence closure — 2026-09-24 R1

Status: **PASS / CASE09 TERMINAL AFTER 2 VALID SNAPSHOTS / STABLE OWN-STORE AI-ANALYTICS LEAN WITH MIXED ACCESS MODES**

Case: `M10BCASE_93993613e7003b69`
Exact prompt: `ии для аналитики маркетплейсов`

Snapshot-1 raw:
`docs/seo/evidence/m10c/M10C_CASE09_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `a8951faaea116b17033b46fcad1bfa01b3d4d2d8`.

Snapshot-2 raw:
`docs/seo/evidence/m10c/M10C_CASE09_SNAPSHOT02_SEARCH_RESULT_V1.json`
blob `8970605ac5dd0f35f8125cc4dbbf02abbdabe5da`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Provider reconciliation

```text
SNAPSHOT_COUNT = 2
HTTP_200 = 2/2
STATUS_OK = 2/2
REQUEST_EXECUTED_TRUE = 2/2
AUTOMATIC_RETRY_FALSE = 2/2
RESULT_MODE_GENERATIVE = 2/2
TRANSPORT_JSON_ARRAY = 2/2
TRANSPORT_FRAME_COUNT_1 = 2/2
PROBLEMATIC_ANSWER_FALSE = 2/2
ESTIMATED_TOTAL_PROVIDER_COST_RUB = 10.16
```

Request IDs:
- snapshot-1: `search-c2bb0393-3e2c-4246-80bb-2705c209284f`;
- snapshot-2: `search-58b88d6b-a5ca-4fc5-a978-c2c0d65856ed`.

## Exact stability comparison

```text
SOURCE_COUNT = 5 vs 10
COMMON_RETURNED_SOURCE_URLS = 4
USED_SOURCE_COUNT = 3 vs 3
USED_SOURCE_URL_SET_EQUAL = true
USED_SOURCES = Tablichki + RocketMetrix + Komanda.ai in both
QUERY_EXPANSION_EQUAL = false
SNAPSHOT1_QUERY = ии для аналитики маркетплейсов
SNAPSHOT2_QUERIES = лучшие ии для аналитики маркетплейсов 2026 | ии для аналитики маркетплейсов
HINTS_EQUAL = false
ANSWER_TEXT_BYTE_EQUAL = false
ANSWER_TOKEN_SET_JACCARD = 0.774194
```

## Stable semantic observation

Despite a materially larger returned-source pool in snapshot-2 and a ranking-oriented auxiliary query, the provider selected the same three sources for answer synthesis in both snapshots:
- Tablichki — ChatGPT/data analysis over marketplace data;
- RocketMetrix — direct Ozon/Wildberries store API connection and synchronized operational analytics;
- Komanda.ai — broader AI workflow over marketplace data, cards, reviews and reports.

The generated answer remains centered on seller-owned operational analytics:
- sales and orders;
- stock and supply;
- funnel;
- advertising metrics including DRR;
- unit economics.

External/ranking sources added in snapshot-2 remained `used=false`.

Therefore:
```text
CASE09_TERMINAL_EVIDENCE_STATE = STABLE_OWN_STORE_AI_ANALYTICS_LEAN_WITH_MIXED_ACCESS_MODES
USED_SOURCE_SELECTION_STABLE = true
OWN_STORE_ANALYTICS_DOMINANT = true
EXTERNAL_RANKING_SOURCE_CONTAMINATION_IN_SYNTHESIS = false
ACCESS_MODE_MIX = FILE_OR_DATA_ANALYSIS + LIVE_API + BROADER_AI_WORKFLOW
ADDITIONAL_INFORMATION_GAIN_FROM_IMMEDIATE_THIRD_SNAPSHOT = LOW
CASE09_PROVIDER_EXECUTION = CLOSED
```

Under the owner quality-priority directive, Case09 closes because the decision-relevant source selection and own-store semantic direction are stable across two independent snapshots, not for cost minimization.

## Causal boundary

M10C does not choose the final M10D outcome, page ownership, merge/split, demand, product promise, URL, H1, Title or IA.

GenSearch provenance remains distinct from consumer Alice.