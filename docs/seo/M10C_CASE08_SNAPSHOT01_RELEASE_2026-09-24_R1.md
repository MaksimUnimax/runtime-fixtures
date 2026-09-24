# Octoport SEO — M10C Case08 first GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case07 terminal closure:
`docs/seo/M10C_CASE07_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `e6de4bf06b0745a253edafd3acbf18294211d00f`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Released case

```text
CASE_ID = M10BCASE_d3950384418e3bbd
SOURCE_M5_HYPOTHESIS = M5H00023
EXACT_AI_PROMPT = сервис аналитики маркетплейсов
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00042
PRIMARY_CLUSTER = M9CL_ed2d7aae5a2e620a
MARKETPLACE_SCOPE = MARKETPLACE_UNSPECIFIED
TASK_SCOPE = seller-owned store analytics versus external market intelligence or promised automation
```

Frozen uncertainty:
`Whether cited sources address seller-owned cabinet data instead of external niche, competitor or general market intelligence.`

Expected information gain:
`Compare source types and claims for owned reports versus external intelligence; test whether the frozen analytics owner/page-role HOLD could later be de-risked or stay unresolved.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"сервис аналитики маркетплейсов","confirmBillable":true}
```

## Budget / quality rule

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE08_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
QUALITY_PRIORITY = true
```

If snapshot-1 leaves decision-relevant doubt about own-store analytics vs external market/competitor intelligence, source-role consistency, promised automation, or completeness, snapshot-2 should be used after persistence/readback.

## Hard stop

```text
CASE07 = CLOSED
CASE08_SNAPSHOT02 = CLOSED_PENDING_ASSESSMENT
CASE09 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend this exact snapshot without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.