# Octoport SEO — M12 Main Chat acceptance — 2026-09-25 R1

Status: **ACCEPTED / PAGE SPECS + CONTENT SYSTEM CLOSED / M13 PREFLIGHT OPEN**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

## Accepted outputs

- `docs/seo/M12_SOURCE_MANIFEST_2026-09-25_R1.md`
  blob `2745b9bab50eb7613ac5bf982bf66697fc059370`
- `docs/seo/M12_PAGE_SPEC_REGISTRY_2026-09-25_R1.tsv`
  blob `8f694542653b2788057651e8a7c6c91b87ba2c7f`
- `docs/seo/M12_CONTENT_BLOCK_CONTRACT_2026-09-25_R1.tsv`
  blob `59b5343e49a04fdcb74e24002ae108a1d71aa09a`
- `docs/seo/M12_INTERNAL_LINK_CONTRACT_2026-09-25_R1.tsv`
  blob `f35ca60c318efe0c74b2d6219bcb680943560c14`
- `docs/seo/M12_PROOF_TRUST_REQUIREMENTS_2026-09-25_R1.tsv`
  blob `7b5e5a523a877dad3a08343c681ed7a379ec2631`
- `docs/seo/M12_ADVERSARIAL_DIAGNOSTIC_2026-09-25_R1.tsv`
  blob `ba5139d2abcdf529987c085c42d275fe4a49d85c`
- `docs/seo/M12_QA_2026-09-25_R1.md`
  blob `a5cc55bbf39619bc571519e4802819ea48fdfb76`

## Final target pages

### Existing HOME

```text
PAGE_OWNER_ID = M11PAGE_EXISTING_HOME
CANONICAL = https://octoport.ru/
ACTION = KEEP
ROUTE = HOME
PRIMARY_QUERY = подключить ии к маркетплейсу
QUERY_METRIC = EMPTY_SUCCESS_SEED / NO COUNT RETURNED
SEO_PRIORITY = HIGH
```

H1 target:
retain current `Ваш ИИ получает руки для работы с маркетплейсами.` only with explicit connector explanation visible on the first screen.

Title target:
`Подключите ваш ИИ к Ozon и Wildberries | Octoport`.

HOME owns the generic connector/category task only.

### Planned seller-owned analytics page

```text
PAGE_OWNER_ID = M11PAGE_aaa90aa723a3694c
CANONICAL_PLANNED_URL = https://octoport.ru/seller-analytics
ACTION = CREATE
ROUTE = FEATURE_OR_USE_CASE
PRIMARY_QUERY = ии для аналитики маркетплейсов
EXACT_OBSERVED_QUERY_COUNT = 15
SEO_PRIORITY = LOW
```

H1 target:
`Анализируйте данные магазина на Ozon и Wildberries с вашим ИИ`.

Title target:
`ИИ для аналитики маркетплейсов — данные вашего магазина | Octoport`.

The page is explicitly seller-owned analytics only.

## Demand provenance acceptance

HOME:
```text
M2R evidence = EMPTY_SUCCESS_SEED
observed_count = NOT_RETURNED
zero-demand inference = forbidden
```

Analytics:
```text
B01 direct observed_count = 15
B02 direct observed_count = 15
M2R-A01 direct observed_count = 15
M2R-A01 broad seed_total_count = 4290
accepted exact-query metric = 15
4290 used as exact-query frequency = false
```

## Coverage boundary

```text
M11_ASSIGNED_OWNER_SET = 2/2
M12_PAGE_SPEC_ROWS = 2/2
M11_HOLD_CLUSTERS = 102
HOLD_CLUSTERS_IMPORTED_AS_PRIMARY = 0
HOLD_CLUSTERS_IMPORTED_AS_SECONDARY = 0
HOLD_CLUSTERS_IMPORTED_AS_FAQ_TARGET = 0
```

The 102 held clusters remain outside M12 target coverage.

## Content/proof boundary

HOME must remain:
- chosen-user-AI;
- browser bridge;
- Ozon + Wildberries;
- read-only launch;
- accurate beta state;
- no implication that Octoport is its own LLM.

Analytics must remain:
- permitted seller-owned data only;
- analysis/explanation/report interpretation;
- no external competitor/niche intelligence;
- no statutory accounting advice;
- no autonomous mutation/write-back.

Before production analytics content:
- every named data category requires endpoint/product authority;
- at least one real sanitized demo or source-backed product example is required;
- fake screenshot/case/metric is forbidden.

## FAQ/schema acceptance

```text
FAQ_REQUIRED = false for both pages
FAKE_FAQ = 0
ANALYTICS_SCHEMA = NONE
HOME_SOFTWAREAPPLICATION_SCHEMA = NOT_ASSUMED / M13 REVIEW
SCHEMA_AS_RANKING_PROOF = false
```

## IA

Required page relationships:
- HOME -> `/seller-analytics` = parent-child;
- `/seller-analytics` -> HOME = contextual internal link.

Final anchor wording is not frozen by M12.

## Independent QA

```text
PAGE_SPEC_ROWS = 2/2
OWNER_SET_EXACT = true
PRIMARY_CLUSTER_SET_EXACT = true
CONTENT_BLOCK_ROWS = 15
INTERNAL_LINK_ROWS = 2/2
PROOF_TRUST_ROWS = 6
ADVERSARIAL_ROWS = 18/18
ADVERSARIAL_PASS = 18/18

EMPTY_SUCCESS_SEED_NOT_ZERO = true
ANALYTICS_QUERY_METRIC = 15
BROAD_4290_NOT_USED_AS_QUERY_METRIC = true

URL_UNIQUENESS = PASS
CURRENT_ROUTE_COLLISION = 0
ORPHAN_TARGETS = 0

PRODUCT_TRUTH_CONFLICT = 0
FAKE_FAQ = 0
FAKE_SCHEMA = 0
FAKE_PROOF = 0
PUBLIC_BETA_OPEN_CLAIM = 0
HISTORICAL_PRICE_CLAIM = 0

SITE_MUTATIONS = 0
M13_EXECUTION = 0
OPEN_CRITICAL_SPEC_DEFECTS = 0
```

## Quality score

```text
QUALITY_TOTAL = 98/100
QUALITY_SCORE = 9.8/10
```

The analytics page intentionally retains production proof obligations; this is not a spec failure.

## Acceptance

```text
M12 = ACCEPTED
M12_PAGE_SPECS_CONTENT_SYSTEM = CLOSED
M13_PREFLIGHT = OPEN
M13_EXECUTION = NOT_YET_RELEASED
M14+ = BLOCKED
```
