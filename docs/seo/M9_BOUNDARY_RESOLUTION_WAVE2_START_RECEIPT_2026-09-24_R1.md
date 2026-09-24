# Octoport SEO — M9 boundary-resolution Wave-2 local-start receipt — 2026-09-24 R1

Status: **PASS / LOCAL JOB CREATED / PAID SUBMIT STILL CLOSED**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream:
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_LOCAL_START_RELEASE_2026-09-24_R1.md`
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_QUERY_MANIFEST_2026-09-24_R1.tsv`

## Returned Bridge evidence

```json
{"action":"start","job_id":"octoport-m9br-wave2-20260924-r1","ok":true,"request_executed":false,"provider_calls":0,"progress":{"job_id":"octoport-m9br-wave2-20260924-r1","control":"RUNNING","total":18,"counts":{"PENDING":18,"SUBMITTING":0,"WAITING":0,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":0,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":0,"operations_accepted":0,"polls_started":0,"unresolved":18,"all_successful":false,"busy":false,"revision":0}}
```

## Main Chat reconciliation

```text
ACTION = start
OK = true
REQUEST_EXECUTED = false
PROVIDER_CALLS = 0

JOB_ID = octoport-m9br-wave2-20260924-r1
CONTROL = RUNNING
TOTAL = 18

PENDING = 18
SUBMITTING = 0
WAITING = 0
COLLECTING = 0
RESULT_SAVED = 0
SUCCEEDED = 0
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 0
OPERATIONS_ACCEPTED = 0
POLLS_STARTED = 0
UNRESOLVED = 18
ALL_SUCCESSFUL = false
BUSY = false
REVISION = 0

LOCAL_START_GATE = PASS
```

The local job identity and cardinality match the exact Wave-2 release.

No provider request has occurred.

## Paid boundary

`submitN` remains closed until:
1. this receipt is durably read back;
2. official Yandex deferred pricing/limits are freshly checked again;
3. a separate paid-submit release is persisted and read back.

No blind retry.
M10A remains blocked.
