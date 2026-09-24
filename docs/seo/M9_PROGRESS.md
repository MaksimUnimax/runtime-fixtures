# Octoport SEO — M9 progress

Date: 2026-09-24
Status: **BOUNDARY-RESOLUTION WAVE-2 START PASS / PAID SUBMIT PREFLIGHT OPEN**
Branch: `seo/wordstat-batch-01-2026-09-16`

## Current accepted chain

```text
M0..M8 = ACCEPTED
M9 R2 = PASS_WITH_HOLD_BOUNDARIES / ACCEPTED_BOUNDED_AUTHORITY
M9 BOUNDARY-RESOLUTION PRE-ACQ = PASS / MAIN CHAT ACCEPTED
M10A = BLOCKED

CURRENT PHYSICAL STEP =
M9 BOUNDARY-RESOLUTION WAVE-2 PAID SUBMIT PREFLIGHT
```

## Accepted M9 unresolved state

```text
CLUSTER_ELIGIBLE = 104
CURRENT_SEARCH_ANCHORED = 47
NO_CURRENT_EXACT_SERP = 57

MERGE_SUPPORTED = 21
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1500
MATERIAL_HOLD = 1406

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

## Wave-1 collect slice-1 release

Release:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_COLLECT_SLICE1_RELEASE_2026-09-24_R1.md`

```text
PRE_COLLECTION_TIME_GATE = PASS
OPERATION_ID_READBACK = 25/25 PASS
FRESH_PROVIDER_CONTRACT_CHECK = PASS

AUTHORIZED_ACTION =
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m9br-wave1-20260924-r1","count":25}

SECOND_COLLECTN = CLOSED
SUBMITN = CLOSED
```

One bounded collection slice is authorized. Any further collection decision depends on this returned durable state.

## Wave-1 collect slice-1 receipt

Receipt:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_COLLECT_SLICE1_RECEIPT_2026-09-24_R1.md`

```text
COLLECT_SLICE1_GATE = PASS_BOUNDED_STOP
PROVIDER_CALLS = 12
PROCESSED = 12
NORMALIZED = 12
BOUNDED_STOP = true

TOTAL = 25
SUCCEEDED = 12
WAITING = 13
RESULT_SAVED = 0
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
POLLS_STARTED = 12
UNRESOLVED = 13
REVISION = 86
```

Indices 0..11 returned terminal provider results and normalized successfully.
Indices 12..24 remain WAITING and were not processed by slice 1.

A second collect is allowed only after a separate durable release/readback. No new five-minute delay is needed for these unpolled rows because their original due time already passed.

## Wave-1 collect slice-2 release

Release:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_COLLECT_SLICE2_RELEASE_2026-09-24_R1.md`

```text
CURRENT = 12 SUCCEEDED / 13 WAITING
SLICE1_LAST_INDEX = 11
REMAINING_UNPOLLED = indices 12..24

AUTHORIZED_ACTION =
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m9br-wave1-20260924-r1","count":13}

THIRD_COLLECTN = CLOSED
SUBMITN = CLOSED
```

The remaining 13 rows are still on their original due schedule; no new five-minute wait applies before this slice.

## Wave-1 collect slice-2 receipt

Receipt:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_COLLECT_SLICE2_RECEIPT_2026-09-24_R1.md`

```text
COLLECT_SLICE2_GATE = PASS_BOUNDED_STOP
PROVIDER_CALLS = 12
PROCESSED = 12
NORMALIZED = 12
BOUNDED_STOP = true

TOTAL = 25
SUCCEEDED = 24
WAITING = 1
RESULT_SAVED = 0
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
POLLS_STARTED = 24
UNRESOLVED = 1
REVISION = 122
```

The sole remaining WAITING row is index 24 / operation `sprababvmok5spakfra2`.
It has not yet been polled, so its original due time applies and already passed.

A final `collectN count=1` requires a separate release/readback.

## Wave-1 final collect release

Release:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_FINAL_COLLECT_RELEASE_2026-09-24_R1.md`

```text
CURRENT = 24 SUCCEEDED / 1 WAITING
SOLE_WAITING_INDEX = 24
SOLE_WAITING_OPERATION_ID = sprababvmok5spakfra2
SOLE_WAITING_POLL_COUNT = 0

AUTHORIZED_ACTION =
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m9br-wave1-20260924-r1","count":1}

ADDITIONAL_COLLECTN = CLOSED
SUBMITN = CLOSED
```

If index 24 returns waiting, a new five-minute gate applies before another poll.
If it succeeds and normalizes, collection is complete and the next step is local readback/export.

## Wave-1 final collect receipt

Receipt:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_FINAL_COLLECT_RECEIPT_2026-09-24_R1.md`

```text
FINAL_COLLECT_GATE = PASS_COMPLETE

