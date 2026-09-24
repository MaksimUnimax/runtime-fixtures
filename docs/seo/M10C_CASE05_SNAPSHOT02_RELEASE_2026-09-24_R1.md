# Octoport SEO — M10C Case05 second GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / QUALITY-PRIORITY EVIDENCE**

Case: `M10BCASE_789a835e7de15e13`
Exact prompt: `chatgpt для wildberries`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE05_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `84d4651a5f19133490c0b4bffee1a2d19fcd47bc`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE05_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `a3306ec80359ebeb5a4637fa9b1092a794ee88ac`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Why snapshot-2 is authorized

Snapshot-1 is complete but contains two materially different connectivity modes:
- live/API connector/cabinet access;
- file/report/Data-Analysis workflows.

That ambiguity is decision-relevant to the frozen M10A connectivity boundary and remains unresolved after one observation.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"chatgpt для wildberries","confirmBillable":true}
```

Exactly one additional provider request is authorized.

```text
SNAPSHOT_NUMBER = 2
CURRENT_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
MAX_ADDITIONAL_COST_RUB = 5.08
```

## Post-snapshot rule

After snapshot-2, Main Chat must compare:
- exact source URL set;
- used-source set;
- query expansion;
- answer framing;
- connector/API versus file/report-analysis balance;
- marketplace/task consistency.

If two snapshots resolve the uncertainty sufficiently, close Case05.

If a material decision-relevant doubt remains after two valid snapshots, do **not** close merely to save cost. Instead Main Chat must create a bounded case amendment before any third request.

## Hard stop

```text
BLIND_RETRY = FORBIDDEN
CASE06 = CLOSED
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.