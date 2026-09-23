# Octoport SEO — M6 regional Search collect release R1

Date: 2026-09-23
Status: **EXACTLY ONE BOUNDED COLLECTN RELEASED / NO RESUBMIT**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
START_HEAD: `41e17b8c52baa75936c8367c37c4ec8ef22f9b49`

Parent:
- `docs/seo/M6_SEARCH_REGION_CONTROL_SUBMIT_RELEASE_2026-09-23_R1.md`
- `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_SUBMIT.json`
- `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md`

## Submit readback

Raw submit envelope remote-readback:

```text
job_id = octoport-m6-search-region-controls-r1-20260923
request_executed = true
provider_calls = 2
processed = 2
operations_accepted = 2
PENDING = 0
WAITING = 2
FAILED = 0
UNKNOWN = 0
requests_started = 2
polls_started = 0
unresolved = 2
revision = 4
last.index = 1
last.operation_id = spregqnga31l4fm29b3b
```

Raw path:
`docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_BATCH_SUBMIT.json`

## Operation-identity boundary

The returned `submitN` envelope confirms two accepted provider operations but exposes only the last operation identity.

Therefore:

```text
OPERATIONS_ACCEPTED = 2
LAST_OPERATION_ID = spregqnga31l4fm29b3b
FIRST_OPERATION_ID = NOT_SURFACED_IN_SUBMIT_ENVELOPE
FIRST_OPERATION_ID_GUESSED = false
RESUBMIT_ALLOWED = false
```

This is not an unknown provider outcome: the durable batch state says both submissions were accepted, WAITING=2, UNKNOWN=0.

The same durable job must be collected. Final structured export must recover and persist both operation IDs with query mapping.

## Exactly one released action

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m6-search-region-controls-r1-20260923","count":2}
```

Safety semantics:
- collect only existing WAITING operations;
- do not create replacement Search operations;
- if no operation is due yet, `NO_DUE_OPERATIONS` with `request_executed=false/provider_calls=0` is valid and does not change the submit truth;
- if one or two are due, only those due operations may be polled;
- UNKNOWN blocks replay;
- no new `submitN`.

Expected terminal target when both are ready:

```text
PENDING = 0
WAITING = 0
SUCCEEDED = 2
FAILED = 0
UNKNOWN = 0
requests_started = 2
operations_accepted = 2
polls_started = 2
unresolved = 0
all_successful = true
```

Partial collection is allowed and must be persisted/read back before another collect.

## Persistence

Every actual collect envelope:
`FULL SEARCH_ASYNC_BATCH_RESULT_V1 -> GitHub -> remote readback -> state verification`.

No export is released until terminal collection state is durable.

## Cursor

```text
SUBMIT = PERSISTED_READBACK_PASS
COLLECTN_COUNT_2 = RELEASED
RESUBMIT = FORBIDDEN
EXPORT = NOT_RELEASED
```
