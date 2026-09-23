# Octoport SEO — M6 regional Search collect release R2

Date: 2026-09-23
Status: **SECOND BOUNDED COLLECTN RELEASED AFTER CONSERVATIVE 5-MINUTE BARRIER**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

Parent evidence:
- `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_SUBMIT.json`
- `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_COLLECT_01_NO_DUE.json`
- `docs/seo/M6_SEARCH_REGION_CONTROL_COLLECT_RELEASE_2026-09-23_R1.md`
- `docs/seo/M6_SEARCH_REGION_CONTROL_COMPARISON_PLAN_2026-09-23_R1.md`

## 1. First collect outcome

The first collect was a local due guard only:

```text
last.code = NO_DUE_OPERATIONS
request_executed = false
provider_calls = 0
processed = 1
PENDING = 0
WAITING = 2
SUCCEEDED = 0
FAILED = 0
UNKNOWN = 0
requests_started = 2
operations_accepted = 2
polls_started = 0
unresolved = 2
revision = 4
```

No provider poll occurred and no lifecycle state advanced.

## 2. Durable timing proof

Conservative timing uses repository commit timestamps, which occur no earlier than receipt/persistence of the corresponding chat result.

```text
SUBMIT_RESULT_COMMIT = 41e17b8c52baa75936c8367c37c4ec8ef22f9b49
SUBMIT_RESULT_COMMIT_TIME_UTC = 2026-09-23T12:05:28Z

COMPARISON_PLAN_COMMIT = 71523a2661f3b419b4b21070796e0e85ea052693
COMPARISON_PLAN_COMMIT_TIME_UTC = 2026-09-23T12:10:28Z

CONSERVATIVE_ELAPSED = 300 seconds
REQUIRED_MINIMUM = 300 seconds
BARRIER = PASS
```

The provider submit itself necessarily occurred before the durable submit-result commit, so this timing is conservative.

## 3. Exactly one released action

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m6-search-region-controls-r1-20260923","count":2}
```

Rules:
- collect only the two already accepted operations;
- no submit/re-submit;
- persist the full returned envelope before any further provider action;
- if only one operation is due, persist partial state and release any later collect separately;
- UNKNOWN blocks replay;
- terminal target is SUCCEEDED=2, WAITING=0, unresolved=0.

## 4. Operation identity

Known from submit envelope:
```text
OPERATIONS_ACCEPTED = 2
LAST_OPERATION_ID = spregqnga31l4fm29b3b
FIRST_OPERATION_ID = STORED_IN_DURABLE_JOB_BUT_NOT_SURFACED_BY_SUBMIT_ENVELOPE
```

Do not guess the first operation ID.
The final export must expose both item operation identities with query mapping.

## 5. No export yet

Export remains blocked until collection is terminal and its lifecycle result has been persisted/read back.
