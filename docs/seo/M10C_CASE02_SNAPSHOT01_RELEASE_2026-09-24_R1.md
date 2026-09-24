# Octoport SEO — M10C Case02 first GenSearch snapshot release — 2026-09-24 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case01 terminal closure:
`docs/seo/M10C_CASE01_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `607062e3913d8683942af82ceccbd77413fa2a27`.

## Released case

```text
CASE_ID = M10BCASE_c0815ba7ee0ba5b2
SOURCE_M5_HYPOTHESIS = M5H00002
EXACT_AI_PROMPT = подключить ии к маркетплейсу
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00037
PRIMARY_CLUSTER = M9CL_3f05678ef9d62960
MARKETPLACE_SCOPE = OZON_AND_WILDBERRIES
TASK_SCOPE = chosen LLM to authorized seller data versus generic third-party integrations
```

Frozen uncertainty:
`Whether answers present usable seller-data connectivity with the user-selected LLM rather than unsupported autonomous integration, irrelevant developer tooling or no-data links.`

Expected information gain:
`Capture connector/API/help source mix and explanation of seller-owned read-only data access for the exact Search wording; test adjacent frozen connector boundaries without claiming LLM coverage.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"подключить ии к маркетплейсу","confirmBillable":true}
```

## Budget

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE02_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
```

## Evidence capture

Persist full `SEARCH_RESULT_V1` including:
- request_id / status / http_status / elapsed_ms;
- request_executed / automatic_retry;
- exact command;
- complete answer body;
- every source URL/title/used;
- every searchQueries text/reqId;
- fixedMisspellQuery / isAnswerRejected / isBulletAnswer / hints / problematicAnswer;
- transport wire_format/frame_count.

## Repeat gate

Second snapshot is allowed only after snapshot-1 is persisted/read back and one accepted variability trigger is actually observed:
- material shift/inconsistency in cited URL/source roles;
- decision-sensitive interpretation of seller task;
- product/capability-boundary ambiguity;
- partial/incomplete answer or citations.

## Hard stop

```text
CASE01_THIRD_SNAPSHOT = FORBIDDEN
CASE02_SNAPSHOT02 = CLOSED
CASE03 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend this snapshot under any error/parse/delivery condition without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.