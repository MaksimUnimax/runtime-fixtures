# Octoport SEO — M6 pre-acquisition reconciliation gate R1

Date: 2026-09-23
Status: **PREPARED / FULL-VOLUME WORK REQUIRED / PROVIDER EXECUTION FORBIDDEN**
WORK_ID: `OCTOPORT_SEO_M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1`

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation base HEAD: `93ef4ed13cf1ba58be4199c034ba19868961daf4`

## 1. Entry authority

Current accepted upstream state:

```text
M2R = ACCEPTED
M3_PRIMARY_ORGANIC_ACQUISITION = ACCEPTED
M3_CONTROL_DEBT = OPEN
M4 = ACCEPTED / CURRENT WITH EXPLICIT BOUNDED HOLDS
M5 = ACCEPTED
M6 = PREPARATION
M7 = BLOCKED
```

M5 authority:

`docs/seo/M5_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`

Current M1 state remains:

```text
M1 = OPEN / SOURCE BASELINE PARTIAL PASS
M1 MUST CLOSE BEFORE M6 FINAL CLOSURE / M7
```

M1 is a separate live/measurement dependency and is not to be silently converted into Wordstat/Search provider work.

## 2. Binding M6 method

Authority:

`docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md`

M6 closes only named gaps with explicit information gain.

Required chain:

```text
NAME EXACT OPEN QUESTION
-> RECONCILE DURABLE EVIDENCE
-> CLASSIFY GAP TYPE
-> PROVE INCREMENTAL INFORMATION GAIN
-> DEFINE PROVIDER / QUERY / REGION / DEVICE / DEPTH
-> DEFINE SUCCESS / VALID ZERO / FAILURE / UNKNOWN
-> DEFINE STOP / REOPEN
-> DEFINE PERSISTENCE
-> DEFINE DOWNSTREAM DECISION
-> ONLY THEN EXECUTE
```

M5 hypotheses are NOT M6 provider gaps and do not authorize Alice calls.

```text
M6_ALICE_CALLS = 0
```

## 3. Fresh provider/method research — 2026-09-23

Official current Yandex Wordstat/Search documentation was refreshed immediately before this gate.

### Wordstat

Current official Wordstat GetTop:

- returns current last-30-days popular queries containing a phrase and associations;
- phrase length <= 400 chars;
- `numPhrases` = 1..2000;
- region list supported;
- device list supports desktop / phone / tablet / all;
- response distinguishes `totalCount`, `results[]`, `associations[]`.

Official authorities:

- https://aistudio.yandex.ru/ru/docs/search-api/api-ref/Wordstat/getTop
- https://aistudio.yandex.ru/ru/docs/search-api/operations/wordstat-gettop
- https://yandex.ru/support2/wordstat/en/content/api-structure

### Ordinary Search

Current official Search API supports:

- region control;
- `FORMAT_XML`;
- `FORMAT_HTML`;
- optional `userAgent` that can optimize results for a device/browser, including mobile;
- HTML result depth differs from XML.

Official authorities:

- https://aistudio.yandex.ru/ru/docs/search-api/concepts/web-search
- https://aistudio.yandex.ru/ru/docs/search-api/api-ref/WebSearch/search

## 4. Current Yandex Marketing Bridge capability — separate proof

Current production authority:

```text
Yandex Marketing Bridge = 0.1.9
production branch = hotfix/ymb-file-delivery-p0-2026-09-14
production commit = b218afb0187bd26af1d7ada3590b02edc2d4a2de
```

Current protocol identities:

- `wordstat_protocol.js` blob `07765acbca6bbb0d3535e170d0198ce8cfa7f2ae`
- `wordstat_batch_protocol.js` blob `2846a0bdfeba6a9241b5aced255ed44b06cffcad`
- `search_protocol.js` blob `49ca9a6f3a2786a3107f03d0724dfca7578cd096`
- `search_async_protocol.js` blob `91df9051f4cf52d51ee73af9c66a196411a966d7`

### Bridge Wordstat

Current Bridge supports:

- GetTop;
- regions;
- `DEVICE_ALL / DEVICE_DESKTOP / DEVICE_PHONE / DEVICE_TABLET`;
- `numPhrases` up to 2000;
- batch input up to 500 phrases.

This is adequate for a later bounded demand-validation batch if Main Chat accepts the exact provider manifest.

### Bridge Search

Current Bridge Search protocol:

