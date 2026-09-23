# Octoport SEO — M4Q R2 Pass B Main Chat acceptance R1

Date: 2026-09-23
Status: **ACCEPTED WITH EXPLICIT IDENTITY HOLDS / TARGETED M4C RECHECK REQUIRED**
WORK_ID: `OCTOPORT_SEO_M4Q_R2_VISIBILITY_RECONCILIATION_2026-09-23_R1`

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

Work START_HEAD / END_OBSERVED_HEAD:
`9e3b38b70d13d3fe28462acb059112880d1c2553`

Owner upload HEAD:
`f1d06387b7cb50ece79cd1a0e3f34b70cd1582e7`

## 1. Upload / drift QA

Independent remote comparison from Work END_OBSERVED_HEAD to owner upload HEAD:

```text
AHEAD_BY = 1
UPLOAD_DELTA_FILES = 8
EXPECTED_PASS_B_FILES = 8
UNEXPECTED_PATHS = 0
UPSTREAM_AUTHORITY_CHANGED_IN_UPLOAD = 0
```

The upload commit adds exactly:

1. M4Q_R2_PASS_B_SOURCE_MANIFEST.md
2. M4Q_R2_SERP_RESULT_LEDGER.tsv
3. M4Q_R2_COMPETITOR_VISIBILITY_MATRIX.tsv
4. M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv
5. M4Q_R2_COMPETITOR_VISIBILITY_SUMMARY.tsv
6. M4Q_R2_M4C_M6_RECONCILIATION.tsv
7. M4Q_R2_PASS_B_QA.md
8. M4Q_R2_PASS_B_RETURN_MANIFEST.json

No governing or frozen input path changed.

## 2. Byte identity QA

Main Chat independently fetched the uploaded branch on the execution host and computed SHA-256 over exact Git bytes.

All seven non-self files match the return manifest exactly:

```text
NON_SELF_FILE_BYTES_MATCH = 7/7
NON_SELF_FILE_SHA256_MATCH = 7/7
RETURN_MANIFEST_SELF_HASH_POLICY = VALID
```

Verified SHA-256:

- SOURCE_MANIFEST = `724851bf55eb0e6be0221aa3c5d09b6eb34c3abe40b5043288b589d44bcd0848`
- SERP_RESULT_LEDGER = `b571a5576329d509d7be0749a9c01a1215b0bb630f25fbfd574966da37983d38`
- COMPETITOR_VISIBILITY_MATRIX = `b5ec0d6c6069a79eb58d4fcd421e7b1f9fcfdbe8c0463d68efeb017c7f473146`
- QUERY_VISIBILITY_SUMMARY = `18cde0b16f07fc88fab09d2f44454c976c3d84cd3d122d299c56635c0d082948`
- COMPETITOR_VISIBILITY_SUMMARY = `e1693e68ed37c9e53be3c86f7f391ae4d3abed66425b49560aa77335c5e1d573`
- M4C_M6_RECONCILIATION = `560e86d2fe785c302922928c2d78bb934780d3dd786f98bbfc498548eb0c26b1`
- PASS_B_QA = `51dbdc4985a041cee8463f56c98d5e06294db7e77c51c983d74a869a03421f6b`

Uploaded return-manifest bytes are also readable and structurally valid; its self-hash is intentionally excluded by policy.

## 3. Independent full-volume mechanical QA

Main Chat independently parsed all uploaded TSVs with literal-TAB / quote-none semantics.

```text
SERP_RESULT_LEDGER_ROWS = 4500
SERP_RESULT_LEDGER_BAD_WIDTH_ROWS = 0
EXECUTION_QUERIES = 45
RESULTS_PER_QUERY = exactly 100 for 45/45
UNIQUE_QUERY_RANK_KEYS = 4500
DUPLICATE_QUERY_RANK_KEYS = 0

MATCH_AUTHORIZED = 1850
NO_AUTHORIZED_MATCH = 2576
AMBIGUOUS = 74
ACCOUNTING_EQUATION = 1850 + 2576 + 74 = 4500 PASS

VISIBILITY_MATRIX_ROWS = 1850
VISIBILITY_MATRIX_DUPLICATES = 0
MATRIX_IS_EXACT_PROJECTION_OF_MATCH_AUTHORIZED_LEDGER = true

QUERY_VISIBILITY_SUMMARY_ROWS = 45
QUERY_VISIBILITY_SUMMARY_IDS_UNIQUE = 45
QUERY_SUMMARY_RECOMPUTED_AGGREGATES = PASS

COMPETITOR_VISIBILITY_SUMMARY_ROWS = 60
COMPETITOR_VISIBILITY_SUMMARY_IDS_UNIQUE = 60
COMPETITOR_SUMMARY_RECOMPUTED_AGGREGATES = PASS

M4C_M6_RECONCILIATION_ROWS = 45
M4C_M6_RECONCILIATION_IDS_UNIQUE = 45
```

Authorized-match rank buckets independently recompute to:

```text
TOP3 = 96
TOP10_POSITIONS_4_10 = 197
RANK_11_20 = 245
RANK_21_100 = 1312
TOTAL = 1850
```

58/60 authorized entities have current visibility in the frozen 45-query top-100 corpus.

