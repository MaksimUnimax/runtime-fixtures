# Octoport SEO — M6 Wordstat provider reconciliation R1

Date: 2026-09-23
Status: **WORDSTAT LANE RECONCILED / 3 VALID EMPTY LITERAL RESPONSES / 1 TERMINAL PROVIDER FAILURE / NO SYNTHETIC REWRITE AUTHORIZED**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
START_HEAD: `210ddff38061a9c3e045eb39bf7eb88a6768960d`

Parent authority:
- `docs/seo/M6_PRE_ACQUISITION_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`
- `docs/seo/LEVEL1/README.md`
- `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md`
- `docs/seo/EXECUTION_RULES.md`

## 1. Durable raw evidence readback

All four released Wordstat candidates have complete raw `WORDSTAT_BATCH_RESULT_V1` envelopes persisted and remote-read back.

| candidate | raw path | blob SHA | request_id | provider HTTP | terminal item state |
|---|---|---|---|---:|---|
| M6PC001 | `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6PC001.json` | `52d31ed494da096bf333df588f716e28aac5a358` | `wordstat-batch-33f3158f-19a7-42a8-bee3-9bf0213c7787` | 200 | SUCCEEDED |
| M6PC002 | `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6PC002.json` | `1fd801c61f4183ebfb089955352cfdc585e543f0` | `wordstat-batch-9a106edb-55ce-480f-915b-703c80f23e6a` | 200 | SUCCEEDED |
| M6PC003 | `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6PC003.json` | `c510b2a39a15cd5e1aed2e6ab249dc58b85cc879` | `wordstat-batch-51be0b6f-873e-4bc1-b639-af3a2c9183b5` | 200 | SUCCEEDED |
| M6PC004 | `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6PC004.json` | `cdbbe72cf3d6d614f0f52375e99aefa42bf195b4` | `wordstat-batch-b8614d92-e2b2-4aaf-b6fa-e38afce2ff69` | 400 | FAILED_TERMINAL |

Readback confirmed that each file contains both:
- `item.result_payload`;
- full `provider_result`, including the factual `result` body.

No raw provider evidence is represented only by a chat summary.

## 2. Exact provider outcomes

### M6PC001

Phrase:
`ABC-анализ товаров на OZON`

Parameters:
- GetTop
- region 225
- DEVICE_ALL
- numPhrases 200

Outcome:
```text
HTTP = 200
STATUS = OK
ITEM = SUCCEEDED
RESULT = {}
AUTOMATIC_RETRY = false
```

Terminal interpretation:
`VALID_EMPTY_LITERAL_TOP_RESPONSE`.

Claim boundary:
this is a successful empty response for the exact literal source wording and specified observation parameters. It is **not** proof of zero overall demand for ABC analysis, inventory analysis, Ozon seller analytics or the broader seller task.

### M6PC002

Phrase:
`Как сделать ABC-анализ на Wildberries`

Parameters:
- GetTop
- region 225
- DEVICE_ALL
- numPhrases 200

Outcome:
```text
HTTP = 200
STATUS = OK
ITEM = SUCCEEDED
RESULT = {}
AUTOMATIC_RETRY = false
```

Terminal interpretation:
`VALID_EMPTY_LITERAL_TOP_RESPONSE`.

No broader-demand claim is allowed.

### M6PC003

Phrase:
`Как построить воронку продаж на маркетплейсе`

Parameters:
- GetTop
- region 225
- DEVICE_ALL
- numPhrases 100

Outcome:
```text
HTTP = 200
STATUS = OK
ITEM = SUCCEEDED
RESULT = {}
AUTOMATIC_RETRY = false
```

Terminal interpretation:
`VALID_EMPTY_LITERAL_TOP_RESPONSE`.

No broader-demand claim is allowed.

### M6PC004

Phrase:
`Процент возвратов на Wildberries: как считать, анализировать и снижать`

Parameters:
- GetTop
- region 225
- DEVICE_ALL
- numPhrases 100

Outcome:
```text
HTTP = 400
STATUS = ERROR
REASON = 3
ITEM = FAILED_TERMINAL
ERROR = Invalid query
REQUEST_EXECUTED = true
AUTOMATIC_RETRY = false
OUTCOME_UNKNOWN = 0
```

