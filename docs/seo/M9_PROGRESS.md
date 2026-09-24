# Octoport SEO — M9 progress

Date: 2026-09-24
Status: **WAVE-1 PRE-COLLECTION WAIT / EARLIEST SAFE 12:41:34 +05**
Branch: `seo/wordstat-batch-01-2026-09-16`

## Current accepted chain

```text
M0..M8 = ACCEPTED
M9 R2 = PASS_WITH_HOLD_BOUNDARIES / ACCEPTED_BOUNDED_AUTHORITY
M9 BOUNDARY-RESOLUTION PRE-ACQ = PASS / MAIN CHAT ACCEPTED
M10A = BLOCKED

CURRENT PHYSICAL STEP =
M9 BOUNDARY-RESOLUTION WAVE-1 PRE-COLLECTION TIME GATE
```

## Accepted M9 unresolved state

```text
CLUSTER_ELIGIBLE = 104
CURRENT_SEARCH_ANCHORED = 22
NO_CURRENT_EXACT_SERP = 82

MERGE_SUPPORTED = 3
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1518
MATERIAL_HOLD = 1424

RETAINED_CLUSTER = 0
RETAINED_SINGLETON = 0
HOLD_CLUSTER_BOUNDARY = 104
```

## Boundary-resolution preparation

```text
LEVEL1_READ = PASS
LEVEL2_READ = PASS
PROVIDER_QUERY_RELEASE_RULE_READ = PASS
M6_INFORMATION_GAIN_RULE_READ = PASS
FAILURE_HISTORY_READ = PASS
FRESH_METHOD_RESEARCH = PASS
FRESH_PROVIDER_DOCS_CHECK = PASS

STEP_PREPARATION = PASS / REMOTE READBACK
PRE_HANDOFF = PASS / REMOTE READBACK
WORK_PROMPT = PASS / REMOTE READBACK
```

Authorities:

- `docs/seo/M9_BOUNDARY_RESOLUTION_STEP_PREPARATION_2026-09-24_R1.md`
  blob `fb0d6ecf64bef695e70991764a009109e887b1ff`

- `docs/seo/M9_BOUNDARY_RESOLUTION_PREACQ_INPUT_MANIFEST_2026-09-24_R1.json`
  blob `8a2c5eb5bb5985bbd743e83803026f02ee9f73ec`

- `docs/seo/M9_BOUNDARY_RESOLUTION_PRE_HANDOFF_2026-09-24_R1.md`
  blob `c02bcaf0dddb0ef8229504fdfa4a51c0dbe962e3`

- `docs/seo/M9_BOUNDARY_RESOLUTION_WORK_PROMPT_2026-09-24_R1.md`
  blob `23df71016c92d5450371ba35a8ed9473d2decc20`

## Accepted Work return

Staging:
`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/`

Acceptance:
`docs/seo/M9_BOUNDARY_RESOLUTION_PREACQ_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`

Independent Main Chat result:

```text
RETURN_FILES = 9/9
RETURN_MANIFEST_HASH_MATCH = 8/8
RETURN_MANIFEST_BYTE_MATCH = 8/8

IDENTITY_DISPOSITION_ROWS = 104/104
BOUNDARY_IMPACT_ROWS = 82/82

QUERY_FORM:
  DEMAND_OR_TESTED_EXACT_QUERY = 33
  NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND = 11
  PAGE_TITLE_OR_SOURCE_PHRASE = 33
  AMBIGUOUS_QUERY_FORM = 5

DISPOSITION:
  EXISTING_CURRENT_SEARCH_ANCHOR = 22
  WAVE1_SEARCH_CANDIDATE = 25
  DEFER_SEARCH_CANDIDATE = 19
  PERSISTENT_HOLD_NO_EXACT_QUERY_PROBE = 33
  QUERY_FORM_AMBIGUOUS_HOLD = 5

WAVE1_QUERY_COUNT = 25
WAVE1_REPHRASED_QUERY = 0
WAVE1_EXISTING_SEARCH_DUPLICATE = 0
WAVE1_PROVIDER_LIMIT_VIOLATION = 0
WAVE1_DETERMINISTIC_ORDER = PASS

PAIRWISE_RECOMPUTED = 5356/5356
HOLD_BOUNDARY_RECOMPUTED = 1518/1518
MATERIAL_HOLD_RECOMPUTED = 1424/1424
ONE_CURRENT_SERP_HOLD_RECOMPUTED = 396/396
BOUNDARY_IMPACT_DEGREE_MISMATCH = 0

PROVIDER_CALLS_BY_WORK = 0
BRIDGE_COMMANDS_BY_WORK = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0

MAIN_CHAT_RETURN_QA = PASS
OPEN_CRITICAL_DEFECTS = 0
```

