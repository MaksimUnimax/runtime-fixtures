# Octoport SEO — M10C Case08 terminal GenSearch evidence closure — 2026-09-24 R1

Status: **PASS / CASE08 TERMINAL AFTER 2 VALID SNAPSHOTS / STABLE MIXED OWN-STORE + EXTERNAL-MARKET ANALYTICS WITH SINGLE-SOURCE SYNTHESIS**

Case: `M10BCASE_d3950384418e3bbd`
Exact prompt: `сервис аналитики маркетплейсов`

Snapshot-1 raw:
`docs/seo/evidence/m10c/M10C_CASE08_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `57cb5ac41bf5955edb9bc176faa52c5c02b3aa11`.

Snapshot-2 raw:
`docs/seo/evidence/m10c/M10C_CASE08_SNAPSHOT02_SEARCH_RESULT_V1.json`
blob `bb1e0c425733ebb0991a3cd298dabe3676af940a`.

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
- snapshot-1: `search-5bd426b6-f2ed-4606-9756-07b29bf76970`;
- snapshot-2: `search-bd76ae83-1a4d-4497-a0fa-86310b885c1e`.

## Exact stability comparison

```text
SOURCE_COUNT = 10 vs 9
COMMON_SOURCE_URLS = 9
USED_SOURCE_COUNT = 1 vs 1
USED_SOURCE_URL_SET_EQUAL = true
USED_SOURCE = Tproger roundup in both snapshots
SEARCH_QUERY_TEXTS_EQUAL = true
QUERY_1 = как анализировать маркетплейсы 2026
QUERY_2 = лучшие сервисы аналитики маркетплейсов 2026
HINTS_EQUAL = true
ANSWER_TEXT_BYTE_EQUAL = false
ANSWER_TOKEN_SET_JACCARD = 0.978261
```

The only returned-source-set difference is one unused vc.ru roundup present in snapshot-1 and absent in snapshot-2.

## Stable semantic observation

Both snapshots reproduce the same answer structure from the same single used roundup source:

1. **Seller-owned / operational analytics**
   - orders, stock, logistics, margin, SKU dynamics, supply planning, unit economics.

2. **External market / competitor intelligence**
   - competitor positions, category dynamics, demand, niche attractiveness, market trends and competitive changes.

3. **Operational/automation adjacency**
   - supply-management automation and related management tooling.

The query expansion remains ranking/comparison oriented in both runs, reinforcing a broad comparative-service framing.

Therefore:
```text
CASE08_TERMINAL_EVIDENCE_STATE = STABLE_MIXED_OWNED_AND_EXTERNAL_ANALYTICS_SINGLE_SOURCE_SYNTHESIS
USED_SOURCE_CONCENTRATION = 1_SOURCE_IN_BOTH_SNAPSHOTS
OWNED_VS_EXTERNAL_BOUNDARY_REMAINS_MIXED = true
QUERY_EXPANSION_RANKING_ORIENTED = true
ADDITIONAL_INFORMATION_GAIN_FROM_IMMEDIATE_THIRD_SNAPSHOT = LOW
CASE08_PROVIDER_EXECUTION = CLOSED
```

Under the owner quality-priority directive, Case08 closes because two independent observations resolve the sampling doubt: the mixed boundary and single-source synthesis are persistent, not because further requests are being avoided for cost.

## Causal boundary

M10C does not choose the final M10D outcome, page ownership, merge/split, demand, product promise, URL, H1, Title or IA.

GenSearch provenance remains distinct from consumer Alice.