TOTAL = 25
SUCCEEDED = 25
WAITING = 0
PENDING = 0
RESULT_SAVED = 0
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
CANCELLED = 0

REQUESTS_STARTED = 25
OPERATIONS_ACCEPTED = 25
POLLS_STARTED = 25
UNRESOLVED = 0
ALL_SUCCESSFUL = true
REVISION = 125

SUBMIT_PROVIDER_CALLS_TOTAL = 25
COLLECT_PROVIDER_CALLS_TOTAL = 25
NORMALIZED_RESULTS_TOTAL = 25
PROVIDER_LIFECYCLE_GATE = PASS_COMPLETE
```

No further provider submit or collect is authorized or required for Wave-1.

Immediate next actions are local/read-only:
1. terminal `itemsPage` readback;
2. complete durable `exportPage`;
3. inspect the exported 25-query evidence before rebuilding M9.

## Wave-1 terminal items readback release

Release:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_TERMINAL_ITEMS_RELEASE_2026-09-24_R1.md`

```text
PROVIDER_LIFECYCLE = PASS_COMPLETE
REVISION = 125

AUTHORIZED_LOCAL_ACTION =
SEARCH_ASYNC_BATCH_API_V1 {"action":"itemsPage","jobId":"octoport-m9br-wave1-20260924-r1","after":-1,"limit":25}

PROVIDER_CALLS_EXPECTED = 0
EXPORTPAGE = CLOSED UNTIL TERMINAL ITEMS PASS
```

## Wave-1 terminal items readback

Receipt:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_TERMINAL_ITEMS_READBACK_2026-09-24_R1.md`

```text
ROW_COUNT = 25/25
STATE_SUCCEEDED = 25/25
POLL_COUNT_ONE = 25/25
ERROR_CODE_NULL = 25/25
PARSE_ERROR_NULL = 25/25
OPERATION_ID_MATCH_PRIOR_READBACK = 25/25
TERMINAL_ITEMS_GATE = PASS

FROZEN_EXPORT_REVISION = 125
AUTHORIZED_LOCAL_ACTION =
SEARCH_ASYNC_BATCH_API_V1 {"action":"exportPage","jobId":"octoport-m9br-wave1-20260924-r1","after":-1,"limit":25,"revision":125}

PROVIDER_CALLS_EXPECTED = 0
```

If the first export file cannot fit all 25 items under the 16 MiB page budget, continue only from the returned exact `next_after` under the same frozen revision.

## Wave-1 complete evidence acceptance / full rerun handoff

Full accepted export:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_EXPORT_ACCEPTANCE_2026-09-24_R1.md`

Top20 projection acceptance:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_OVERLAP_PROJECTION_ACCEPTANCE_2026-09-24_R1.md`

47-anchor map:
`docs/seo/M9_BOUNDARY_RESOLUTION_SEARCH_ANCHOR_MAP_2026-09-24_R1.tsv`

Rerun input manifest:
`docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_INPUT_MANIFEST_2026-09-24_R1.json`

Rerun pre-handoff:
`docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_PRE_HANDOFF_2026-09-24_R1.md`

Canonical Work prompt:
`docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_WORK_PROMPT_2026-09-24_R1.md`

```text
WAVE1_FULL_EXPORT = PASS
EXPORT_ITEMS = 25/25
NORMALIZED_ROWS = 2500/2500
RESULTS_PER_QUERY = 100/100
URL_COMPARISON_ELIGIBLE = 25/25

TOP20_PROJECTION_REMOTE_READBACK = PASS
TOP20_PROJECTION_ROWS = 500/500
TOP20_INDEX_SET = 0..24
TOP20_RANKS_PER_INDEX = 1..20

CURRENT_SEARCH_ANCHORS = 47/47
NO_CURRENT_EXACT_SERP = 57/57

EXPECTED_RERUN:
BOTH_CURRENT_SERP = 1081
ONE_CURRENT_SERP = 2679
NO_CURRENT_SERP = 1596
PAIRWISE = 5356

CHANGED_COMPARABILITY = 2275
UNCHANGED_COMPARABILITY = 3081

RERUN_INPUT_MANIFEST_BLOB =
028f632cc01e4cef27d9dbcbbe19db3b83fe94de

RERUN_PRE_HANDOFF_BLOB =
5d92c37ea4e15646397d87e9aec9017a0aa2b765

RERUN_WORK_PROMPT_BLOB =
4090cd8359233575dc4ac8d176377f89eb5621b2