Terminal interpretation:
`PROVIDER_INVALID_QUERY_NO_DEMAND_OBSERVATION`.

This is a technical/provider rejection of the exact literal query. It is not negative demand evidence.

The accepted pre-acquisition authority explicitly prohibited inventing a shortened/synthetic replacement phrase. Therefore:
```text
EXACT_RETRY = NOT_AUTHORIZED
SYNTHETIC_SHORTENING = NOT_AUTHORIZED
DEMAND_OBSERVATION = NOT_OBTAINED
CURRENT_STATE = HOLD_PROVIDER_INVALID_QUERY
```

Any later reformulation requires a separate Main Chat information-gain/release decision and must preserve M6PC004 as immutable failure history.

## 3. Wordstat accounting

```text
WORDSTAT_PROVIDER_CANDIDATES = 4
EXECUTED_EXACT_CANDIDATES = 4/4
SUCCEEDED = 3
FAILED_TERMINAL = 1
OUTCOME_UNKNOWN = 0
AUTOMATIC_RETRIES = 0
RAW_PERSISTED_READBACK = 4/4

VALID_EMPTY_LITERAL_TOP_RESPONSE = 3
PROVIDER_INVALID_QUERY_NO_DEMAND_OBSERVATION = 1
NEW_WORDSTAT_ROWS_ADMITTED_TO_SEMANTIC_UNIVERSE = 0
```

The three empty responses produce no new Wordstat phrase rows.
M6PC004 produces no demand row because the provider rejected the query.

## 4. Gap decisions after Wordstat

M6G001 / ABC analysis:
- literal Ozon and WB probes are terminally observed;
- both are valid empty literal responses;
- no broad seller-task demand conclusion;
- retain only as bounded diagnostic evidence;
- no recursive Wordstat expansion authorized.

M6G002 / sales funnel:
- literal probe is terminally observed;
- valid empty literal response;
- no new demand row;
- no recursive expansion authorized.

M6G003 / Wildberries return rate:
- exact probe failed terminally as Invalid query;
- no demand observation exists;
- current state is explicit HOLD rather than fake zero;
- separate later reformulation can occur only under a new accepted release.

## 5. Search region control planning correction

The accepted Work-return has an internal planning inconsistency for both executable regional controls M6PC006 and M6PC008:

- dedicated field `requested_depth = 100`;
- information-gain and valid-zero text explicitly define the comparison as a **regional Top20**;
- historical M3 baseline being sensitivity-tested is also Top20.

Under LEVEL 1/2 rules, conflicting planning fields may not be silently executed.

Main Chat correction overlay:

```text
M6PC006_SEARCH_REGION_DEPTH = 20
M6PC008_SEARCH_REGION_DEPTH = 20
WORK_RETURN_REQUESTED_DEPTH_100 = SUPERSEDED_FOR_EXECUTION_ONLY
SOURCE_ROWS / QUERY TEXT / REGION / INFO-GAIN CONTRACT = UNCHANGED
```

Reason:
the regional experiment asks whether Moscow changes the accepted M3 Top20 intent composition enough to alter interpretation. Depth 20 directly measures that question. This correction is semantic-contract alignment, not quota/cost trimming.

The original Work-return remains unchanged as historical input; this Main Chat artifact is the execution authority for the corrected depth.

## 6. Remaining M6 provider state

Executable with current YMB 0.1.9 after a separate durable release:
- M6PC006 — R04 `аналитика маркетплейсов для селлеров`, region 213, XML Top20.
- M6PC008 — R06 `помощник селлера маркетплейсов`, region 213, XML Top20.

Capability HOLD remains unchanged:
- Search HTML controls = 6;
- Search userAgent controls = 3.

No fake HTML/userAgent command is authorized.

## 7. Current cursor

```text
M6_WORDSTAT_LANE = RECONCILED
M6_WORDSTAT_RAW_PERSISTENCE = PASS 4/4
M6_WORDSTAT_NEW_ROWS = 0
M6PC004 = HOLD_PROVIDER_INVALID_QUERY

NEXT = PREPARE_AND_RELEASE_LOCAL_START_FOR_M6PC006_M6PC008_REGION_213
SEARCH_PROVIDER_SUBMIT = NOT YET EXECUTED
M1_PRE_M7_DEPENDENCY = OPEN
M7 = BLOCKED
```
