# Octoport SEO — R4 pre-M7 current-authority rescore — 2026-09-23 R1

Status: **PASS / M7 PRECONDITION SWEEP COMPLETE**
Branch: `seo/wordstat-batch-01-2026-09-16`
START_HEAD: `55efb51a4504dbe312a34ac38f996129d30a035e`

Purpose:
re-score the **current accepted authorities**, not rewrite historical run scores.

Binding roadmap:
`docs/seo/SEO_MASTER_ROADMAP_2026-09-16.md`

Required:
```text
M0_CURRENT_STAGE_SCORE >= 9.0
M1_CURRENT_STAGE_SCORE >= 9.0
M2_CURRENT_EFFECTIVE_AUTHORITY_SCORE >= 9.0
M3_CURRENT_HARDENED_STAGE_SCORE >= 9.0
ALL_HARD_GATES = PASS
OPEN_CRITICAL_RETRO_DEBT = 0
```

## 1. M0 current authority

Current authority:
- `docs/seo/PRODUCT_TRUTH.md`
- `docs/seo/evidence/M0_SCOPE_SOURCE_RETRO_CONSOLIDATION_2026-09-18.md`

Existing accepted current score:
```text
M0_CURRENT_SCORE = 9.7/10
M0_HARD_GATES = PASS
```

Current owner prelaunch-site correction does not invalidate M0 product truth. It narrows the M1 site-state interpretation only.

R4:
```text
M0_CURRENT_STAGE_SCORE = 9.7/10
M0 = PASS
```

## 2. M1 current authority

Current authority:
- `docs/seo/technical/M1_OWNER_PRELAUNCH_SCOPE_CORRECTION_2026-09-23_R1.md`
- `docs/seo/technical/M1_LIVE_MEASUREMENT_BASELINE_2026-09-23_R1.md`

Current accepted state:
```text
PRODUCTION_SEO_SITE = NOT_YET_EXISTS
CURRENT_PUBLIC_SURFACE = PRELAUNCH PLACEHOLDER / FOUNDATION
YANDEX_WEBMASTER = NOT_APPLICABLE_PRELAUNCH
YANDEX_METRIKA = NOT_APPLICABLE_PRELAUNCH
GOOGLE_SEARCH_CONSOLE = NOT_APPLICABLE_PRELAUNCH
BLOCKING_UNKNOWN = 0
OPEN_CRITICAL_DEFECTS = 0
M1_CURRENT_STAGE_SCORE = 9.6/10
```

R4:
```text
M1_CURRENT_STAGE_SCORE = 9.6/10
M1 = PASS / PRELAUNCH_NO_PRODUCTION_SITE
```

## 3. M2 current effective authority

Historical provider evidence is preserved as history.

Current effective authority is:
```text
HISTORICAL B01/B02 PROVIDER EVIDENCE
+ M2_WORDSTAT_RETRO_GATE_AUDIT
+ ACCEPTED M2R FULL-VOLUME RECONCILIATION
+ MAIN CHAT QAF-01/QAF-02/QAF-03 CORRECTIONS
```

Authorities:
- `docs/seo/wordstat/M2_WORDSTAT_RETRO_GATE_AUDIT_2026-09-16.md`
- `docs/seo/work/M2R_RECONCILIATION_MAIN_CHAT_RETURN_QA_2026-09-17.md`
- `docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv`
- `docs/seo/work/M2R_FAMILY_COVERAGE_MATRIX_2026-09-17.csv`

Accepted controls:
```text
M2_RETRO_GATE_SCORE = 9.5/10
M2R_FULL_VOLUME_LEDGER = 1123/1123
M2R_SILENT_ROW_LOSS = 0
B02_ASSOCIATION_ACCOUNTING_CURRENT = 246 occurrences / 153 exact unique
OLD_B02_245_152 = SUPERSEDED
EMPTY_RESULT_BOUNDARIES = PRESERVED
HISTORICAL_B01_WRAPPER_LIMITATION = EXPLICIT / ACCEPTED
REPLAY_FOR_WRAPPER_ONLY = NOT_AUTHORIZED
```

R4 current-effective rescore:

| dimension | score /10 |
|---|---:|
| demand-source coverage | 9.5 |
| lineage/accounting | 10.0 |
| provider-truth boundaries | 10.0 |
| historical persistence integrity | 9.0 |
| corrective authority cleanliness | 10.0 |
| downstream readiness | 9.5 |

```text
M2_CURRENT_EFFECTIVE_AUTHORITY_SCORE = 9.7/10
M2_CURRENT_AUTHORITY_CLEAN = PASS
```

This does not change the historical B01/B02 run score.

## 4. M3 current hardened authority

Historical primary M3 organic corpus remains accepted.

