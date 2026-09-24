# Octoport SEO — M10C Case01 terminal GenSearch evidence closure — 2026-09-24 R1

Status: **PASS / CASE01 TERMINAL AFTER 2 OF 2 SNAPSHOTS / STABLE MIXED CAPABILITY FRAMING**

Case:
`M10BCASE_e5e5533784063649`

Exact prompt:
`ии помощник селлера`

Snapshot-1 raw:
`docs/seo/evidence/m10c/M10C_CASE01_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `43f02c8a9604df35fe2c31fe799fa35d8d84d914`.

Snapshot-2 raw:
`docs/seo/evidence/m10c/M10C_CASE01_SNAPSHOT02_SEARCH_RESULT_V1.json`
blob `e369c154a995803aae1747649e36b0d1615525b2`.

## Transport / execution reconciliation

```text
SNAPSHOT_COUNT = 2/2
HTTP_200 = 2/2
STATUS_OK = 2/2
REQUEST_EXECUTED_TRUE = 2/2
AUTOMATIC_RETRY_FALSE = 2/2
RESULT_MODE_GENERATIVE = 2/2
TRANSPORT_JSON_ARRAY = 2/2
TRANSPORT_FRAME_COUNT_1 = 2/2
IS_ANSWER_REJECTED_FALSE = 2/2
PROBLEMATIC_ANSWER_FALSE = 2/2
PROVIDER_REQUESTS = 2
ESTIMATED_TOTAL_COST_RUB = 10.16
```

Request IDs:
- snapshot-1: `search-bd634526-efca-44a3-bdf4-3bd12801a529`;
- snapshot-2: `search-b1e138cb-4c3e-4cc3-b0ef-6c537da590bb`.

## Stability comparison

```text
SOURCE_ROWS = 5 vs 5
EXACT_SOURCE_URL_TITLE_USED_ROWS_EQUAL = true
USED_TRUE_COUNT = 4 vs 4
USED_MASK_EQUAL = true
SEARCH_QUERY_TEXTS_EQUAL = true
HINTS_EQUAL = true
ANSWER_TEXT_BYTE_EQUAL = false
ANSWER_TOKEN_SET_JACCARD = 0.877049
```

The generated answer wording changed locally, mainly in the ILAI description. The source set, source-use decisions, prompt/query expansion and hint set remained unchanged.

## Stable semantic observation

Both snapshots consistently mix seller-assistant roles across a capability spectrum:

- analytics / reporting / seller-data assistance;
- monitoring and recommendations;
- broader seller tooling;
- stronger automation/write-action behavior, including product-card export and promotions management in the InfoSell framing.

The second snapshot therefore confirms that snapshot-1 mixed capability framing was not a one-off source-composition anomaly.

```text
CASE01_TERMINAL_EVIDENCE_STATE = STABLE_MIXED_CAPABILITY_FRAMING
VARIABILITY = LOW_AT_SOURCE_SET / LOW_AT_QUERY_EXPANSION / MODERATE_AT_WORDING
THIRD_SNAPSHOT = FORBIDDEN
CASE01_PROVIDER_EXECUTION = CLOSED
```

## Causal boundary

This closure does not choose a final M10D outcome.

Allowed later M10D interpretation remains:
`CHANGE | ENRICH | DE_RISK | NO_CHANGE | HOLD`.

M10D must compare this terminal AI evidence to the frozen M10A HOLD and product truth; M10C does not merge/split clusters, assign page owners, create pages, or infer demand.

GenSearch provenance remains distinct from consumer Alice.