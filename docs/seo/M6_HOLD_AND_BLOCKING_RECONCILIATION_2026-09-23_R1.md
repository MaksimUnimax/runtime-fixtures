# Octoport SEO — M6 HOLD / blocking reconciliation R1

Date: 2026-09-23
Status: **M6 INTERNAL GAPS TERMINAL / EXPLICIT NONBLOCKING HOLDS DEFINED / M1 REMAINS BLOCKING**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
START_HEAD: `3bf4e54c497389362b6c2b62c67c7c01737e3029`

Binding authorities:
- `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md`
- `docs/seo/LEVEL2/M7_M8_SEARCH_FREEZE_AND_SEMANTIC_MASTER_RULES.md`
- `docs/seo/STAGE_GATES_M0_M7.md`
- `docs/seo/M6_PRE_ACQUISITION_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`
- `docs/seo/M6_WORDSTAT_PROVIDER_RECONCILIATION_2026-09-23_R1.md`
- `docs/seo/M6_SEARCH_REGION_CONTROL_MAIN_CHAT_RECONCILIATION_2026-09-23_R1.md`
- `docs/seo/M6_OWNER_PRODUCT_FACT_MAIN_CHAT_RECONCILIATION_2026-09-23_R1.md`

## 1. M7 hold rule

Current M7 Level2 explicitly requires:

```text
M6_HIGH_VALUE_GAPS = CLOSED_OR_EXPLICIT_NONBLOCKING_HOLD
```

and requires the freeze manifest to preserve:
- explicit HOLDs;
- known limitations;
- prohibited inputs.

M8 separately requires material ambiguity to survive as HOLD.

Therefore M6 does not need to invent evidence merely to turn every uncertain row into KEEP/EXCLUDE. It must instead classify whether the uncertainty is:
- a blocking missing acquisition fact;
- or an explicit nonblocking HOLD that cannot enter stronger semantic/product claims.

## 2. HOLD_AMBIGUOUS — 1676 rows

Accepted Work-return accounting:

```text
HOLD_AMBIGUOUS = 1676
```

Gap authority:
`M6G903 / OTHER_EXPLICIT_HOLD`.

Its accepted stop rule already states:
```text
Stop with row-level HOLD and exact provenance.
Reopen only for exact source clarification or accepted new authority.
No provider query while identity is unresolved.
```

Main Chat closure:

```text
M6G903_STATE = TERMINAL_NONBLOCKING_HOLD_FOR_COLLECTION_FREEZE
ROWS = 1676
NEW_PROVIDER_CALLS = 0
ADMITTED_AS_WORKING_SEARCH_CANDIDATES = 0
SILENT_EXCLUSION = 0
```

Reason:
these rows are not missing a known provider observation. Their source wording/provenance is insufficient for an exact task/query identity without semantic rewriting.

M7 action:
carry them explicitly into the open-HOLD/known-limitations layer.

M8 action:
retain row lineage and make final HOLD/REVIEW judgments under the frozen semantic-master contract; never auto-KEEP them.

Claim boundary:
`AMBIGUITY != ZERO DEMAND != OUT_OF_SCOPE != SUPPORTED_TASK`.

## 3. Owner/product capability holds — 29 rows

From:
`docs/seo/work/M6_OWNER_PRODUCT_FACT_RECONCILIATION_2026-09-23_R1.tsv`.

```text
CAPABILITY/DATA/WORKFLOW/METHOD HOLDS = 29
OUT_OF_PRODUCT_SCOPE = 1
OWNER_INPUT_REQUIRED_NOW = 0
```

Main Chat closure for the 29 held rows:

```text
STATE = TERMINAL_NONBLOCKING_PRODUCT_CAPABILITY_HOLD_FOR_COLLECTION_FREEZE
ADMITTED_AS_SUPPORTED_PRODUCT_TASK = 0
NEW_PROVIDER_DEMAND_CALL = 0
```

Reason:
the current product authority is sufficient to say "not proven"; it is not sufficient to say "supported".
A search-demand provider call cannot fix missing endpoint/workflow/data-completeness evidence.

M7 action:
preserve these rows as product-capability HOLDs, outside the supported active task set.

Reopen only after accepted API/implementation/product authority changes.

## 4. M6PC004 Wordstat Invalid query

Candidate:
`M6PC004`

Exact phrase:
`Процент возвратов на Wildberries: как считать, анализировать и снижать`

Provider outcome:
```text
HTTP = 400
ERROR = Invalid query
ITEM = FAILED_TERMINAL
OUTCOME_UNKNOWN = 0
AUTOMATIC_RETRY = false
```

Pre-acquisition acceptance prohibited synthetic shortening.

Main Chat closure:

```text
STATE = TERMINAL_NONBLOCKING_PROVIDER_INVALID_QUERY_HOLD
DEMAND_OBSERVATION = NOT_OBTAINED
SYNTHETIC_REWRITE = NOT_AUTHORIZED
RETRY = NOT_AUTHORIZED
ADMITTED_AS_DEMAND_SUPPORTED = false
```

Why nonblocking:
the row does not enter the demand-supported Search candidate set. Its failure is preserved as evidence and can reopen only on new exact query authority or a separately accepted reformulation contract.