```text
RESPONSE_FORMAT = FORMAT_XML
ALLOWED_FIELDS do not include userAgent
region is supported
```

Therefore:

```text
CURRENT_BRIDGE_FULL_SERP_HTML = NOT_SUPPORTED
CURRENT_BRIDGE_SEARCH_DEVICE_USERAGENT_CONTROL = NOT_SUPPORTED
CURRENT_BRIDGE_REGIONAL_SEARCH_CONTROL = SUPPORTED
CURRENT_BRIDGE_TEMPORAL_REPEAT = SUPPORTED AS A NEW TIMESTAMPED SEARCH SNAPSHOT
```

Official provider capability must not be confused with current Bridge capability.

M6 Work must not invent an executable HTML/device command.

If such a control remains materially required after full reconciliation, mark:

`HOLD_BRIDGE_CAPABILITY_REQUIRED`

or equivalent.

## 5. Reuse before new acquisition

M6 must explicitly reuse accepted evidence where it already closes a control.

### M3 cross-query overlap

Accepted authority:

`docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_PAIRWISE_TOP10_SIMILARITY.tsv`

Blob:

`66a7e080adecb0231bf9cc60834248e5c03a2c67`

This is the complete 15-query Top10 pairwise authority.

Expected query pairs:

`105/105`.

Do not recompute via provider for ritual duplication.

### M3 temporal repeat

M4Q R2 current top-100 evidence includes all 15 M3 exact control queries at a later 2026-09-23 snapshot.

M6 must evaluate whether this already supplies the needed temporal organic repeat for each selected M3 control.

Do not issue a new temporal-repeat query where the existing M4Q R2 snapshot already answers the named control question.

### Existing Wordstat

Current M2 demand authority includes:

`docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv`

Blob:

`9343048ed82f129b3f7433c46899e6f255a420a8`

```text
LINEAGE_ROWS = 1123
CONSERVATIVE_NORMALIZED_PROVIDER_STRINGS = 787
CONSERVATIVE_NORMALIZED_STRINGS_INCLUDING_SEEDS = 808
```

Existing exact-safe M2R evidence must be reused before proposing any new Wordstat call.

## 6. Full-volume demand/gap inputs

### A. Accepted M4C M6 candidates

`docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_M6_DEMAND_GAP_CANDIDATES.tsv`

Blob:

`345b1aa7c1aac4f283b3d36361aa33cad369e267`

Accepted rows:

`5973`.

These are validation candidates, not proven demand.

### B. Accepted current targeted overlay candidate delta

`docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv`

Blob:

`dc9aa037a5da3101c72d4c6460109e4f69d5eea2`

Rows:

`133`.

Source statuses:

```text
ALREADY_PRESENT = 14
NEW_CANDIDATE = 64
POSSIBLE_VARIANT = 19
OUT_OF_SCOPE = 24
AMBIGUOUS = 12
```

Primary M6 candidate-source accounting:

```text
M4C_BASE_M6_SOURCE_ROWS = 5973
TARGETED_OVERLAY_SOURCE_ROWS = 133
TOTAL_PRIMARY_M6_CANDIDATE_SOURCE_ROWS = 6106
```

Every one of these 6106 rows must be accounted.

## 7. Mandatory supporting routing inputs

Work must also read and reconcile:

### Current M4Q R2 query universe

`M4Q_R2_QUERY_UNIVERSE_LEDGER_R2.tsv`

Blob:

`23b1a272ddfae3bf03d2b4a57525a773ace7fdac`

Rows:

`15542`.

Current accepted M4Q A2 includes `DEFER_TO_M6_DEMAND_VALIDATION` rows.

These are routing evidence and must be joined, not double-counted as a second independent candidate universe.

### Current M5 disposition ledger

`docs/seo/work_return/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1/M5_INPUT_DISPOSITION_LEDGER.tsv`

Blob:

`9f0ec02927c16046ec0d836133a5e660b8d29dbd`

Rows:

`1000`.

Relevant routing includes:

```text
SEARCH_OR_M6_ONLY_NOT_AI_DIAGNOSTIC = 188
HOLD_AMBIGUOUS = 28
```

M5 disposition does not itself authorize a provider call.

### Current M4Q/M4C/M6 reconciliations

Read:

- `M4Q_R2_M4C_M6_RECONCILIATION.tsv`
- `M4Q_R2_TARGETED_M4C_M6_RECONCILIATION.tsv`

