# Octoport SEO — M9 boundary-resolution Wave-1 collect slice-2 release — 2026-09-24 R1

Status: **RELEASED FOR ONE BOUNDED COLLECTN COUNT=13**
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream:
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_COLLECT_SLICE1_RECEIPT_2026-09-24_R1.md`

## 1. Current durable state

```text
JOB_ID = octoport-m9br-wave1-20260924-r1
TOTAL = 25
SUCCEEDED = 12
WAITING = 13
PENDING = 0
RESULT_SAVED = 0
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
POLLS_STARTED = 12
UNRESOLVED = 13
REVISION = 86
```

Slice 1:
- processed = 12;
- normalized = 12;
- last index = 11;
- last outcome = received;
- bounded_stop = true.

Therefore the remaining due rows are indices 12..24 and have not yet been polled by collect slice 1.

## 2. Poll timing

The original first-poll time gate already passed before collect slice 1.

No additional five-minute delay is required for indices 12..24 because they were not polled by slice 1 and retain their original due state.

A new five-minute delay would only apply to an item that was actually polled and returned `waiting`.

## 3. Exact authorized action

Only this command is authorized:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m9br-wave1-20260924-r1","count":13}
```

Expected ideal state if all remaining operations are terminal and normalize successfully:

```text
SUCCEEDED = 25
WAITING = 0
RESULT_SAVED = 0
PARSE_FAILED = 0
FAILED = 0
UNKNOWN = 0
POLLS_STARTED = 25
UNRESOLVED = 0
ALL_SUCCESSFUL = true
```

A bounded stop with fewer than 13 processed is allowed.

If any processed provider operation returns `waiting`, that item remains WAITING and its next poll must wait another five minutes.

Any provider/technical/persistence/parse failure stops downstream acceptance and requires reconciliation.

## 4. Downstream fence

No third collect is automatic.

After the returned result Main Chat must:
1. persist/read back the receipt;
2. inspect exact state counts;
3. if all 25 are SUCCEEDED, enumerate/read back item state and export complete evidence;
4. if some remain WAITING because they were polled and not done, respect their renewed five-minute due time before another collect;
5. if bounded stop leaves unpolled due rows, release only those rows in a separate slice.

No Search submit is authorized.
M10A remains blocked.
