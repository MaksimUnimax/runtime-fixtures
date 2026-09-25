# Octoport SEO — M10C Case13 first GenSearch snapshot release — 2026-09-25 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case12 terminal closure:
`docs/seo/M10C_CASE12_TERMINAL_CLOSURE_2026-09-25_R1.md`
blob `13860e1de07cdefd339e03b3553bdb0deb64d294`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Released case

```text
CASE_ID = M10BCASE_ba667d2c39fb39ad
SOURCE_M5_HYPOTHESES = M5H00040 | M5H00041
EXACT_AI_PROMPT = дрр wildberries
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00024
PRIMARY_CLUSTER = M9CL_c6f9d55c55d0a25d
MARKETPLACE_SCOPE = WILDBERRIES
TASK_SCOPE = advertising measurement and explanation versus automatic bid mutation
```

Frozen uncertainty:
`Whether DRR advice is grounded in seller-owned campaign reports and explanation rather than real-time bidding or write-back promises.`

Expected information gain:
`Compare cited campaign-report help to autobidder tools and framing of analysis versus mutation; test the accepted DRR owner/page-role HOLD.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"дрр wildberries","confirmBillable":true}
```

## Budget / quality rule

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE13_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
QUALITY_PRIORITY = true
```

Specifically watch whether GenSearch frames DRR as:
- seller-owned campaign/report measurement and explanation;
- static educational guidance/calculation;
- autobidder/bid-management tooling;
- automatic campaign mutation / write-back;
- unsupported promises of real-time optimization.

If snapshot-1 leaves decision-relevant doubt on analysis-vs-mutation roles or source consistency, snapshot-2 should be used after persistence/readback.

## Hard stop

```text
CASE12 = CLOSED
CASE13_SNAPSHOT02 = CLOSED_PENDING_ASSESSMENT
CASE14 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend this exact snapshot without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.