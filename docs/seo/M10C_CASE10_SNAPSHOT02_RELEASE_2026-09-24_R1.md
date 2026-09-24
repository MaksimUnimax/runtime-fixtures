# Octoport SEO — M10C Case10 second GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / ONE CONDITIONAL SECOND SNAPSHOT / QUALITY-PRIORITY EVIDENCE**

Case: `M10BCASE_975659397140bfbd`
Exact prompt: `ии ассистент для маркетплейсов`

Snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE10_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `a53ad4ada73a15492daeb65af938928b20c7e26b`.

Snapshot-1 assessment:
`docs/seo/M10C_CASE10_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `85e5fc4c4353b69dc10005f68fb2246c19c6f64a`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Why snapshot-2 is authorized

Snapshot-1 is complete but does not directly resolve the frozen native-marketplace-AI vs user-selected-LLM-bridge contrast.

Instead it is dominated by third-party AI products and mixes:
- bounded assistance/analytics;
- review/chat automation;
- broad AI product suites;
- autonomous marketplace management.

The second snapshot tests whether this third-party framing is stable or whether native Ozon/Wildberries functionality or explicit BYO-LLM connector evidence appears.

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии ассистент для маркетплейсов","confirmBillable":true}
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
- native marketplace AI evidence;
- explicit BYO-LLM bridge evidence;
- third-party assistant/service dominance;
- bounded assistant versus autonomous/write capability;
- query expansion and answer stability.

If material decision-relevant uncertainty remains after two valid snapshots, do not close merely to save cost. Create a bounded case amendment before any third request.

## Hard stop

```text
BLIND_RETRY = FORBIDDEN
CASE11 = CLOSED
M10D = BLOCKED
```

If `request_executed=true`, never resend snapshot-2 without new Main Chat authority.

If `request_executed=false`, return exact receipt for reconciliation.