WORK_PROVIDER_CALLS_ALLOWED = 0
M10A = BLOCKED
```

Work must recompute the complete 5,356-pair Search-dependent authority and clusters; partial pair patch is forbidden.

Owner staging after Work return:
`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/`

## M9 boundary-resolution full rerun — Main Chat acceptance

Acceptance:
`docs/seo/M9_BOUNDARY_RESOLUTION_FULL_RERUN_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`

Staging:
`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/`

```text
RETURN_FILES = 9/9
RETURN_MANIFEST_HASH_MATCH = 8/8
FROZEN_INPUT_IDENTITIES = 29/29

ELIGIBILITY_ROWS = 7913/7913
CLUSTER_ELIGIBLE = 104/104

SEARCH_ANCHOR_MAP = 47/47
OLD_SEARCH_ANCHORS = 22/22
NEW_WAVE1_SEARCH_ANCHORS = 25/25
NO_CURRENT_EXACT_SERP = 57/57

PAIRWISE_ROWS = 5356/5356
FROZEN_NON_SEARCH_PAIR_FIELD_DRIFT = 0

BOTH_CURRENT_SERP = 1081/1081
ONE_CURRENT_SERP = 2679/2679
NO_CURRENT_SERP = 1596/1596
BILATERAL_OVERLAP_RECOMPUTATION_MISMATCH = 0

MERGE_SUPPORTED = 21
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1500
MATERIAL_HOLD = 1406

PAIR_DECISIONS_CHANGED_VS_R2 = 18
HOLD_TO_MERGE = 18
PAIR_REASON_CODES_CHANGED_VS_R2 = 290
UNCHANGED_COMPARABILITY_STATE_OR_REASON_CHANGES = 0

MATERIAL_HOLD_LEDGER_EXACT_SET = PASS

CLUSTER_MASTER_ROWS = 104
MEMBERSHIP_ROWS = 104/104
RETAINED_CLUSTER = 0
RETAINED_SINGLETON = 0
HOLD_CLUSTER_BOUNDARY = 104
CLUSTER_MEMBERSHIPS_CHANGED_VS_R2 = 0

MERGE_COMPONENTS = 9
NON_CLIQUE_MERGE_COMPONENTS = 0
ALL_MERGE_COMPONENTS_EXTERNALLY_BLOCKED = true

MAIN_CHAT_QA = PASS
OPEN_CRITICAL_DEFECTS = 0
VERDICT = PASS_WITH_HOLD_BOUNDARIES / ACCEPTED_BOUNDED_AUTHORITY

M10A = BLOCKED
```

The next physical step is a new M9 boundary-resolution information-gain pass over unresolved identities, beginning from the 19 previously deferred exact-query candidates and reprioritizing them against the current 1,406 material-HOLD universe.

No provider execution is authorized yet.

## Wave-2 information-gain selection / local-start release

Pre-acquisition:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_PREACQ_2026-09-24_R1.md`

Exact query manifest:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_QUERY_MANIFEST_2026-09-24_R1.tsv`

Local-start release:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_LOCAL_START_RELEASE_2026-09-24_R1.md`

```text
DEFERRED_CANDIDATES_RECHECKED = 19/19
WAVE2_SEARCH_CANDIDATES = 18
ZERO_GAIN_EXCLUDED = 1

UNIQUE_MATERIAL_HOLDS_TOUCHED = 346
TO_CURRENT_47_ANCHORS = 106
INTERNAL_WAVE2_MATERIAL_HOLDS = 41
TO_OTHER_NONANCHORS = 199

EXPECTED_POST_WAVE2_ANCHORS = 65
EXPECTED_POST_WAVE2_NO_SERP = 39
EXPECTED_CHANGED_COMPARABILITY = 1701

JOB_ID = octoport-m9br-wave2-20260924-r1
QUERY_COUNT = 18
MAX_REQUESTS = 18
MAX_COST_RUB = 0.549

LOCAL_START = RELEASED
PAID_SUBMITN = CLOSED
```

The excluded identity is `ии для продаж на маркетплейсах`: current material-HOLD information gain = 0 under frozen task/intent/product/scope authority.

## Wave-2 local-start receipt

Receipt:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_START_RECEIPT_2026-09-24_R1.md`

```text
LOCAL_START_GATE = PASS
JOB_ID = octoport-m9br-wave2-20260924-r1
TOTAL = 18
PENDING = 18
WAITING = 0
SUCCEEDED = 0
FAILED = 0
UNKNOWN = 0

REQUEST_EXECUTED = false
PROVIDER_CALLS = 0
REQUESTS_STARTED = 0
OPERATIONS_ACCEPTED = 0
POLLS_STARTED = 0
UNRESOLVED = 18
REVISION = 0

PAID_SUBMITN = CLOSED UNTIL FRESH TARIFF CHECK + SEPARATE RELEASE
```

## Owner relay

Current Wave-1 plan contains 25 exact queries.
The 25-query ceiling is reached because 44 exact candidates passed the releaseability gate; 19 remain deferred by deterministic rank, not discarded.

M10A remains blocked.