Current hardened authority is:
```text
PRIMARY M3 ORGANIC TOP20
+ M4A R3 STEP06 ANALYTICAL HARDENING
+ M4A 105/105 TOP10 PAIRWISE OVERLAP
+ M4Q R2 LATER RU225 SNAPSHOTS FOR 15/15
+ M6 REGION CONTROLS 2/2
+ M6 EXPLICIT HTML/DEVICE NONBLOCKING CAPABILITY HOLDS
```

Authorities include:
- `docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md`
- `docs/seo/serp/M3_METHOD_RETROSPECTIVE_AND_CONTROL_DEBT_2026-09-18.md`
- `docs/seo/serp/competitors/M4A_R3_MAIN_CHAT_RETURN_QA_2026-09-18.md`
- `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_PAIRWISE_TOP10_SIMILARITY.tsv`
- accepted M4Q R2 current-snapshot authorities;
- `docs/seo/M6_SEARCH_REGION_CONTROL_MAIN_CHAT_RECONCILIATION_2026-09-23_R1.md`
- `docs/seo/M6_FINAL_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md`

Current hardening facts:
```text
AUTHORITY_QUERIES = 15
PRIMARY_OCCURRENCES = 300
PAIRWISE_TOP10 = 105/105
M4A_HARDENING_SCORE = 9.8/10
TEMPORAL_REPEAT_ACCOUNTED = 15/15
REGION_CONTROLS_EXECUTED = 2/2
REGION_REOPEN_TARGETED_GAP = 0
FULL_SERP_HTML_HOLDS = 6 / EXPLICIT NONBLOCKING
DEVICE_HOLDS = 3 / EXPLICIT NONBLOCKING
OUTCOME_UNKNOWN = 0
ORGANIC_XML_CLAIM_BOUNDARY = EXPLICIT
```

R4 current hardened score:

| dimension | score /10 |
|---|---:|
| primary organic evidence | 9.5 |
| full-volume analytical hardening | 10.0 |
| overlap controls | 10.0 |
| temporal controls | 9.5 |
| regional controls | 9.5 |
| full-SERP/device limitation honesty | 9.0 |
| provenance/readback | 10.0 |
| downstream readiness | 9.5 |

```text
M3_CURRENT_HARDENED_STAGE_SCORE = 9.6/10
M3_CONTROL_DEBT = CLOSED_WITH_EXPLICIT_NONBLOCKING_CAPABILITY_LIMITATIONS
M3 = PASS CURRENT HARDENED AUTHORITY
```

This does not rewrite the historical primary M3 score.

## 5. M4/M5/M6 downstream readiness crosscheck

M7 additionally requires current accepted downstream collection authority.

```text
M4A = ACCEPTED
M4B1 = ACCEPTED
M4B2 = ACCEPTED
M4Q = ACCEPTED WITH DECLARED SOURCE LIMITATION
M4C = ACCEPTED
M4 = ACCEPTED WITH DECLARED M4Q SOURCE LIMITATION

M5 = ACCEPTED / HYPOTHESIS ONLY / AI PROVIDER EVIDENCE = 0

M6 = PASS
M6_HIGH_VALUE_GAPS = CLOSED_OR_EXPLICIT_NONBLOCKING_HOLD
UNKNOWN_PROVIDER_OUTCOMES = 0
```

## 6. Critical retro debt

```text
R0_M0 = PASS
R1_M1 = PASS
R2_M2 = PASS CURRENT AUTHORITY
R3A_M3_ANALYTICAL_HARDENING = PASS
R3B_M3_CONTROL_PATCH = PASS WITH EXPLICIT NONBLOCKING LIMITATIONS

OPEN_CRITICAL_RETRO_DEBT = 0
```

Known noncritical limitations remain durable:
- historical B01 wrapper incompleteness;
- M4Q ranking-query source limitation;
- six full-SERP HTML controls unavailable in current Bridge;
- three explicit userAgent controls unavailable in current Bridge;
- M6 semantic/product HOLDs preserved.

## 7. R4 hard gate

```text
M0_CURRENT_STAGE_SCORE = 9.7 >= 9.0 PASS
M1_CURRENT_STAGE_SCORE = 9.6 >= 9.0 PASS
M2_CURRENT_EFFECTIVE_AUTHORITY_SCORE = 9.7 >= 9.0 PASS
M3_CURRENT_HARDENED_STAGE_SCORE = 9.6 >= 9.0 PASS

ALL_HARD_GATES = PASS
OPEN_CRITICAL_RETRO_DEBT = 0
M7_PRECONDITIONS = PASS
```

## 8. Verdict

```text
R4_CURRENT_AUTHORITY_RESCORE = PASS
M7_SEARCH_SIDE_COLLECTION_FREEZE_ALLOWED = true
```

Next:
create the immutable M7 Search-side freeze manifest with exact current Git authorities/hashes, open HOLD list, W1 allowed inputs and prohibited inputs.
