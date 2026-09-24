# Octoport SEO — M10C Case04 second GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / CASE04 TERMINAL BOUND**

Case: `M10BCASE_e56413a05b57e358`
Exact prompt: `chatgpt для ozon`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE04_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `57df01f760eaebe7ef02c4a8c5374c4bffcc51a9`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE04_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `37f4bada33ae9a159a5ceb1556788070f6443e63`.

## Why second snapshot is authorized

Snapshot-1 is technically complete but combines materially different source roles and task framings:
- live connector/API integration;
- generic content generation without seller-data connection;
- export/offline analytics.

This matches the accepted Case04 variability trigger for source-role/framing inconsistency and seller-connectivity ambiguity.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"chatgpt для ozon","confirmBillable":true}
```

Exactly one additional provider request is authorized.

```text
SNAPSHOT_NUMBER = 2
MAX_SNAPSHOTS_FOR_CASE = 2
MAX_ADDITIONAL_COST_RUB = 5.08
```

## Hard stop

After this request, Case04 execution is terminal regardless of semantic similarity/difference.

```text
THIRD_SNAPSHOT = FORBIDDEN
BLIND_RETRY = FORBIDDEN
CASE05 = CLOSED UNTIL SNAPSHOT02 ACCEPTANCE
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without explicit new Main Chat authority, including on parse/delivery failure.

If `request_executed=false`, return exact receipt for reconciliation.