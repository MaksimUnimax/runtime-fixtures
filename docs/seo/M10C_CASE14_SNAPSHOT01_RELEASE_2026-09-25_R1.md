# Octoport SEO — M10C Case14 first GenSearch snapshot release — 2026-09-25 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**

Upstream Case13 terminal closure:
`docs/seo/M10C_CASE13_TERMINAL_CLOSURE_2026-09-25_R1.md`
blob `37ab3acbd51a641d25a4ce2d924d2ef2432503f1`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Released case

```text
CASE_ID = M10BCASE_adb2e167115fbbbd
SOURCE_M5_HYPOTHESIS = M5H00049
EXACT_AI_PROMPT = отчеты маркетплейсов
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00035
PRIMARY_CLUSTER = M9CL_5aa7113efc724f06
MARKETPLACE_SCOPE = OZON_AND_WILDBERRIES
TASK_SCOPE = seller-owned report reading and delivery versus statutory reconciliation or accounting
```

Frozen uncertainty:
`Whether AI identifies official seller report/help sources and bounded explanation instead of vendor reports, statutory accounting or unsupported completeness claims.`

Expected information gain:
`Capture official versus third-party report citations and answer framing; test one named report-reading HOLD and associated unresolved material boundaries.`

## Exact authorized command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"отчеты маркетплейсов","confirmBillable":true}
```

## Budget / quality rule

```text
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
CASE14_ACCEPTED_M10B_MAX_SNAPSHOTS = 2
SNAPSHOT02 = NOT_AUTHORIZED_YET
QUALITY_PRIORITY = true
```

Specifically watch whether GenSearch frames the query as:
- official seller reports/help from Ozon or Wildberries;
- third-party/vendor report interpretation;
- seller-owned operational analytics;
- statutory/accounting/tax reconciliation;
- payout/settlement reconciliation;
- unsupported claims that one report is complete for all financial decisions.

If snapshot-1 leaves decision-relevant doubt on source roles, marketplace/report scope, accounting adjacency, or completeness, snapshot-2 should be used after persistence/readback.

## Hard stop

```text
CASE13 = CLOSED
CASE14_SNAPSHOT02 = CLOSED_PENDING_ASSESSMENT
CASE15 = CLOSED
BULK_EXECUTION = FORBIDDEN
BLIND_RETRY = FORBIDDEN
M10D = BLOCKED
```

If `request_executed=true`, do not resend this exact snapshot without new Main Chat authority.

If `request_executed=false`, return the exact local rejection.