Two authorized entities have zero observed current visibility:
- `REG032 Reg`
- `REG044 Softrest`

This is only a bounded current visibility observation. It is not zero demand, zero indexed pages, or unknown-query recall.

## 4. Explicit identity holds

The 74 ambiguous rows are fully preserved and are not injected into the 1,850-row authorized visibility matrix.

They affect 35/45 queries.

Hosts:

```text
direct.yandex.ru = 34
seller-edu.ozon.ru = 17
www.wildberries.ru = 9
cmp.wildberries.ru = 2
kit.yandex.ru = 2
merchants.yandex.ru = 2
aistudio.yandex.ru = 1
corp.ozon.ru = 1
docs.ozon.ru = 1
ord.ozon.ru = 1
pay.yandex.ru = 1
ssp.wildberries.ru = 1
uslugi.yandex.ru = 1
wiki.mpstats.io = 1
TOTAL = 74
```

These are sibling hosts under existing registry registrable domains but are not automatically equivalent under current M4 authority.

Current M4 rule explicitly requires sibling-host equivalence or separate authority; therefore leaving them unassigned is the conservative correct behavior.

```text
FORCED_SIBLING_HOST_MATCHES = 0
IDENTITY_HOLDS_PRESERVED = 74
IDENTITY_HOLDS_ARE_NOT_SILENT_LOSS = true
```

One historical M3 control remains `HOLD_COMPARABILITY` because a current ambiguous top-20 sibling host could affect the exact set-level comparison.

This is an explicit bounded hold, not a critical corpus defect.

## 5. Historical M3 control QA

All 15 controls are accounted.

```text
MIXED_CHANGE = 13
CURRENT_RANKING_URL_CHANGE = 1
HOLD_COMPARABILITY = 1
M3_CONTROLS_ACCOUNTED = 15/15
```

No causal or demand-change claim is accepted from rank movement.

## 6. M4C / M6 dependency QA

Pass B query-level effects independently reconcile as:

```text
M4Q_EFFECT:
ENRICH_KNOWN_QUERY_VISIBILITY = 35
HOLD_IDENTITY_OR_COMPARABILITY = 10

M4C_EFFECT:
ENRICH_ACCEPTED_CONTEXT = 9
TARGETED_RECHECK_CANDIDATE = 36

M6_EFFECT:
KEEP_EXISTING_VALIDATION_ROUTE = 43
PRIORITIZE_EXISTING_VALIDATION_QUESTION = 1
SEARCH_CONTROL_ONLY = 1
```

Search visibility has not been promoted to demand.

```text
SEARCH_VISIBILITY_AS_DEMAND = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0
```

## 7. Mandatory targeted M4C follow-up discovered

Main Chat independently extracted every `CURRENT_TOP20_VENDOR_URLS_OUTSIDE_M4C` observation from the reconciliation.

```text
QUERY_ROWS_WITH_M4C_TARGETED_RECHECK_CANDIDATE = 36
CURRENT_TOP20_OUTSIDE_M4C_OCCURRENCES = 87
UNIQUE_CURRENT_TOP20_VENDOR_URLS_OUTSIDE_M4C = 59
AUTHORIZED_ENTITIES_AFFECTED = 12
```

Main Chat independently normalized all 59 URLs using the accepted comparison rule and compared them to all 15,469 accepted M4C URL-ledger rows.

```text
UNIQUE_TARGET_URLS = 59
ALREADY_PRESENT_IN_M4C_URL_LEDGER = 0
ABSENT_CONFIRMED = 59/59
```

Therefore this is real incremental evidence and a targeted M4C page recheck is required before resuming M5.

This is not a new broad crawl and not permission to reopen the full M4B frontier.

## 8. Acceptance

```text
M4Q_R2_PASS_B_UPLOAD_QA = PASS
M4Q_R2_PASS_B_BYTE_IDENTITY_QA = PASS
M4Q_R2_PASS_B_FULL_VOLUME_MECHANICAL_QA = PASS
M4Q_R2_PASS_B_CLAIM_BOUNDARY_QA = PASS

M4Q_R2_PASS_B = ACCEPTED_WITH_EXPLICIT_IDENTITY_HOLDS
M4Q_R2_KNOWN_QUERY_TOP100_ENRICHMENT = COMPLETE_FOR_45_FROZEN_QUERIES
ARBITRARY_DOMAIN_TO_UNKNOWN_QUERY_REVERSE_INDEX_RECALL = NOT_PROVEN / LIMITATION_ACTIVE

OPEN_CRITICAL_DEFECTS = 0
```

The 74 sibling-host holds remain explicit and unassigned unless a later dedicated identity-authority action resolves them.

## 9. Next cursor

```text
M4Q_R2 = ACCEPTED_WITH_EXPLICIT_IDENTITY_HOLDS
M4C = ACCEPTED_BUT_TARGETED_R2_RECHECK_REQUIRED_FOR_59_NEW_CURRENT_TOP20_VENDOR_URLS
M5 = PAUSED
M6 = NOT_STARTED
M7 = BLOCKED

NEXT = TARGETED_M4C R2-DEPENDENCY RECHECK OF EXACTLY 59 FROZEN URLS
```