### M3 control authority

Read:

- `docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md`
- `docs/seo/serp/M3_METHOD_RETROSPECTIVE_AND_CONTROL_DEBT_2026-09-18.md`
- accepted M4A occurrence/query/overlap artifacts;
- accepted M4Q R2 query visibility summaries for the 15 controls.

## 8. Candidate reconciliation dispositions

Every primary candidate-source row receives one final pre-acquisition disposition such as:

```text
REUSE_EXISTING_WORDSTAT_EVIDENCE
EXACT_DUPLICATE_OF_REUSED_OR_PROVIDER_CANDIDATE
PROVIDER_REQUIRED_DEMAND_VALIDATION
NO_INCREMENTAL_INFORMATION_GAIN
OUT_OF_PRODUCT_SCOPE
HOLD_AMBIGUOUS
OWNER_OR_PRODUCT_FACT_REQUIRED
```

Provider-required is allowed only when:
- exact/source wording is legitimate;
- current product/task fit is material;
- M2R does not already answer it;
- current Search/M4 evidence gives a named downstream reason;
- valid zero would be interpretable;
- a new Wordstat observation can change a named M6/M7 decision.

Frequency/recurrence alone is not enough.

## 9. Provider-plan boundaries

Work creates a candidate provider manifest only.

It does NOT execute it.

Every provider-ready row must define:

- exact open question;
- provider/method;
- exact phrase/query;
- region;
- devices;
- requested depth;
- why current evidence is insufficient;
- expected information gain;
- positive interpretation;
- valid-zero interpretation;
- failure interpretation;
- unknown interpretation;
- stop rule;
- persistence target;
- downstream decision;
- Bridge capability state;
- execution status.

No price/cost may be used to reject a useful query.

Actual current price is refreshed by Main Chat immediately before paid execution.

## 10. M3 control-plan requirements

All 15 M3 exact queries must be accounted.

For each query determine separately:

- cross-query overlap control: REUSE M4A or HOLD;
- temporal organic repeat: REUSE M4Q R2 or additional repeat justified;
- regional sensitivity: no call / provider candidate / HOLD;
- full-SERP HTML: no material need / `HOLD_BRIDGE_CAPABILITY_REQUIRED` / alternate method required;
- device/browser sensitivity: no material need / `HOLD_BRIDGE_CAPABILITY_REQUIRED` / alternate method required.

Do not select controls by quota.

Selection must be based on current decision sensitivity after M4/M5.

Control outcome vocabulary remains:

`NO_MATERIAL_CHANGE | ENRICH | REOPEN_TARGETED_GAP | HOLD`.

## 11. M1 dependency

M1 remains open and is not executed by this Work task.

Work must carry this explicit downstream blocker:

```text
M1_LIVE_MEASUREMENT_BASELINE = REQUIRED_BEFORE_M6_FINAL_CLOSURE_AND_M7
```

Do not treat M1 as a provider query.

## 12. Work trigger

```text
WORK_TRIGGER = MET
```

Reason:

```text
PRIMARY_M6_CANDIDATE_SOURCE_ROWS = 6106
M2R_LINEAGE_ROWS = 1123
M4Q_QUERY_UNIVERSE_ROWS = 15542
M5_ROUTING_ROWS = 1000
M3_CONTROLS = 15
M4A_PAIRWISE_QUERY_PAIRS = 105
```

This is a large cross-source reconciliation where ordinary-chat sampling is forbidden.

## 13. Required Work outputs — exactly 7

1. `M6_SOURCE_MANIFEST.md`
2. `M6_DEMAND_CANDIDATE_RECONCILIATION.tsv`
3. `M6_GAP_REGISTER.tsv`
4. `M6_PROVIDER_CANDIDATE_MANIFEST.tsv`
5. `M6_M3_CONTROL_PLAN.tsv`
6. `M6_QA.md`
7. `M6_RETURN_MANIFEST.json`

## 14. Required candidate reconciliation

`M6_DEMAND_CANDIDATE_RECONCILIATION.tsv`

must contain exactly 6106 data rows.

Minimum fields:

- m6_source_row_id
- source_layer
- source_candidate_id
- registry_id
- raw_candidate_text
- normalized_exact_safe_key
- source_status
- source_evidence_refs
- product_scope_class
- m2r_exact_evidence_status
- m2r_source_refs
- m4q_route_status
- m5_route_status
- current_search_visibility_context
- information_gap_class
- m6_disposition
- provider_candidate_id
- disposition_reason
- claim_boundary

