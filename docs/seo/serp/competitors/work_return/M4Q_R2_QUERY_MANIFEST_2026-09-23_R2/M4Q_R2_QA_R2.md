# M4Q R2 Pass A2 — independent QA and semantic correction

WORK_ID: `OCTOPORT_SEO_M4Q_R2_QUERY_MANIFEST_2026-09-23_R2`  
START_HEAD: `ea97ad52b8119794a1f93b3a74b5c31bec0fcd64`  
END_OBSERVED_HEAD: `ea97ad52b8119794a1f93b3a74b5c31bec0fcd64`  
AUTHORITY_DRIFT_STATUS: `NONE`  
VERDICT: `PASS_QUERY_AUTHORITY_CORRECTION`

## Source accounting and dispositions

| Terminal Pass-A2 status | Rows |
|---|---:|
| `SEARCH_REQUIRED_CONTROL_REFRESH` | 15 |
| `SEARCH_REQUIRED` | 30 |
| `EXACT_DUPLICATE_OF_EXECUTION_QUERY` | 36 |
| `DEFER_TO_M6_DEMAND_VALIDATION` | 715 |
| `HOLD_AMBIGUOUS` | 4,078 |
| `OUT_OF_PRODUCT_SCOPE` | 4,451 |
| `NO_INCREMENTAL_SEARCH_INFORMATION_GAIN` | 5,501 |
| `NOT_A_PLAUSIBLE_SEARCH_QUERY` | 716 |
| `ALREADY_COVERED_CURRENT_NO_REQUERY` | 0 |
| `PROVIDER_LIMIT_INVALID` | 0 |
| **TOTAL** | **15,542** |

M3 `15/15`; M2R `1123/1123`; M4C occurrences `8431/8431`; M4C M6 groups `5973/5973`. All universe IDs are unique. All TSV records have their declared physical field width. Every source row has one R2 terminal status, a correction reason and preserved R1 status/ID. `SILENT_SOURCE_LOSS = 0`.

## R1 → R2 provider-query correction

| Measure | Count |
|---|---:|
| R1 execution queries | 387 |
| R1 queries with exact M3 or M2R source | 77 |
| R1 queries with pure M4C source | 310 |
| R2 execution queries | 45 |
| R2 M3-only authority | 8 |
| R2 M2R-only authority | 30 |
| R2 M3+M2R authority | 7 |
| R2 pure M4C-only execution | 0 |
| R1 execution removed or deferred | 353 |
| R1 execution retained | 34 |
| Newly admitted observed M2R queries absent from R1 | 11 |

The 310 pure-M4C R1 execution keys were all removed from provider readiness. All 387 R1 keys were compared by exact-safe identity, not by unstable R1 execution ID. The 11 newly admitted R2 keys arose from full M2R re-review: ten are observed analytics phrases suppressed by R1's broad `аналитик` pattern, which conflated the profession with the noun `аналитика`; the eleventh is an unqualified WB cabinet-help seed used as an explicit control. This is a corpus-wide correction, not an example deletion. The R1 mechanical accounting, raw wording and provenance remain preserved.

## M2R adversarial admission review

Each admitted M2R key was checked against the **original CSV**: phrase, direct/association/seed type, observed and total count, marketplace, task family, intent, fit, contamination flags, capability, observed-versus-inferred state, source query/lineage and reconciliation note. All original row JSON is carried into the new ledger. No executed M2R row has an original contamination flag, a human-analyst role, FNS/tax/accounting wording, buyer account, brand navigation, image-only generator, real-time bid/mutation requirement, or unsupported external niche/competitor-intelligence claim.

Unqualified `аналитика маркетплейсов`, `отчеты маркетплейсов`, `поисковые запросы wildberries` and related borderline wording are explicitly bounded **controls**. Their question is whether current Search is dominated by external intelligence, statutory accounting or buyer navigation versus seller-owned data. A result outside Octoport scope cannot be promoted to addressable demand. `подключить ии к маркетплейсу` is an `EMPTY_SUCCESS_SEED`; its Search control probes language only and explicitly records **no positive Wordstat demand**. No association-only query executes (`0`); all executed queries have exact M3 or verified M2R authority.

Every execution row includes a source ID set, exact text, authority class, original M2R evidence details, contamination review, phrase-specific comparator and decision, reason M3/M2R cannot answer current top-100 visibility, and stop interpretation. Zero observed authorized competitors in top-100 would mean only zero observed visibility for that exact query/region/time/depth, not zero demand or zero unknown competitor queries.

## Independent full-volume verification

A separate verifier reread the 24 frozen files, R1 ledger/execution, original M2R and M3 sources, all R2 tables and every row. It proved: all 15,542 original R1 identities/phrases/locators/provenances retained; original M2R JSON equals the source row; exact-safe keys and M3/M2R authority links; each selected query is verbatim from M3/M2R; every occurrence with its key links to exactly one execution ID; all 310 pure-M4C R1 keys absent; 45 unique execution keys, one complete ordered batch of 45; exact text max 400 Unicode characters/40 words; no orphan provenance; width and disposition reconciliation.

```text
LIVE_BRANCH_FETCHED = true
FROZEN_AUTHORITY_BLOBS_MATCH = 24/24
UNLISTED_INPUT_FILES_USED = 0
SOURCE_UNIVERSE_ROWS = 15542
SOURCE_UNIVERSE_IDS_UNIQUE = 15542
M2R_ACCOUNTED = 1123/1123
M3_ACCOUNTED = 15/15
M4C_CANDIDATE_ACCOUNTED = 8431/8431
M4C_M6_GROUPS_ACCOUNTED = 5973/5973
ALL_UNIVERSE_ROWS_TERMINAL = true
DISPOSITION_COUNTS_RECONCILE = true
SILENT_SOURCE_LOSS = 0
EVERY_EXECUTION_QUERY_HAS_QUERY_AUTHORITY = true
PURE_M4C_ONLY_EXECUTION_QUERIES = 0
EXECUTION_QUERY_EXACT_DUPLICATES = 0
SYNTHETIC_QUERIES_CREATED = 0
PROVIDER_LIMIT_VIOLATIONS = 0
M2R_CONTAMINATION_FIELDS_REVIEWED = true
M2R_EXECUTION_QUERIES_WITH_UNRESOLVED_CONTAMINATION = 0
ASSOCIATION_ONLY_EXECUTION_ROWS_HAVE_EXPLICIT_INFO_GAIN = true (0 association-only)
EVERY_EXECUTION_QUERY_HAS_PROVENANCE = true
EVERY_EXECUTION_QUERY_HAS_QUERY_SPECIFIC_INFO_GAIN = true
EVERY_EXECUTION_QUERY_IN_EXACTLY_ONE_BATCH = true
MAX_BATCH_SIZE = 45
PROVIDER_CALLS = 0
YANDEX_SEARCH_EXECUTION = 0
WORDSTAT_EXECUTION = 0
ALICE_EXECUTION = 0
WEB_ACQUISITION_BY_WORK = 0
COMPETITOR_TOPIC_AS_PROVEN_DEMAND = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
OPEN_CRITICAL_DEFECTS = 0
GITHUB_WRITES = 0
```

`DEFER_TO_M6_DEMAND_VALIDATION` preserves candidate evidence, not a Search command. The planned batch remains blocked until owner uploads all six unpacked files and Main Chat independently accepts them, then rechecks live Bridge capabilities, price, lifecycle and durable raw-evidence path.
