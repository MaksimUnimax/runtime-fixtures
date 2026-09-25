# Octoport SEO — M10C Case13 second GenSearch snapshot release — 2026-09-25 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / QUALITY-PRIORITY EVIDENCE**

Case: `M10BCASE_ba667d2c39fb39ad`
Exact prompt: `дрр wildberries`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE13_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `ebffc843ea44fb2290bb85b3b5dc9fc0456ee8ce`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE13_SNAPSHOT01_ASSESSMENT_2026-09-25_R1.md`
blob `f13ee2817dcaf73274b209fa35fb10e5f0be8b67`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Why snapshot-2 is authorized

Snapshot-1 is complete but all used evidence is third-party educational/explainer content.

It does not surface official Wildberries campaign/report help, and it does not use an autobidder/write-back source either.

The second snapshot tests whether the answer remains measurement/explanation oriented or shifts toward stronger bid-management/mutation tooling.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"дрр wildberries","confirmBillable":true}
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
- official Wildberries campaign/report-help presence;
- returned and used source sets;
- educational calculation vs campaign-report diagnosis;
- autobidder/bid-management/write-back evidence;
- query expansion and answer stability.

If material decision-relevant uncertainty remains after two valid snapshots, do not close merely to save cost. Create a bounded case amendment before any third request.

## Hard stop

```text
BLIND_RETRY = FORBIDDEN
CASE14 = CLOSED
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without new Main Chat authority.

If `request_executed=false`, return exact receipt for reconciliation.