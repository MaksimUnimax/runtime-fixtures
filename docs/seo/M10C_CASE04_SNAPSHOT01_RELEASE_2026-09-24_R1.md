# Octoport SEO — M10C Case04 first GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case03 terminal closure:
`docs/seo/M10C_CASE03_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `34fbfeda446ed1ac1d7c108443f0b973f23ee8c5`.

## Released case

```text
CASE_ID = M10BCASE_e56413a05b57e358
SOURCE_M5_HYPOTHESIS = M5H00006
EXACT_AI_PROMPT = chatgpt для ozon
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00001
PRIMARY_CLUSTER = M9CL_bae58ac9423f9f3c
MARKETPLACE_SCOPE = OZON
TASK_SCOPE = chosen LLM to authorized seller data versus generic third-party integrations
```

Frozen uncertainty:
`Whether answers present usable seller-data connectivity with the user-selected LLM rather than unsupported autonomous integration, irrelevant developer tooling or no-data links.`

Expected information gain:
`Capture connector/API/help source mix and explanation of seller-owned read-only data access for the exact Search wording; test adjacent frozen connector boundaries without claiming LLM coverage.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"chatgpt для ozon","confirmBillable":true}
```

## Budget

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE04_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
```

## Repeat gate

Second snapshot is allowed only after snapshot-1 is persisted/read back and an accepted variability trigger is observed:
- material source-role/framing inconsistency;
- decision-sensitive interpretation of seller connectivity;
- product/capability-boundary ambiguity;
- partial/incomplete answer or citations.

## Hard stop

```text
CASE01 = CLOSED
CASE02 = CLOSED
CASE03 = CLOSED
CASE04_SNAPSHOT02 = CLOSED
CASE05 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend snapshot-1 under any error/parse/delivery condition without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.