# Octoport SEO — M10C Case03 first GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case02 terminal closure:
`docs/seo/M10C_CASE02_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `2b505708271f31cedc7591a829a1f85c812585a9`.

## Released case

```text
CASE_ID = M10BCASE_840dee47a90532a8
SOURCE_M5_HYPOTHESIS = M5H00005
EXACT_AI_PROMPT = ии агент для озон
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00007
PRIMARY_CLUSTER = M9CL_086ce4445a21d4fd
MARKETPLACE_SCOPE = OZON
TASK_SCOPE = seller-owned chat assistance versus a human manager, autonomous agent, or native marketplace bot
```

Frozen uncertainty:
`Whether the cited answers distinguish seller-owned read-only chat assistance from hiring a person, autonomous business actions and native bots.`

Expected information gain:
`Compare cited source roles and framing for an agent/helper task against the frozen Search-only owner/page-role HOLD; an AI answer may de-risk or enrich interpretation but cannot itself merge/split pages.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии агент для озон","confirmBillable":true}
```

## Budget

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE03_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
```

## Repeat gate

Second snapshot is allowed only after snapshot-1 is persisted/read back and an accepted variability trigger is observed:
- material source-role/framing inconsistency;
- decision-sensitive seller-task interpretation conflict;
- product/capability-boundary ambiguity;
- partial/incomplete answer or citations.

## Hard stop

```text
CASE01 = CLOSED
CASE02 = CLOSED
CASE03_SNAPSHOT02 = CLOSED
CASE04 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend snapshot-1 under any error/parse/delivery condition without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.