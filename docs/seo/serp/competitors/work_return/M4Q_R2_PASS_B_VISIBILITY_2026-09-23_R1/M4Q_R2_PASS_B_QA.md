# M4Q R2 Pass B — full-volume independent QA

WORK_ID: `OCTOPORT_SEO_M4Q_R2_VISIBILITY_RECONCILIATION_2026-09-23_R1`  
START_HEAD: `9e3b38b70d13d3fe28462acb059112880d1c2553`  
END_OBSERVED_HEAD: `9e3b38b70d13d3fe28462acb059112880d1c2553`  
AUTHORITY_DRIFT_STATUS: `NONE`  
VERDICT: `PASS_BOUNDED_VISIBILITY_WITH_EXPLICIT_IDENTITY_HOLDS`

## Input and immutable authority

```text
LIVE_BRANCH_FETCHED = true
FROZEN_PRE_HANDOFF_BLOBS_MATCH = 17/17
FROZEN_CRITICAL_A2_BLOBS_MATCH = 2/2
ACCEPTED_A2_NONSELF_SHA_BYTES_MATCH = 5/5
ACCEPTED_STORED_M4C_NONSELF_SHA_BYTES_MATCH = 8/8
ATTACHMENT_SHA256_MATCH = 2/2
EXPORT_SCHEMA_MATCH = 2/2
EXPORT_JOB_ID_MATCH = 2/2
EXPORT_REVISION_MATCH = 2/2
EXPORT_TERMINAL_SUMMARY_MATCH = 2/2
FINAL_HAS_MORE_FALSE = true
QUERY_ORDER_MATCH = 45/45
QUERY_IDS_UNIQUE = 45/45
```

Both accepted exports were parsed in full, including exactly indices 0–44 without gaps or overlaps. Each item is `SUCCEEDED`, carries its original operation ID and all 100 normalized rows. Provider times and search parameters are recorded in source manifest; no device-specific generalization is made.

## Exact result and entity accounting

```text
SERP_RESULT_ROWS = 4500/4500
QUERY_RESULT_COUNTS = 45/45 x 100
SILENT_SERP_ROW_LOSS = 0
UNIQUE_QUERY_RANK_KEYS = 4500/4500
DUPLICATE_QUERY_RANK_KEYS = 0
MISSING_EXPECTED_RANK_KEYS = 0
PRESERVED_PROVIDER_ANOMALIES = 0
AUTHORIZED_COMPETITORS_ACCOUNTED = 60/60
AUTHORIZED_COMPETITOR_MATCH_ROWS = 1850
NO_AUTHORIZED_MATCH_ROWS = 2576
AMBIGUOUS_COMPETITOR_MATCH_ROWS = 74
UNKNOWN_REGISTRY_REFS = 0
VISIBILITY_MATRIX_ROWS = 1850
EXACT_ACCEPTED_M4C_URL_MATCH_ROWS = 826
NO_AUTHORIZED_VISIBILITY_QUERY_COUNT = 0
NO_AUTHORIZED_VISIBILITY_COMPETITOR_COUNT = 2
```

Confirmed occurrences by rank bucket: `TOP3=96`, `TOP10=197` (positions 4–10), `11_20=245`, `21_100=1312`; sum 1850. The two authorized entities without observed presence in these 45 exact-query snapshots are `REG032, REG044`. This is not a conclusion of absent market activity or unknown-query rank coverage.

### Explicit unresolved identity, not forced matches

The 74 current rows have hostnames under registry registrable domains but lack an exact accepted host or ranking URL anchor. They retain `AMBIGUOUS`, blank competitor ID, `UNAUTHORIZED_SIBLING_HOST` basis and HOLD confidence. They break down into `TOP3=1`, `TOP10=4`, `11_20=9`, `21_100=60`.

| Unapproved sibling host | Rows |
|---|---:|
| `direct.yandex.ru` | 34 |
| `seller-edu.ozon.ru` | 17 |
| `www.wildberries.ru` | 9 |
| `cmp.wildberries.ru` | 2 |
| `kit.yandex.ru` | 2 |
| `merchants.yandex.ru` | 2 |
| `aistudio.yandex.ru` | 1 |
| `corp.ozon.ru` | 1 |
| `docs.ozon.ru` | 1 |
| `ord.ozon.ru` | 1 |
| `pay.yandex.ru` | 1 |
| `ssp.wildberries.ru` | 1 |
| `uslugi.yandex.ru` | 1 |
| `wiki.mpstats.io` | 1 |

These rows are fully accounted in the SERP ledger and query summaries; no collision forces a fabricated registry assignment. One M3 control has `HOLD_COMPARABILITY` because an ambiguous current top-20 host may affect the exact set comparison. The unresolved 74 host identities are explicit nonblocking analytical HOLDs, not silent losses or critical defects.

## Historical M3 control interpretation

```text
M3_CONTROL_QUERIES_ACCOUNTED = 15/15
HISTORICAL_BASELINE_OCCURRENCES_READ = 300/300
HISTORICAL_BASELINE_DEPTH = 20
CURRENT_DEPTH = 100
```

| Conservative comparison state | Queries |
|---|---:|
| `CURRENT_RANKING_URL_CHANGE` | 1 |
| `HOLD_COMPARABILITY` | 1 |
| `MIXED_CHANGE` | 13 |

Historical `R04R1` URL/rank ID is joined to accepted M3 `R04` by exact-safe query text. `MIXED_CHANGE` identifies both set and shared-entity URL-set differences in the two dated top-20 snapshots, not a causal shift, demand movement or universal ranking trend. The `HOLD_COMPARABILITY` control retains the definite observations while declining a closed set-level claim. The 30 other queries have no exact historical M3 baseline and are labelled `NOT_M3_CONTROL`.

## Dependency and demand boundaries

```text
M4C_RECONCILIATION_QUERIES_ACCOUNTED = 45/45
M6_ROUTING_QUERIES_ACCOUNTED = 45/45
M4C_TARGETED_URL_RECHECK_CANDIDATES = 36
M6_EXACT_WORDING_MATCH_QUERIES = 1
M6_URL_CONTEXT_ONLY_MATCH_QUERIES = 44
KNOWN_QUERY_TOP100_ENRICHMENT = COMPLETE
ARBITRARY_DOMAIN_TO_UNKNOWN_QUERY_REVERSE_INDEX_RECALL = NOT_PROVEN / LIMITATION_ACTIVE
SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_FACT_AS_OCTOPORT_FACT = 0
COMPETITOR_PAGE_TOPIC_AS_PROVEN_DEMAND = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0
PROVIDER_CALLS = 0
YANDEX_SEARCH_EXECUTION = 0
WORDSTAT_EXECUTION = 0
ALICE_EXECUTION = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES = 0
OPEN_CRITICAL_DEFECTS = 0
```

Each query retains its exact Pass A2 information-gain question, downstream decision, observed IDs/ranks/URLs and a stop interpretation. A targeted M4C recheck flags a current top-20 vendor ranking URL absent from the accepted M4C exact URL ledger; it does not claim the URL's content has been independently fetched in this pass. M6 exact-wording groups and merely co-located URL-context groups are separate fields. No M6 group is marked demand-validated by Search visibility.

An independent verifier reread both JSON pages and compared each of the 4,500 source tuples (index, rank, query, URL, title, snippet, operation) with the ledger, then independently checked the rank-key set, matrix projection, per-query and per-competitor aggregations, all 45 reconciliations and all 15 controls. `INDEPENDENT_FULL_CORPUS_QA = PASS`.