## Wave-1 provider release

Release authority:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_PROVIDER_RELEASE_2026-09-24_R1.md`

```text
PROVIDER_PREFLIGHT = PASS
BRIDGE_PACKAGE_AUTHORITY = YMB 0.1.9 / commit b218afb0187bd26af1d7ada3590b02edc2d4a2de
OFFICIAL_TARIFF_RECHECK = PASS
DAY_DEFERRED_UNIT_COST_RUB = 0.0305
WAVE1_QUERY_COUNT = 25
WAVE1_MAX_REQUESTS = 25
WAVE1_MAX_COST_RUB = 0.7625
RELEASE_REMOTE_READBACK = PASS

FIRST_AUTHORIZED_ACTION = start
START_EXPECTED_PROVIDER_CALLS = 0
PAID_SUBMITN = CLOSED
```

The released local job id is:
`octoport-m9br-wave1-20260924-r1`

Only the exact released `SEARCH_ASYNC_BATCH_API_V1 action=start` may run now.

Required return gate:

```text
request_executed = false
provider_calls = 0
total = 25
PENDING = 25
requests_started = 0
operations_accepted = 0
polls_started = 0
unresolved = 25
revision = 0
```

Any mismatch stops before paid provider execution.

After the start result is persisted/read back, Main Chat must freshly recheck the tariff again immediately before any billable `submitN`. No blind retry.

After future terminal, persisted and read-back Search evidence:
- rebuild the Search-anchor map;
- rerun the complete 5,356-pair M9 universe;
- rerun clusters and adversarial QA;
- Main Chat accepts / holds / reworks.

No partial pair patch.

## Wave-1 local start receipt

Receipt:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_START_RECEIPT_2026-09-24_R1.md`

```text
START_RUNTIME_GATE = PASS
JOB_ID = octoport-m9br-wave1-20260924-r1
CONTROL = RUNNING
TOTAL = 25
PENDING = 25
REQUEST_EXECUTED = false
PROVIDER_CALLS = 0
REQUESTS_STARTED = 0
OPERATIONS_ACCEPTED = 0
POLLS_STARTED = 0
UNRESOLVED = 25
REVISION = 0
```

The actual runtime accepted the released deferred job without a provider call.

Paid `submitN` remains closed until:
1. official tariff is freshly rechecked immediately before submission;
2. submit authorization is persisted and read back.

No blind resubmit.

## Wave-1 paid submit release

Release:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_SUBMIT_RELEASE_2026-09-24_R1.md`

```text
FRESH_TARIFF_RECHECK = PASS
TARIFF_CHECK_TIME = 2026-09-24 10:31 UTC+3
ACTIVE_RATE = DAY_DEFERRED
UNIT_COST_RUB = 0.0305
MAX_PROVIDER_SUBMITS = 25
MAX_COST_RUB = 0.7625
SUBMIT_RELEASE_READBACK = REQUIRED

AUTHORIZED_ACTION =
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m9br-wave1-20260924-r1","count":25}

COLLECTN = CLOSED
SECOND_SUBMITN = CLOSED
```

One bounded `submitN` is authorized. A bounded early stop is valid; it does not authorize an automatic second slice. Any UNKNOWN/failure stops the lifecycle for reconciliation.

## Wave-1 submit slice-1 receipt

Receipt:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_SUBMIT_SLICE1_RECEIPT_2026-09-24_R1.md`

