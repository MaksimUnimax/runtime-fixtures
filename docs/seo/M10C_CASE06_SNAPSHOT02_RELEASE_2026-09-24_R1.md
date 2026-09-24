# Octoport SEO — M10C Case06 second GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / QUALITY-PRIORITY EVIDENCE**

Case: `M10BCASE_9ef8cb07387160b6`
Exact prompt: `подключить chatgpt к маркетплейсу`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE06_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `1bcbd9b49744ea6b5b43f678989f0ec5f25c58c2`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE06_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `edcdf2a1bdfc693eec00c1afe18a1f77587d5b36`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Why snapshot-2 is authorized

Snapshot-1 is complete but includes:
- an irrelevant Bitrix24 app-marketplace source marked used=true;
- direct connector/API evidence;
- broad/general ChatGPT marketplace workflow evidence;
- file/report analytics;
- autonomous-management framing.

This is decision-relevant scope contamination and connectivity-mode ambiguity.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"подключить chatgpt к маркетплейсу","confirmBillable":true}
```

Exactly one additional provider request is authorized.

```text
SNAPSHOT_NUMBER = 2
CURRENT_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
MAX_ADDITIONAL_COST_RUB = 5.08
```

## Post-snapshot quality rule

After snapshot-2 Main Chat must compare source scope, used-source set, connector/API vs report/content roles, query expansion and seller-marketplace relevance.

If two valid snapshots still leave material decision-relevant uncertainty, do not close for cost. Create a bounded case amendment before any third request.

## Hard stop

```text
BLIND_RETRY = FORBIDDEN
CASE07 = CLOSED
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without new Main Chat authority.

If `request_executed=false`, return exact receipt for reconciliation.