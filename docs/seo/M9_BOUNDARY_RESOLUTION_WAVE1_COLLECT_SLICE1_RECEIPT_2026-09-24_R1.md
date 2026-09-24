# Octoport SEO — M9 boundary-resolution Wave-1 collect slice-1 receipt — 2026-09-24 R1

Status: **PASS_BOUNDED_STOP / 12 SUCCEEDED / 13 WAITING**
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream:
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_COLLECT_SLICE1_RELEASE_2026-09-24_R1.md`

## Returned Bridge evidence

```json
{"action":"collectN","job_id":"octoport-m9br-wave1-20260924-r1","ok":true,"request_executed":true,"provider_calls":12,"processed":12,"normalized":12,"bounded_stop":true,"last":{"outcome":"received","code":null,"index":11,"operation_id":"spr7i3qkihsio8549ktn"},"progress":{"job_id":"octoport-m9br-wave1-20260924-r1","control":"RUNNING","total":25,"counts":{"PENDING":0,"SUBMITTING":0,"WAITING":13,"COLLECTING":0,"RESULT_SAVED":0,"SUCCEEDED":12,"PARSE_FAILED":0,"FAILED":0,"UNKNOWN":0,"CANCELLED":0},"requests_started":25,"operations_accepted":25,"polls_started":12,"unresolved":13,"all_successful":false,"busy":false,"revision":86}}
```

## Main Chat reconciliation

```text
ACTION = collectN
OK = true
REQUEST_EXECUTED = true
PROVIDER_CALLS = 12
PROCESSED = 12
NORMALIZED = 12
BOUNDED_STOP = true

LAST_OUTCOME = received
LAST_INDEX = 11
LAST_OPERATION_ID = spr7i3qkihsio8549ktn

TOTAL = 25
PENDING = 0
WAITING = 13
COLLECTING = 0
RESULT_SAVED = 0
SUCCEEDED = 12
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 25
OPERATIONS_ACCEPTED = 25
POLLS_STARTED = 12
UNRESOLVED = 13
BUSY = false
REVISION = 86
```

Invariants:

```text
SUCCEEDED + WAITING = 25
PROVIDER_CALLS = PROCESSED = NORMALIZED = 12
POLLS_STARTED = 12
UNKNOWN = 0
FAILED = 0
PARSE_FAILED = 0
COLLECT_SLICE1_GATE = PASS_BOUNDED_STOP
```

The first 12 provider operations returned terminal results and normalized successfully.
The remaining 13 operations were not processed by this bounded slice and remain WAITING.

## Next gate

The remaining 13 rows do not require a new five-minute delay merely because slice 1 ended:
- they were provider-admitted before the already-passed initial collection time gate;
- this slice processed only indices 0..11;
- indices 12..24 remain unpolled by this slice.

A second bounded collection requires a separate durable release/readback.

No Search submit is authorized.
No blind retry.
M10A remains blocked.
