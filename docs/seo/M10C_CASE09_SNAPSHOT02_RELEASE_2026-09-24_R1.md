# Octoport SEO — M10C Case09 second GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / QUALITY-PRIORITY EVIDENCE**

Case: `M10BCASE_93993613e7003b69`
Exact prompt: `ии для аналитики маркетплейсов`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE09_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `a8951faaea116b17033b46fcad1bfa01b3d4d2d8`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE09_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `3d19660a49488a4fbd3eed00e6a639a92619fe72`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Why snapshot-2 is authorized

Snapshot-1 leans strongly toward seller-owned operational analytics, but its used sources span distinct access/capability models:
- data/report analysis;
- live API-synchronized store data;
- broader AI workflows over cards/reviews/reports.

The second snapshot tests whether the own-store analytics emphasis is stable or whether the answer shifts toward external intelligence or broader automation.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии для аналитики маркетплейсов","confirmBillable":true}
```

Exactly one additional provider request is authorized.

```text
SNAPSHOT_NUMBER = 2
CURRENT_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
MAX_ADDITIONAL_COST_RUB = 5.08
```

## Post-snapshot quality rule

After snapshot-2 Main Chat must compare:
- returned and used source sets;
- own-store versus external-market framing;
- live API versus file/report analysis;
- automation/capability scope;
- query expansion and answer stability.

If material decision-relevant uncertainty remains after two valid snapshots, do not close merely to save cost. Create a bounded case amendment before any third request.

## Hard stop

```text
BLIND_RETRY = FORBIDDEN
CASE10 = CLOSED
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without new Main Chat authority.

If `request_executed=false`, return exact receipt for reconciliation.