No silent row loss.

## 15. Gap register

`M6_GAP_REGISTER.tsv`

is the deduplicated decision-level gap authority.

Allowed gap classes include:

```text
DEMAND_VALIDATION
SEARCH_INTENT_OR_VISIBILITY
M3_FULL_SERP_CONTROL
M3_DEVICE_CONTROL
M3_REGION_CONTROL
M3_TEMPORAL_CONTROL
M3_OVERLAP_CONTROL
OWNER_PRODUCT_FACT
M1_PRE_M7_DEPENDENCY
OTHER_EXPLICIT_HOLD
```

Every gap must have:
- current evidence;
- what is still unknown;
- whether new acquisition is required;
- provider/method if applicable;
- downstream decision;
- terminal/reopen rule.

## 16. Provider candidate manifest

No provider calls.

Rows may include:

`WORDSTAT_GET_TOP`
`SEARCH_XML_REGION_CONTROL`
`SEARCH_XML_TEMPORAL_REPEAT`
`SEARCH_HTML_CONTROL_CAPABILITY_HOLD`
`SEARCH_USERAGENT_CONTROL_CAPABILITY_HOLD`

For current Bridge capability holds:

```text
EXECUTION_ALLOWED = false
BLOCKER = CURRENT_YMB_0_1_9_CAPABILITY
```

## 17. QA

At minimum:

```text
M4C_BASE_M6_SOURCE_ROWS_ACCOUNTED = 5973/5973
TARGETED_OVERLAY_SOURCE_ROWS_ACCOUNTED = 133/133
TOTAL_PRIMARY_M6_SOURCE_ROWS = 6106/6106
SILENT_SOURCE_LOSS = 0

M2R_LINEAGE_REVIEWED = 1123/1123
M4Q_QUERY_UNIVERSE_REVIEWED = 15542/15542
M5_ROUTING_ROWS_REVIEWED = 1000/1000

REUSE_EXISTING_WORDSTAT_EVIDENCE =
PROVIDER_REQUIRED_DEMAND_VALIDATION =
NO_INCREMENTAL_INFORMATION_GAIN =
OUT_OF_PRODUCT_SCOPE =
HOLD_AMBIGUOUS =
OWNER_OR_PRODUCT_FACT_REQUIRED =

PROVIDER_CANDIDATE_ROWS =
WORDSTAT_PROVIDER_CANDIDATES =
SEARCH_PROVIDER_CANDIDATES =
BRIDGE_CAPABILITY_HOLD_ROWS =

M3_QUERIES_ACCOUNTED = 15/15
M3_OVERLAP_REUSE = 15/15 or explicit exceptions
M3_TEMPORAL_REUSE_FROM_M4Q_R2 =
M3_REGION_PROVIDER_CANDIDATES =
M3_FULL_SERP_CAPABILITY_HOLDS =
M3_DEVICE_CAPABILITY_HOLDS =

DUPLICATE_PROVIDER_ACQUISITION = 0
M5_HYPOTHESIS_AS_PROVIDER_GAP = 0
SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_TOPIC_AS_DEMAND = 0

PROVIDER_CALLS = 0
YANDEX_SEARCH_CALLS = 0
WORDSTAT_CALLS = 0
ALICE_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES = 0
```

## 18. Stop conditions

`HOLD_AUTHORITY_DRIFT` if governing/current accepted input authority changed.

`PARTIAL_REWORK_REQUIRED` if 6106/6106 candidate-source accounting cannot be achieved.

Row-level `HOLD_AMBIGUOUS` is allowed and must not be guessed through.

Do not convert current Bridge capability gaps into fake provider commands.

## 19. Publication

Work must not write to GitHub.

Return one ZIP containing exactly the seven required outputs.

Owner uploads all seven unpacked files together to:

`docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/`

Main Chat performs independent return QA before any provider command.

## 20. Current cursor

```text
M4 = ACCEPTED
M5 = ACCEPTED
M6 = PRE_ACQUISITION_RECONCILIATION RELEASED
M1 = OPEN / REQUIRED BEFORE M6 FINAL CLOSURE AND M7
M7 = BLOCKED
PROVIDER_CALLS_ALLOWED_NOW = 0
```
