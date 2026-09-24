# Octoport SEO — M10C Case10 first GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case09 terminal closure:
`docs/seo/M10C_CASE09_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `87aa9b11da42e7451119847c0181cd88752f9f40`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Released case

```text
CASE_ID = M10BCASE_975659397140bfbd
SOURCE_M5_HYPOTHESIS = M5H00025
EXACT_AI_PROMPT = ии ассистент для маркетплейсов
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00026
PRIMARY_CLUSTER = M9CL_02025a258eff8c3d
MARKETPLACE_SCOPE = OZON_AND_WILDBERRIES
TASK_SCOPE = native marketplace AI assistant versus the user-selected LLM bridge
```

Frozen uncertainty:
`Whether answers distinguish a native Ozon/WB feature from a separate bridge connecting the user-selected LLM to permitted seller data.`

Expected information gain:
`Observe whether cited source roles distinguish native functionality from bring-your-own-LLM workflows; evaluate possible causal impact on the named cluster page-role HOLD.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии ассистент для маркетплейсов","confirmBillable":true}
```

## Budget / quality rule

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE10_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
QUALITY_PRIORITY = true
```

Specifically watch whether GenSearch frames the task as:
- native Ozon/Wildberries AI functionality;
- a third-party seller tool with its own AI;
- a bridge that connects a user-selected LLM to seller data;
- autonomous/write-action management;
- generic AI content generation without seller-data connection.

If snapshot-1 leaves decision-relevant doubt on these roles or source consistency, snapshot-2 should be used after persistence/readback.

## Hard stop

```text
CASE09 = CLOSED
CASE10_SNAPSHOT02 = CLOSED_PENDING_ASSESSMENT
CASE11 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend this exact snapshot without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.