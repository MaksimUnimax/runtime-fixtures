# Octoport SEO — M10C Case14 second GenSearch snapshot release — 2026-09-25 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / QUALITY-PRIORITY EVIDENCE**

Case: `M10BCASE_adb2e167115fbbbd`
Exact prompt: `отчеты маркетплейсов`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE14_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `80f46164b9f6f48f8b41e22cf994ea7b69e95356`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE14_SNAPSHOT01_ASSESSMENT_2026-09-25_R1.md`
blob `5a90e5f5cab4ced9190994171c24e09f903b9694`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Why snapshot-2 is authorized

Snapshot-1 is complete but mixes an official Ozon seller-report/process source with third-party accounting/reporting material and current regulatory context.

The second snapshot tests whether:
- official Ozon seller evidence persists;
- any official Wildberries report/help source appears;
- seller-report reading remains mixed with accounting/statutory framing;
- year-specific query expansion continues to bias toward regulatory material.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"отчеты маркетплейсов","confirmBillable":true}
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
- official Ozon seller/help presence;
- official Wildberries seller/help presence;
- returned and used source sets;
- report-reading versus statutory/accounting/reconciliation roles;
- current-year claims and query expansion;
- answer stability.

If material decision-relevant uncertainty remains after two valid snapshots, do not close merely to save cost. Create a bounded case amendment before any third request.

## Hard stop

```text
BLIND_RETRY = FORBIDDEN
CASE15 = CLOSED
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without new Main Chat authority.

If `request_executed=false`, return exact receipt for reconciliation.