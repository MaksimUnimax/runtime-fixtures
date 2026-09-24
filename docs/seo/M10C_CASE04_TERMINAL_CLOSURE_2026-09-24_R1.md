# Octoport SEO — M10C Case04 terminal GenSearch evidence closure — 2026-09-24 R1

Status: **PASS / CASE04 TERMINAL AFTER 2 VALID SNAPSHOTS / STABLE MIXED CONNECTOR-CONTENT-ANALYTICS FRAMING**

Case: `M10BCASE_e56413a05b57e358`
Exact prompt: `chatgpt для ozon`

Snapshot-1 raw:
`docs/seo/evidence/m10c/M10C_CASE04_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `57df01f760eaebe7ef02c4a8c5374c4bffcc51a9`.

Snapshot-2 raw:
`docs/seo/evidence/m10c/M10C_CASE04_SNAPSHOT02_SEARCH_RESULT_V1.json`
blob `851c4040e0f8fab837c6726eb13165f0d35b3654`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Transport / provider reconciliation

```text
SNAPSHOT_COUNT = 2
HTTP_200 = 2/2
STATUS_OK = 2/2
REQUEST_EXECUTED_TRUE = 2/2
AUTOMATIC_RETRY_FALSE = 2/2
RESULT_MODE_GENERATIVE = 2/2
TRANSPORT_JSON_ARRAY = 2/2
TRANSPORT_FRAME_COUNT_1 = 2/2
IS_BULLET_ANSWER_TRUE = 2/2
PROBLEMATIC_ANSWER_FALSE = 2/2
ESTIMATED_TOTAL_PROVIDER_COST_RUB = 10.16
```

Request IDs:
- snapshot-1: `search-59200248-1c6c-4ff8-ab34-846ce8d5a4e8`;
- snapshot-2: `search-913a0c24-3471-4f21-8de4-a5dec93fa1f6`.

## Exact stability comparison

```text
SOURCE_COUNT = 7 vs 7
SOURCE_URL_SET_EQUAL = true
USED_SOURCE_URL_SET_EQUAL = true
USED_SOURCE_COUNT = 6 vs 6
SOURCE_ORDER_EQUAL = false
SEARCH_QUERY_TEXTS_EQUAL = true
SEARCH_QUERY_TEXTS = [как использовать chatgpt для ozon, chatgpt для ozon] in both
HINTS = [] in both
ANSWER_TEXT_BYTE_EQUAL = false
ANSWER_TOKEN_SET_JACCARD = 0.858025
```

## Stable semantic observation

Both snapshots preserve the same three materially distinct answer roles:

1. **Connector/API integration** — ApiMonster and JAFO;
2. **Generic ChatGPT content production without live seller-data connection** — Cossa, XWAY and Ozon seller media;
3. **Marketplace export/analytics usage** — Tablichki.

The source ordering changes, and local wording changes, but the source-role mixture is stable across independent snapshots.

Therefore the initial mixed framing is not a one-off result.

```text
CASE04_TERMINAL_EVIDENCE_STATE = STABLE_MIXED_CONNECTOR_CONTENT_ANALYTICS_FRAMING
VARIABILITY = LOW_AT_SOURCE_SET / LOW_AT_QUERY_EXPANSION / MODERATE_AT_ORDER_AND_WORDING
ADDITIONAL_INFORMATION_GAIN_FROM_IMMEDIATE_THIRD_SNAPSHOT = LOW
CASE04_PROVIDER_EXECUTION = CLOSED
```

Under the owner quality-priority directive, a case is not closed merely to save money. Case04 closes because two independent valid observations already reproduce the decision-relevant structure; no material unresolved sampling doubt remains.

## Causal boundary

M10C does not choose a final M10D outcome, demand, page owner, cluster merge/split, URL, H1, Title or IA.

GenSearch remains distinct from consumer Alice.