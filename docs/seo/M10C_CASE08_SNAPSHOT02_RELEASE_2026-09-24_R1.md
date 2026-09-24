# Octoport SEO — M10C Case08 second GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / QUALITY-PRIORITY EVIDENCE**

Case: `M10BCASE_d3950384418e3bbd`
Exact prompt: `сервис аналитики маркетплейсов`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE08_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `57cb5ac41bf5955edb9bc176faa52c5c02b3aa11`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE08_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `9b4852a26d5c6bd90688c99413fad4327e231cae`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Why snapshot-2 is authorized

Snapshot-1 is technically complete but leaves two decision-relevant uncertainties:
- own-store operational analytics and external competitor/niche intelligence are mixed in one answer;
- answer synthesis relies on only 1 used source out of 10 returned sources.

GenSearch also expanded the exact prompt into ranking/comparison queries, which may bias source selection toward generic analytics roundups.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"сервис аналитики маркетплейсов","confirmBillable":true}
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
- used-source concentration;
- query expansion;
- own-store versus external-market function mix;
- whether one mode becomes stable/dominant or the mixed boundary persists.

If material decision-relevant uncertainty remains after two valid snapshots, do not close merely to save cost. Create a bounded case amendment before any third request.

## Hard stop

```text
BLIND_RETRY = FORBIDDEN
CASE09 = CLOSED
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without new Main Chat authority.

If `request_executed=false`, return exact receipt for reconciliation.