Claim boundary:
`PROVIDER_INVALID_QUERY != ZERO_DEMAND`.

## 5. Search HTML capability holds — 6

Provider candidates:
`M6PC005, M6PC007, M6PC009, M6PC011, M6PC013, M6PC015`.

Current Bridge limitation:
`FORMAT_HTML` not exposed by YMB 0.1.9 Search command surface.

The current Search-side evidence remains explicitly **organic XML**, not full-SERP evidence.

Main Chat closure:

```text
SEARCH_HTML_HOLDS = 6
STATE = EXPLICIT_NONBLOCKING_M7_LIMITATION
FULL_SERP_FEATURE_CLAIMS_ALLOWED = false
ORGANIC_SEARCH_EVIDENCE_VALID = true
FAKE_HTML_COMMAND = forbidden
```

Why nonblocking:
M7 freezes a Search-side evidence snapshot and may carry known limitations. These six holds do not invalidate the accepted organic Top20/Top100 evidence; they limit only claims about non-organic/full-SERP feature presentation.

Downstream:
M8/M9/M10A must not infer answer-card, ad, quick-answer or other full-SERP feature behavior from XML organic evidence.

Reopen on verified Bridge HTML support or another separately accepted authorized method.

## 6. Search userAgent/device holds — 3

Provider candidates:
`M6PC010, M6PC012, M6PC014`.

Current Bridge limitation:
no explicit `userAgent` field.

Main Chat closure:

```text
SEARCH_USERAGENT_HOLDS = 3
STATE = EXPLICIT_NONBLOCKING_M7_LIMITATION
ALL_DEVICE_EQUIVALENCE_CLAIM = forbidden
CURRENT_UNSPECIFIED_DEVICE_ORGANIC_EVIDENCE_VALID = true
FAKE_DEVICE_COMMAND = forbidden
```

Why nonblocking:
the current Search corpus remains a valid unspecified-device organic observation. The absent explicit mobile comparison prevents an all-device claim but does not erase the existing Search evidence.

Downstream:
device-sensitive conclusions remain HOLD; no mobile/desktop causality is inferred.

Reopen only on verified explicit userAgent/device capability or alternate authorized observation.

## 7. Region / overlap / temporal control debt

Current state after M6 execution:

```text
M3_OVERLAP_REUSE = CLOSED_BY_ACCEPTED_M4A / 105 pairs
M3_TEMPORAL_REUSE = CLOSED_BY_ACCEPTED_M4Q_R2 / 15 queries
M3_REGION_PROVIDER_CANDIDATES = 2/2 EXECUTED
M6PC006 = NO_MATERIAL_CHANGE
M6PC008 = ENRICH
REGION_REOPEN_TARGETED_GAP = 0
```

Therefore the executable M3 control debt is closed.

Remaining HTML/device gaps are capability-limited known limitations, not unknown provider outcomes.

## 8. M6 gap blocking matrix

```text
WORDSTAT_EXACT_PROBES:
  terminal = 4/4
  nonblocking_hold = 1 (M6PC004)
  unknown = 0

SEARCH_REGION:
  terminal_success = 2/2
  unknown = 0

SEARCH_HTML:
  explicit_nonblocking_capability_hold = 6

SEARCH_USERAGENT:
  explicit_nonblocking_capability_hold = 3

SOURCE_IDENTITY:
  terminal_nonblocking_hold = 1676

PRODUCT_CAPABILITY:
  terminal_nonblocking_hold = 29
  out_of_product_scope = 1

M1_PRE_M7_DEPENDENCY:
  blocking = true
```

## 9. Current M6 internal verdict

```text
ALL_M6_NAMED_PROVIDER_ACTIONS_TERMINAL = true
OUTCOME_UNKNOWN_PROVIDER_ACTIONS = 0
DUPLICATE_PROVIDER_ACQUISITION = 0
UNAUTHORIZED_RETRY = 0
UNAUTHORIZED_EXPANSION = 0

M6_SOURCE_AMBIGUITY_ACCOUNTED = true
M6_PRODUCT_CAPABILITY_ROWS_ACCOUNTED = true
M3_CONTROL_DEBT_EXECUTABLE_LANES = CLOSED
M3_HTML_DEVICE_LIMITATIONS = EXPLICIT_NONBLOCKING_HOLD

M6_INTERNAL_HIGH_VALUE_GAPS =
  CLOSED_OR_EXPLICIT_NONBLOCKING_HOLD

M6_FINAL_CLOSURE = BLOCKED_ONLY_BY_SEPARATE_M1_PRE_M7_DEPENDENCY
M7 = BLOCKED
```

This is not yet final M6 PASS because the roadmap explicitly requires M1 completion before M6 final closure / M7.

## 10. Next physical stage

No new Wordstat/Search acquisition is released.

Next:
```text
M1 LIVE / MEASUREMENT BASELINE COMPLETION
-> remote durable evidence
-> M1 acceptance / score >= 9.0 or explicit blocking HOLD
-> M6 final hard-gate closure
-> R4 current-authority rescore M0/M1/M2/M3
-> M7 Search-side Collection Freeze
```
