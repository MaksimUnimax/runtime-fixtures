# Octoport SEO — M4Q R2 Pass A R1 Main Chat QA

Date: 2026-09-23
Status: **MECHANICAL PASS / SEMANTIC ADMISSION REWORK REQUIRED**
WORK_ID: `OCTOPORT_SEO_M4Q_R2_QUERY_MANIFEST_2026-09-23_R1`

Owner upload HEAD:
`75fd8d5bbb153991a3b322192d934839b4f9fc48`

## 1. Mechanical QA — PASS

Independent Main Chat readback verified:

```text
RETURN_FILES = 6/6

QUERY_UNIVERSE_ROWS = 15542
QUERY_UNIVERSE_COLUMN_COUNT = 21
QUERY_UNIVERSE_WIDTH_PASS = 15542/15542
QUERY_UNIVERSE_ID_UNIQUE = 15542/15542

STATUS_COUNTS:
SEARCH_REQUIRED_CONTROL_REFRESH = 15
SEARCH_REQUIRED = 372
EXACT_DUPLICATE_OF_EXECUTION_QUERY = 432
NO_INCREMENTAL_SEARCH_INFORMATION_GAIN = 5417
NOT_A_PLAUSIBLE_SEARCH_QUERY = 716
OUT_OF_PRODUCT_SCOPE = 4556
HOLD_AMBIGUOUS = 4034
TOTAL = 15542

EXECUTION_MANIFEST_ROWS = 387
EXECUTION_COLUMN_COUNT = 22
EXECUTION_WIDTH_PASS = 387/387
EXECUTION_ID_UNIQUE = 387/387
EXECUTION_QUERY_KEY_UNIQUE = 387/387
EXECUTION_QUERY_TEXT_UNIQUE = 387/387
PROVIDER_LIMIT_CHECK_PASS = 387/387
BATCH_COUNT = 1
BATCH_SIZE = 387

EXECUTION_SOURCE_REFERENCES = 819
BROKEN_EXECUTION_SOURCE_REFERENCES = 0
ORPHAN_EXECUTION_IDS = 0
EMPTY_EXECUTION_PROVENANCE = 0
EMPTY_INFORMATION_GAIN_FIELDS = 0

AUTHORITY_DRIFT_STATUS = NONE
UNEXPECTED_UPLOAD_PATHS = 0
```

The Work return is mechanically lossless and internally consistent.

## 2. Semantic admission defect

The R1 execution manifest is NOT accepted for provider execution.

Root cause:
R1 allowed raw M4C competitor-derived page wording to become an executable Search query based only on plausibility + generic information gain.

That violates the project boundary:

```text
COMPETITOR_TOPIC != PROVEN_DEMAND
COMPETITOR_PAGE_HEADING != KNOWN_QUERY
M4C_CANDIDATE != SEARCH_QUERY_AUTHORITY
```

Observed execution composition:

```text
TOTAL_EXECUTION_QUERIES = 387
M3_OR_M2R_QUERY_AUTHORITY_PRESENT = 77
PURE_M4C_DERIVED_EXECUTION_QUERIES = 310
```

The 310 pure-M4C rows have no exact M2R/M3 query authority.

Independent adversarial checks:
- median executable query length = 61 characters;
- 205/310 pure-M4C execution queries are >=60 characters;
- 177/310 contain headline/listicle-style markers such as colon/semicolon/leading numeric framing.

Examples incorrectly admitted as provider commands include:

- `12 Telegram-ботов для селлеров: аналитика, цены и контроль без компьютера`
- `Alibaba объединяет ИИ-платформу Qwen с маркетплейсами: шопинг через диалог вместо поиска`
- `Ozon выяснил, чего россияне ждут от маркетплейсов: поиск по фото, ИИ-помощники и виртуальная примерка`
- `Wildberries и Russ Outdoor показали рекордную прибыль в 2024 году`
- `Выплаты селлерам М.Видео: сроки, отчёты и что делать при задержке`

These are competitor/content-surface evidence strings, not independently established search-query authority.

A Yandex Search call on such strings may return results, but that does not justify treating them as known demand/query evidence or spending provider budget on them before the M6 demand-validation gate.

## 3. Additional M2R admission review required

R1 selected M2R rows are much stronger than pure M4C headings, but M2R observation alone still requires the existing contamination/fit/information-gain gate.

Current execution-linked M2R rows include examples such as:

- `фнс отчеты маркетплейсы`
- `отчет о продажах маркетплейс проводки`
- `ии агенты маркетплейсы отчеты спортмастер`

Therefore Pass A2 must re-read the original M2R fields, including:
- evidence_type;
- fit_class;
- contamination_flags;
- capability_state;
- task family;
- observed count/seed state;
- lineage notes.

It may not inherit R1 SEARCH_REQUIRED status merely because the phrase appeared in Wordstat.

## 4. Correct query-authority hierarchy

For M4Q R2 provider execution:

### Tier A — accepted Search query authority
Exact accepted M3 query text.

May be eligible for:
`SEARCH_REQUIRED_CONTROL_REFRESH`

subject to current/deeper information gain.

### Tier B — observed demand/query evidence
Exact M2R Wordstat observed phrase.

May be eligible for:
`SEARCH_REQUIRED`

ONLY if:
- product/task fit is material;
- contamination is resolved;
- current Yandex top-100 competitor visibility can change a named decision;
- provider limits pass.

### Tier C — competitor-derived wording only
M4C candidate/page wording with NO exact M2R/M3 authority.

It is NOT directly executable in this M4Q R2 Search lane.

Route it to one of:
- `DEFER_TO_M6_DEMAND_VALIDATION`;
- `NO_INCREMENTAL_SEARCH_INFORMATION_GAIN`;
- `NOT_A_PLAUSIBLE_SEARCH_QUERY`;
- `OUT_OF_PRODUCT_SCOPE`;
- `HOLD_AMBIGUOUS`.

If a Tier-C row exact-safe matches a Tier-A/Tier-B executable query, preserve its provenance as:
`EXACT_DUPLICATE_OF_EXECUTION_QUERY`.

## 5. Pass A2 hard correction

Pass A2 must full-volume reclassify all 15,542 universe rows.

It must NOT simply delete the 310 suspect execution rows.

It must prove, for every eventual provider query:

```text
EVERY_EXECUTION_QUERY_HAS_QUERY_AUTHORITY = M3_EXACT or M2R_OBSERVED
PURE_M4C_ONLY_EXECUTION_QUERIES = 0
```

No target execution-query count is imposed.

Quality, not a quota, determines the final provider manifest.

## 6. Decision

```text
M4Q_R2_PASS_A_R1_MECHANICAL_QA = PASS
M4Q_R2_PASS_A_R1_SEMANTIC_ADMISSION_QA = FAIL
M4Q_R2_PASS_A_R1_PROVIDER_MANIFEST_ACCEPTED = false

PROVIDER_EXECUTION_ALLOWED = false
PROVIDER_CALLS_AUTHORIZED = 0

NEXT = M4Q R2 PASS A2 FULL-VOLUME QUERY-AUTHORITY CORRECTION IN WORK
```
