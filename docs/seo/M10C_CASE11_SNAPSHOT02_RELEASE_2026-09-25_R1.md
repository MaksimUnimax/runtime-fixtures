# Octoport SEO — M10C Case11 second GenSearch snapshot release — 2026-09-25 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / QUALITY-PRIORITY EVIDENCE**

Case: `M10BCASE_a6a64d20ed4e5695`
Exact prompt: `ии агент для wildberries`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE11_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `288ca0f5235ec3646587da858fdc601f0b40e59c`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE11_SNAPSHOT01_ASSESSMENT_2026-09-25_R1.md`
blob `53d61cd6827ef5cba683289db18cb6121e75c22f`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Why snapshot-2 is authorized

Snapshot-1 is technically complete but contains a decision-relevant role split:
- third-party autonomous seller-agent products dominate;
- MarketAut introduces explicit `connect store to any neural network` / BYO-LLM bridge-like framing;
- no native Wildberries AI feature appears.

The second snapshot tests whether this composition is stable and whether native-WB evidence emerges.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии агент для wildberries","confirmBillable":true}
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
- returned and used source sets;
- native Wildberries AI evidence;
- explicit BYO-LLM/bridge evidence;
- third-party autonomous-agent dominance;
- bounded assistant versus autonomous/write capability;
- query expansion and answer stability.

If material decision-relevant uncertainty remains after two valid snapshots, do not close merely to save cost. Create a bounded case amendment before any third request.

## Hard stop

```text
BLIND_RETRY = FORBIDDEN
CASE12 = CLOSED
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without new Main Chat authority.

If `request_executed=false`, return exact receipt for reconciliation.