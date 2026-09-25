# Octoport SEO — M10C Case11 first GenSearch snapshot release — 2026-09-25 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case10 terminal closure:
`docs/seo/M10C_CASE10_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `77181ac45e47757115fd1bd389964e58ba13523a`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Released case

```text
CASE_ID = M10BCASE_a6a64d20ed4e5695
SOURCE_M5_HYPOTHESES = M5H00026 | M5H00027
EXACT_AI_PROMPT = ии агент для wildberries
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00006
PRIMARY_CLUSTER = M9CL_b875735bfe0783e3
MARKETPLACE_SCOPE = WILDBERRIES
TASK_SCOPE = native marketplace AI assistant versus the user-selected LLM bridge
```

Frozen uncertainty:
`Whether answers distinguish a native Ozon/WB feature from a separate bridge connecting the user-selected LLM to permitted seller data.`

Expected information gain:
`Observe whether cited source roles distinguish native functionality from bring-your-own-LLM workflows; evaluate possible causal impact on the named cluster page-role HOLD.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии агент для wildberries","confirmBillable":true}
```

## Budget / quality rule

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE11_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
QUALITY_PRIORITY = true
```

Specifically watch whether GenSearch frames the Wildberries-specific query as:
- native Wildberries AI functionality;
- a third-party seller AI product;
- a bridge connecting a user-selected LLM to seller data;
- autonomous/write-action management;
- bounded analytics/chat assistance.

If snapshot-1 leaves decision-relevant doubt on these roles or source consistency, snapshot-2 should be used after persistence/readback.

## Hard stop

```text
CASE10 = CLOSED
CASE11_SNAPSHOT02 = CLOSED_PENDING_ASSESSMENT
CASE12 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend this exact snapshot without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.