```text
SLICE1_GATE = PASS_BOUNDED_STOP
REQUEST_EXECUTED = true
PROVIDER_CALLS = 19
PROCESSED = 19
BOUNDED_STOP = true

TOTAL = 25
WAITING = 19
PENDING = 6
UNKNOWN = 0
FAILED = 0
REQUESTS_STARTED = 19
OPERATIONS_ACCEPTED = 19
POLLS_STARTED = 0
REVISION = 38
```

The first 19 accepted rows are provider-admitted and MUST NOT be submitted again.

Exactly 6 rows remain PENDING.
A second paid submit slice is not automatic; it requires a fresh tariff check plus separate durable release/readback.

Collection remains closed.

## Wave-1 submit slice-2 release

Release:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_SUBMIT_SLICE2_RELEASE_2026-09-24_R1.md`

```text
FRESH_TARIFF_RECHECK = PASS
YANDEX_TARIFF_TIME = 2026-09-24 10:34 UTC+3
ACTIVE_RATE = DAY_DEFERRED
UNIT_COST_RUB = 0.0305
REMAINING_PENDING = 6
SLICE2_MAX_COST_RUB = 0.183
WAVE1_TOTAL_MAX_COST_RUB = 0.7625

AUTHORIZED_ACTION =
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m9br-wave1-20260924-r1","count":6}

COLLECTN = CLOSED
THIRD_SUBMITN = CLOSED
```

Exactly one bounded slice-2 submit is authorized. A safe early stop may return fewer than six processed; any further submit requires a new receipt/readback/release.

## Wave-1 submit slice-2 receipt

Receipt:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_SUBMIT_SLICE2_RECEIPT_2026-09-24_R1.md`

```text
SLICE2_GATE = PASS
SLICE2_PROVIDER_CALLS = 6
SLICE2_PROCESSED = 6
SLICE2_BOUNDED_STOP = false

TOTAL = 25
PENDING = 0
WAITING = 25
UNKNOWN = 0
FAILED = 0
REQUESTS_STARTED = 25
OPERATIONS_ACCEPTED = 25
POLLS_STARTED = 0
REVISION = 50

SUBMISSION_PHASE = PASS_COMPLETE
```

Cross-slice:
`19 + 6 = 25` confirmed provider submissions and 25 accepted operations.

No additional submit is authorized or needed.

Immediate next action is local/read-only `itemsPage` for all 25 rows so Main Chat can preserve and verify every accepted operation ID before any provider-backed collection.

`collectN` remains closed.

## Wave-1 operation-ID readback

Receipt:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_OPERATION_ID_READBACK_2026-09-24_R1.md`

```text
ITEMS_PAGE_REQUEST_EXECUTED = false
ITEMS_PAGE_PROVIDER_CALLS = 0
ROW_COUNT = 25/25
INDEX_SET = 0..24
OPERATION_ID_UNIQUE = 25/25
STATE_WAITING = 25/25
POLL_COUNT_ZERO = 25/25
ERROR_CODE_NULL = 25/25
PARSE_ERROR_NULL = 25/25
OPERATION_ID_READBACK_GATE = PASS
```

All 25 accepted provider operation IDs are now preserved in durable project state.

No submit work remains.

Collection is still closed until the conservative minimum five-minute deferred-processing interval is proven satisfied.

## Wave-1 pre-collection time gate

Authority:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_PRECOLLECT_TIME_GATE_2026-09-24_R1.md`

```text
MIN_FIRST_POLL_MS = 5 minutes
CONSERVATIVE_LAST_ADMISSION_RECEIPT_TIME = 2026-09-24T12:36:34+05:00
EARLIEST_SAFE_COLLECTION = 2026-09-24T12:41:34+05:00
LAST_OBSERVED_TIME = 2026-09-24T12:39:52+05:00
PRE_COLLECTION_TIME_GATE = WAIT
COLLECTN_AUTHORIZED = false
```

No provider-backed collect may run before the earliest safe time.

## Owner relay

Current Wave-1 plan contains 25 exact queries.
The 25-query ceiling is reached because 44 exact candidates passed the releaseability gate; 19 remain deferred by deterministic rank, not discarded.

M10A remains blocked.
