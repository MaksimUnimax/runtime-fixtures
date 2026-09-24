# Octoport SEO — M10C Case05 first GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case04 terminal closure:
`docs/seo/M10C_CASE04_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `68ea695d36045406023b5300453c14f9a89ad18a`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Released case

```text
CASE_ID = M10BCASE_789a835e7de15e13
SOURCE_M5_HYPOTHESIS = M5H00010
EXACT_AI_PROMPT = chatgpt для wildberries
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00002
PRIMARY_CLUSTER = M9CL_ddc2616f80ca85b6
MARKETPLACE_SCOPE = WILDBERRIES
TASK_SCOPE = chosen LLM to authorized seller data versus generic third-party integrations
```

Frozen uncertainty:
`Whether answers present usable seller-data connectivity with the user-selected LLM rather than unsupported autonomous integration, irrelevant developer tooling or no-data links.`

Expected information gain:
`Capture connector/API/help source mix and explanation of seller-owned read-only data access for the exact Search wording; test adjacent frozen connector boundaries without claiming LLM coverage.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"chatgpt для wildberries","confirmBillable":true}
```

## Budget / quality rule

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE05_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
QUALITY_PRIORITY = true
```

Do not close Case05 merely to save cost. If snapshot-1 leaves decision-relevant doubt about source roles, connectivity, marketplace scope, product/capability boundary, or completeness, release snapshot-2 after persistence/readback.

## Hard stop

```text
CASE04 = CLOSED
CASE05_SNAPSHOT02 = CLOSED_PENDING_ASSESSMENT
CASE06 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend this exact snapshot without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.