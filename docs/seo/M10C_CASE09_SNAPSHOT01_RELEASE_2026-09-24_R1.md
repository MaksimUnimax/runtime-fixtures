# Octoport SEO — M10C Case09 first GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case08 terminal closure:
`docs/seo/M10C_CASE08_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `4b34f2b307328df405803f7f08506ece482f725d`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Released case

```text
CASE_ID = M10BCASE_93993613e7003b69
SOURCE_M5_HYPOTHESES = M5H00024 | M5H00053
EXACT_AI_PROMPT = ии для аналитики маркетплейсов
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00027
PRIMARY_CLUSTER = M9CL_db048338baaeca8c
MARKETPLACE_SCOPE = OZON_AND_WILDBERRIES
TASK_SCOPE = seller-owned store analytics versus external market intelligence or promised automation
```

Frozen uncertainty:
`Whether cited sources address seller-owned cabinet data instead of external niche, competitor or general market intelligence.`

Expected information gain:
`Compare source types and claims for owned reports versus external intelligence; test whether the frozen analytics owner/page-role HOLD could later be de-risked or stay unresolved.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии для аналитики маркетплейсов","confirmBillable":true}
```

## Budget / quality rule

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE09_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
QUALITY_PRIORITY = true
```

Because the prompt adds an AI modifier, specifically watch whether GenSearch shifts from ordinary analytics-service comparisons toward:
- AI assistant / seller-owned data interpretation;
- automation or autonomous management;
- external market/niche/competitor intelligence;
- generic AI tooling without proven seller-data access.

If snapshot-1 leaves decision-relevant doubt on these roles or source consistency, snapshot-2 should be used after persistence/readback.

## Hard stop

```text
CASE08 = CLOSED
CASE09_SNAPSHOT02 = CLOSED_PENDING_ASSESSMENT
CASE10 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend this exact snapshot without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.