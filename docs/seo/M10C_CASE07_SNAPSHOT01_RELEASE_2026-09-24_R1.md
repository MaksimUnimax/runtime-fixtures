# Octoport SEO — M10C Case07 first GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case06 terminal closure:
`docs/seo/M10C_CASE06_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `39954bd37a11917af9b0f8dbc47e12bc2f4edb2e`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Released case

```text
CASE_ID = M10BCASE_503322b8af3825a8
SOURCE_M5_HYPOTHESIS = M5H00016
EXACT_AI_PROMPT = ии агенты для маркетплейсов
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00008
PRIMARY_CLUSTER = M9CL_25bf819e5778d7d3
MARKETPLACE_SCOPE = OZON_AND_WILDBERRIES
TASK_SCOPE = seller-owned chat assistance versus a human manager, autonomous agent, or native marketplace bot
```

Frozen uncertainty:
`Whether the cited answers distinguish seller-owned read-only chat assistance from hiring a person, autonomous business actions and native bots.`

Expected information gain:
`Compare cited source roles and framing for an agent/helper task against the frozen Search-only owner/page-role HOLD; an AI answer may de-risk or enrich interpretation but cannot itself merge/split pages.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии агенты для маркетплейсов","confirmBillable":true}
```

## Budget / quality rule

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE07_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
QUALITY_PRIORITY = true
```

If snapshot-1 leaves decision-relevant doubt about autonomous/write behavior, seller-owned data assistance, marketplace scope, human-manager framing, native bots, or source-role consistency, snapshot-2 should be used after persistence/readback.

## Hard stop

```text
CASE06 = CLOSED
CASE07_SNAPSHOT02 = CLOSED_PENDING_ASSESSMENT
CASE08 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend this exact snapshot without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.