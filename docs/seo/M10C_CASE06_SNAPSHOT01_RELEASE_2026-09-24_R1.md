# Octoport SEO — M10C Case06 first GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case05 terminal closure:
`docs/seo/M10C_CASE05_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `299d03c54f92971ad68ea290c60f14345a2f6fef`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Released case

```text
CASE_ID = M10BCASE_9ef8cb07387160b6
SOURCE_M5_HYPOTHESIS = M5H00012
EXACT_AI_PROMPT = подключить chatgpt к маркетплейсу
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00013
PRIMARY_CLUSTER = M9CL_710c43ac2fdf4cc7
MARKETPLACE_SCOPE = OZON
TASK_SCOPE = chosen LLM to authorized seller data versus generic third-party integrations
```

Frozen uncertainty:
`Whether answers present usable seller-data connectivity with the user-selected LLM rather than unsupported autonomous integration, irrelevant developer tooling or no-data links.`

Expected information gain:
`Capture connector/API/help source mix and explanation of seller-owned read-only data access for the exact Search wording; test adjacent frozen connector boundaries without claiming LLM coverage.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"подключить chatgpt к маркетплейсу","confirmBillable":true}
```

## Budget / quality rule

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE06_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
QUALITY_PRIORITY = true
```

If snapshot-1 leaves decision-relevant doubt about connector/API evidence, seller-data access, marketplace scope, no-data/content-only alternatives, or autonomous/write-action capability, snapshot-2 should be used after persistence/readback.

## Hard stop

```text
CASE05 = CLOSED
CASE06_SNAPSHOT02 = CLOSED_PENDING_ASSESSMENT
CASE07 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend this exact snapshot without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.