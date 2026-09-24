# Octoport SEO — M9 boundary-resolution Wave-1 operation-ID readback — 2026-09-24 R1

Status: **PASS / 25 OPERATION IDS PRESERVED / PRE-COLLECTION TIME GATE**
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream:
- `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_SUBMIT_SLICE2_RECEIPT_2026-09-24_R1.md`

## Returned local read-only evidence

Bridge action:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"itemsPage","jobId":"octoport-m9br-wave1-20260924-r1","after":-1,"limit":25}
```

Observed envelope:

```text
ACTION = itemsPage
JOB_ID = octoport-m9br-wave1-20260924-r1
OK = true
REQUEST_EXECUTED = false
PROVIDER_CALLS = 0
ROW_COUNT = 25
NEXT_AFTER = 24
```

## Operation map

| index | state | operation_id | poll_count |
|---:|---|---|---:|
| 0 | WAITING | `spr56h408ekfir7e3bb0` | 0 |
| 1 | WAITING | `sprpa695gamb80udfrvb` | 0 |
| 2 | WAITING | `sprbm8j9hcqukk1lcmpu` | 0 |
| 3 | WAITING | `sprbas2chptogrg5hn24` | 0 |
| 4 | WAITING | `sprs4gvennh01m67h2bu` | 0 |
| 5 | WAITING | `sprqg6han93asshmabp1` | 0 |
| 6 | WAITING | `spr0p2hjho1ckrl69lob` | 0 |
| 7 | WAITING | `spr6hrq04lp1fu3p9ljg` | 0 |
| 8 | WAITING | `spr0vhu52rsqnspn47a3` | 0 |
| 9 | WAITING | `sprln0k55kh4bp67v6u5` | 0 |
| 10 | WAITING | `sprrjfagblv28nf3p8q5` | 0 |
| 11 | WAITING | `spr7i3qkihsio8549ktn` | 0 |
| 12 | WAITING | `spruvqce5h6rfj5o0ofb` | 0 |
| 13 | WAITING | `spr268u4qls9gvrpe0l1` | 0 |
| 14 | WAITING | `sprfij5imktdl13944s4` | 0 |
| 15 | WAITING | `sprejkthq39bupcbnvm3` | 0 |
| 16 | WAITING | `sprhsnhrafsol7cgo6s3` | 0 |
| 17 | WAITING | `spr99tu849d5l7je2b16` | 0 |
| 18 | WAITING | `sprjiramr1fsq2jrcn04` | 0 |
| 19 | WAITING | `sprfgfe34i9fh7jgq36l` | 0 |
| 20 | WAITING | `sprl2ltekn1e3n3g96ql` | 0 |
| 21 | WAITING | `sprqs8rvt89fc93qlfbl` | 0 |
| 22 | WAITING | `spr1u6ate7cq0q78it1t` | 0 |
| 23 | WAITING | `sprfjaedbjcp9b8um2hm` | 0 |
| 24 | WAITING | `sprababvmok5spakfra2` | 0 |

Every row also returned:
- `error_code = null`;
- `parse_error = null`.

## Main Chat independent gate

```text
ROW_COUNT = 25/25
INDEX_SET = 0..24
INDEX_UNIQUE = 25/25
OPERATION_ID_NON_NULL = 25/25
OPERATION_ID_UNIQUE = 25/25
STATE_WAITING = 25/25
POLL_COUNT_ZERO = 25/25
ERROR_CODE_NULL = 25/25
PARSE_ERROR_NULL = 25/25
REQUEST_EXECUTED = false
PROVIDER_CALLS = 0

OPERATION_ID_READBACK_GATE = PASS
```

Cross-check:
- index 18 = `sprjiramr1fsq2jrcn04`, matching slice-1 last accepted operation;
- index 24 = `sprababvmok5spakfra2`, matching slice-2 last accepted operation.

No duplicate or missing provider operation identity exists.

## Collection boundary

Provider-backed collection remains closed until the minimum deferred processing interval is safely satisfied.

The accepted current YMB 0.1.9 provider contract uses:
`MIN_FIRST_POLL_MS = 5 minutes`.

A future collection release must use a conservative lower bound proving at least five minutes have elapsed since provider admission before issuing `collectN`.

No submit action remains.
No blind retry.
M10A remains blocked.
