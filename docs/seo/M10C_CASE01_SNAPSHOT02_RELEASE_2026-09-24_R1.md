# Octoport SEO — M10C Case01 second GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / CASE01 TERMINAL BOUND**

Case: `M10BCASE_e5e5533784063649`
Exact prompt: `ии помощник селлера`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE01_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `43f02c8a9604df35fe2c31fe799fa35d8d84d914`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE01_SNAPSHOT01_RECEIPT_2026-09-24_R1.md`
blob `9b79c9989453be15f5f544916330751b06401baf`.

## Why second snapshot is authorized

Snapshot-1 is technically complete but contains decision-sensitive mixed capability framing across used sources: analytics/read-oriented seller assistance alongside materially stronger automation/write-action framing.

This matches the accepted case variability trigger:
`material source-role or framing inconsistency / product-capability boundary`.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии помощник селлера","confirmBillable":true}
```

Exactly one additional provider request is authorized.

```text
SNAPSHOT_NUMBER = 2
MAX_SNAPSHOTS_FOR_CASE = 2
MAX_ADDITIONAL_COST_RUB = 5.08
```

## Hard stop

After this request, Case01 execution is terminal regardless of semantic similarity/difference.

```text
THIRD_SNAPSHOT = FORBIDDEN
BLIND_RETRY = FORBIDDEN
NEXT_CASE = CLOSED UNTIL SNAPSHOT02 ACCEPTANCE
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without explicit new Main Chat authority, including on parse/delivery failure.

If `request_executed=false`, return exact receipt for reconciliation.