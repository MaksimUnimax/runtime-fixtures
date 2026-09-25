# Octoport SEO — M10C Case15 second GenSearch snapshot release — 2026-09-25 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / FINAL M10C CASE**

Case: `M10BCASE_d7c8eaf031abe40a`
Exact prompt: `отчет маркетплейса озон`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE15_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `0751f2b50dff4605851724158f3ce54d824c1e76`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE15_SNAPSHOT01_ASSESSMENT_2026-09-25_R1.md`
blob `5e038754bab8dad018e02c53230a3e9eadd3f53c`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Why snapshot-2 is authorized

Snapshot-1 is technically complete but:
- no official Ozon seller/help source is used;
- answer synthesis relies on two third-party sources;
- report interpretation is strongly accounting/tax oriented;
- the broad query is narrowed to `отчёт о реализации Ozon`.

The second snapshot tests whether official Ozon provenance appears and whether the accounting/report-realization framing is stable.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"отчет маркетплейса озон","confirmBillable":true}
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
- returned and used source sets;
- report-reading versus accounting/tax/reconciliation roles;
- report-type interpretation;
- query expansion and answer stability.

If material decision-relevant uncertainty remains after two valid snapshots, do not close merely to save cost. Create a bounded case amendment before any third request.

## Hard stop

```text
BLIND_RETRY = FORBIDDEN
THIRD_SNAPSHOT = NOT AUTHORIZED
M10D = BLOCKED UNTIL CASE15 TERMINAL CLOSURE
```

If `request_executed=true`, never resend snapshot-2 without new Main Chat authority.

If `request_executed=false`, return the exact receipt for reconciliation.
