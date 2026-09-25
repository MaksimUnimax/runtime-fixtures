# Octoport SEO — M10C Case12 second GenSearch snapshot release — 2026-09-25 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / QUALITY-PRIORITY EVIDENCE**

Case: `M10BCASE_905d903673405cdf`
Exact prompt: `отчет маркетплейса вайлдберриз`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE12_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `707a4f63595a005469b3066005e578bc0f38a13e`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE12_SNAPSHOT01_ASSESSMENT_2026-09-25_R1.md`
blob `9a1c3fcbe3048605b4cd63586729625ad8db6860`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Why snapshot-2 is authorized

Snapshot-1 is complete but all five used sources are third-party; no official Wildberries seller/help source appears.

The answer also mixes:
- seller report reading;
- payout/realization reconciliation;
- profitability/accounting-adjacent calculations;
- current-year report/tax/availability claims.

The second snapshot tests whether official Wildberries evidence appears and whether the same third-party financial/reconciliation framing persists.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"отчет маркетплейса вайлдберриз","confirmBillable":true}
```

Exactly one additional provider request is authorized.

```text
SNAPSHOT_NUMBER = 2
CURRENT_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
MAX_ADDITIONAL_COST_RUB = 5.08
QUALITY_PRIORITY = true
```

## Post-snapshot quality rule

After snapshot-2 Main Chat must compare:
- official Wildberries seller/help presence;
- returned and used source sets;
- report-reading versus payout/reconciliation/accounting roles;
- current-year factual claims and their source roles;
- query expansion and answer stability.

If material decision-relevant uncertainty remains after two valid snapshots, do not close merely to save cost. Create a bounded case amendment before any third request.

## Hard stop

```text
BLIND_RETRY = FORBIDDEN
CASE13 = CLOSED
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without new Main Chat authority.

If `request_executed=false`, return exact receipt for reconciliation.