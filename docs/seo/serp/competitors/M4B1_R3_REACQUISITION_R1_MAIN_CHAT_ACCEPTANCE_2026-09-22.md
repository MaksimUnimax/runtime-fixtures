# Octoport SEO — M4B1 R3 reacquisition R1 Main Chat acceptance

Date: 2026-09-22
Status: **ACCEPTED AS CURRENT REACQUIRED R3 EVIDENCE**
WORK_ID: `OCTOPORT_SEO_M4B1_R3_REACQUISITION_2026-09-22_R1`
Branch: `seo/wordstat-batch-01-2026-09-16`
Owner upload HEAD: `64450ee61708d09a214f8ef324eb4e9ec1859348`
Work START_HEAD / END_OBSERVED_HEAD: `35e39d98e74aea75ba90b817bc267763fbd23e76`

## Identity and upload QA

The owner upload is exactly one commit ahead of the released Work HEAD.

Changed paths in the upload commit: exactly the nine required `M4B1R3_*` files under:

`docs/seo/serp/competitors/work_return/M4B1_COVERAGE_CLOSURE_2026-09-18_R3/`

No unrelated path changed.

Required files present: 9/9.

Independent Main Chat SHA-256 recomputation for the eight non-self-referential outputs: **8/8 MATCH**.
Declared byte sizes: **8/8 MATCH**.

TSV row counts independently confirmed:

```text
DISCOVERY_CHANNEL_COVERAGE = 45
URL_OVERLAY = 11222
PAGE_EVIDENCE_OVERLAY = 5118
CANDIDATE_TERMS_OVERLAY = 5116
ENTITY_SYNTHESIS_CURRENT = 45
FRONTIER_RECONCILIATION = 45
```

## Independent full-volume mechanical QA

Main Chat performed mechanical identity/join QA over the complete uploaded ledgers without replaying semantic page analysis.

```text
URL_ROWS = 11222
URL_ID_UNIQUE = 11222
URL_ID_DUPLICATES = 0
NORMALIZED_COMPARISON_URL_UNIQUE = 11222

PAGE_ROWS = 5118
PAGE_ID_UNIQUE = 5118
PAGE_ID_DUPLICATES = 0
PAGE_URL_ID_UNIQUE = 5118
PAGE_URL_ID_DUPLICATES = 0

CANDIDATE_ROWS = 5116
CANDIDATE_ID_UNIQUE = 5116
CANDIDATE_ID_DUPLICATES = 0

INSPECTED_URL_IDS = 5118
INSPECTED_MISSING_PAGE_EVIDENCE = 0
PAGE_UNKNOWN_URL_REFS = 0
PAGE_REFS_NON_INSPECTED_URLS = 0

CANDIDATE_UNKNOWN_PAGE_REFS = 0
CANDIDATE_UNKNOWN_URL_REFS = 0
CANDIDATE_MISSING_PROVENANCE_FIELDS = 0
```

Terminal-state distribution independently reproduced:

```text
INSPECTED = 5118
EXECUTION_ENVIRONMENT_FAILURE = 5971
HTTP_ERROR_503 = 97
DUPLICATE_CANONICAL = 19
ACCESS_BLOCKED = 10
AUTH_REQUIRED = 2
REDIRECT_OUT_OF_SCOPE = 2
NOT_FOUND = 1
NON_HTML = 1
HTTP_ERROR_502 = 1
TOTAL = 11222
```

All 11222 rows are classified `NEW_IN_SCOPE` relative to the frozen pre-R3 1612 universe.
All 11222 rows have `residual_recovery_required=false`.

## 45-entity closure QA

```text
AUTHORIZED_ENTITIES = 45
COVERAGE_ROWS = 45
SYNTHESIS_ROWS = 45
FRONTIER_ROWS = 45
UNIQUE_REGISTRY_IDS = 45/45/45

ANCHORS_COMPLETE = 45/45
PRIMARY_NAV_TAXONOMY_COMPLETE = 45/45
BREADCRUMB_LOCAL = 19 COMPLETE + 26 NOT_APPLICABLE
SITEMAP = 31 COMPLETE + 12 ACCESS_BLOCKED + 2 NOT_FOUND
PAGINATION = 17 COMPLETE + 24 NOT_APPLICABLE + 4 ACCESS_BLOCKED

COMPLETE_BOUNDED_FRONTIER = 45/45
FRONTIER_COUNT_EQUATIONS_PASS = 45/45
OPEN_URL_UNRESOLVED = 0
BLOCKING_CHANNEL_HOLD = 0
RESIDUAL_COUNT = 0
```

Reproduced totals:

```text
FRESH_R3_DISCOVERED = 11222
FRESH_R3_INSPECTED = 5118
FRESH_R3_ENVIRONMENT_FAILURE = 5971
FRESH_R3_OTHER_TERMINAL = 133
CURRENT_MERGED_NORMALIZED_UNIVERSE = 12834
CANDIDATE_ROWS = 5116
```

## Historical authority boundary

This return is **not** a byte-for-byte restoration of the lost 2026-09-18 R3 snapshot.

Historical surviving comparator:

```text
HISTORICAL_R3_NEW_IDENTITIES = 2888
HISTORICAL_R3_INSPECTED = 2845
HISTORICAL_R3_ENVIRONMENT_FAILURE = 43
HISTORICAL_POST_R3_MERGED_UNIVERSE = 4500
```

Fresh current reacquisition:

```text
CURRENT_R3_NEW_IDENTITIES = 11222
CURRENT_R3_INSPECTED = 5118
CURRENT_R3_ENVIRONMENT_FAILURE = 5971
CURRENT_POST_R3_MERGED_UNIVERSE = 12834
```

Classification:

`CURRENT_PUBLIC_DRIFT_DETECTED`

Therefore:

- do not relabel the reacquisition as the original historical R3 bytes;
- do not silently rewrite accepted R4/R5 history;
- do not use historical additive equations as current dedupe authority;
- M4C must reconcile current R3 with durable R4/R5 evidence by normalized identity and preserve multi-phase provenance;
- where current R3 and later historical layers overlap, M4C must not double count them.

## Verdict

```text
M4B1_R3_REACQUISITION_R1 = ACCEPTED_AS_CURRENT_EVIDENCE
M4B1_R3_REACQUISITION_TRANSPORT_QA = PASS
M4B1_R3_REACQUISITION_FULL_VOLUME_MECHANICAL_QA = PASS
CURRENT_PUBLIC_DRIFT_DETECTED = true
ORIGINAL_HISTORICAL_R3_BYTE_RESTORATION = false

M4B1_FINAL_HISTORICAL_ACCEPTANCE = PRESERVED
M4B2_ACCEPTANCE = PRESERVED
M4Q_ACCEPTANCE = PRESERVED

M4C_PREPARATION_ALLOWED = true
M4C_EXECUTION_ALLOWED = false
M4C_REQUIRED_RECONCILIATION = CURRENT_R3 + DURABLE_R4_R5 + M4B2 + M4Q
```

Next: prepare M4C under current Level1/Level2 with full-volume Work handling and explicit overlap/dedupe/provenance controls.
