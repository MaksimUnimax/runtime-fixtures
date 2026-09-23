# Octoport SEO — M4C R1 Main Chat final acceptance

Date: 2026-09-23
Status: **ACCEPTED**
WORK_ID: `OCTOPORT_SEO_M4C_SYNTHESIS_2026-09-22_R1`
Branch: `seo/wordstat-batch-01-2026-09-16`

Work START_HEAD / END_OBSERVED_HEAD:
`b72a510138bf5a324be45b74311058d364ae099f`

Owner single-ZIP publication HEAD:
`a19d3556492ac3359940a105af231b6f6b51f2dc`

## 1. Authority / drift check

Work executed against the released M4C authority at `b72a510138bf5a324be45b74311058d364ae099f`.

Comparison from Work START_HEAD to owner publication HEAD contains only:
- M4C return artifacts;
- M4C transport correction / staging files;
- M4 progress transport-state updates.

No M4 governing Level1/Level2 authority or frozen upstream M4A/M4B/M4Q input was replaced.

```text
AUTHORITY_DRIFT_STATUS = NONE
UNEXPECTED_POST_WORK_AUTHORITY_CHANGE = 0
```

## 2. Remote publication / transport QA

GitHub Web could not persist the two oversized logical TSV files directly.

Accepted durable transport:
`work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_ONLY_11_PARTS.zip`

Remote GitHub identity:

```text
REMOTE_ZIP_SIZE = 10082076
REMOTE_GIT_BLOB_SHA = f7bbe53099a169b1624097f998722dbebe9a7272

LOCAL_EXPECTED_GIT_BLOB_SHA =
f7bbe53099a169b1624097f998722dbebe9a7272

ZIP_SHA256 =
57ada78d090695163e33c14faed1fce5cd9f42c29fe5f4527d9b3e30aa05a04e
```

Remote Git blob identity + byte size match the locally verified ZIP exactly.

ZIP contents:
- exactly 11 expected part files;
- extra files = 0;
- 11/11 part byte sizes match;
- 11/11 part SHA-256 values match the transport authority.

Byte-exact reconstruction:

```text
M4C_PAGE_EVIDENCE.tsv
BYTES = 34206423
SHA256 = e0433463f29daf4d2bec1dccd3fec541e9263161672c752898be18c18e7fa175
DATA_ROWS = 12502

M4C_TASK_CAPABILITY_CLAIM_CONTENT_MATRIX.tsv
BYTES = 185122964
SHA256 = e45d2e6640d7b366b354ca66e19affcce04c8b2b18629905cfd020f9a2d6bebe
DATA_ROWS = 212200
```

The reconstructed bytes are byte-for-byte identical to the Work logical outputs.

For the eight other non-self logical outputs, remote Git blob identities match the exact locally verified Work-return bytes, and all eight SHA-256 / byte identities match `M4C_RETURN_MANIFEST.json`.

Together with the two reconstructed oversized logical outputs:

```text
NON_SELF_LOGICAL_OUTPUT_SHA256 = 10/10 MATCH
NON_SELF_LOGICAL_OUTPUT_BYTES = 10/10 MATCH
RETURN_MANIFEST_SELF_HASH_POLICY = VALID
```

## 3. TSV parser contract

Independent QA exposed a parser-compatibility condition, not data loss.

These M4C TSV artifacts are literal tab-delimited records:

```text
FIELD_SEPARATOR = TAB
RECORD_SEPARATOR = PHYSICAL_NEWLINE
DOUBLE_QUOTE = LITERAL_FIELD_CHARACTER
CSV_QUOTE_SEMANTICS = DISABLED
REQUIRED_PARSE_MODE = QUOTE_NONE / literal-tab
```

A generic CSV parser that treats `"` as a quote character can falsely merge rows in `M4C_PAGE_EVIDENCE.tsv`.

Under the authoritative literal-tab parse:
- every physical data line has exactly the declared column count;
- `M4C_PAGE_EVIDENCE.tsv` = 12,502 data records;
- no malformed-width rows exist;
- no data loss exists.

Downstream Work/analysis must use literal-tab parsing for these accepted M4C TSVs.

## 4. Independent full-volume mechanical QA

Registry / coverage:

```text
M4C_REGISTRY_ROWS = 60
M4C_REGISTRY_ID_UNIQUE = 60
M4C_COVERAGE_ROWS = 60
M4C_COVERAGE_ID_UNIQUE = 60
REGISTRY_COVERAGE_SET_MATCH = true

M4B1_PRODUCT_VENDOR = 45
M4B2_CONTEXT_BASELINE = 15

FRONTIER_EQUATIONS_PASS = 60/60
OPEN_URL_UNRESOLVED = 0
BLOCKING_CHANNEL_HOLD = 0
M4Q_LANE_STATE = SOURCE_UNAVAILABLE_DECLARED_LIMITATION for 60/60
```

URL ledger:

```text
M4C_DEDUPED_URL_ROWS = 15469
M4C_URL_ID_UNIQUE = 15469
ENTITY_URL_KEY_UNIQUE = 15469
URL_ENTITY_KEY_DUPLICATES = 0
UNKNOWN_REGISTRY_REFS = 0

SOURCE_URL_OCCURRENCES = 25295
SOURCE_URL_OCCURRENCES_ACCOUNTED = 25295/25295
SOURCE_OCCURRENCE_REFERENCE_DUPLICATES = 0
```

Page evidence:

```text
M4C_PAGE_EVIDENCE_ROWS = 12502
M4C_PAGE_EVIDENCE_ID_UNIQUE = 12502
M4C_PAGE_URL_ID_UNIQUE = 12502
UNKNOWN_URL_REFS = 0
UNKNOWN_REGISTRY_REFS = 0

URLS_WITH_BEST_CONTENT_EVIDENCE = 12502
PAGE_ROWS_MISSING_FOR_CONTENT_URL = 0
PAGE_ROWS_WITHOUT_CONTENT_URL = 0

SOURCE_PAGE_EVIDENCE_ROWS = 12820
CONTRIBUTING_PAGE_EVIDENCE_REFERENCES = 12820
UNIQUE_CONTRIBUTING_PAGE_EVIDENCE_REFERENCES = 12820
SOURCE_PAGE_ROWS_ACCOUNTED = 12820/12820
```

Fresh-current vs durable-history rule:

```text
R3_R4_R5_OVERLAP_URLS = 4306
FRESH_ACCESS_FAILURE_WITH_DURABLE_CONTENT = 3986
DURABLE_CONTENT_ERASED_BY_FRESH_FAILURE = 0
HISTORICAL_ADDITIVE_TOTAL_USED_AS_DEDUPE_AUTHORITY = false
```

Candidate register:

```text
M4C_CANDIDATE_OCCURRENCE_ROWS = 8431
CANDIDATE_OCCURRENCE_ID_UNIQUE = 8431
SOURCE_CANDIDATE_OCCURRENCES_ACCOUNTED = 8431/8431
UNKNOWN_REGISTRY_REFS = 0
UNKNOWN_URL_REFS = 0
UNKNOWN_PAGE_REFS = 0
MISSING_SOURCE_PROVENANCE = 0

SOURCE_LAYER_COUNTS:
M4B1_R1 = 390
M4B1_R2 = 1513
M4B1_R3_CURRENT = 5116
M4B2_R1 = 1412
```

Task/capability/claim/content matrix:

```text
M4C_MATRIX_ROWS = 212200
MATRIX_OBSERVATION_ID_UNIQUE = 212200
MATRIX_DUPLICATES = 0
UNKNOWN_REGISTRY_REFS = 0
UNKNOWN_PAGE_REFS = 0
UNKNOWN_URL_REFS = 0
MISSING_CORE_EVIDENCE_FIELDS = 0
```

M5 hypothesis inputs:

```text
M4C_M5_HYPOTHESIS_ROWS = 867
M5_HYPOTHESIS_ID_UNIQUE = 867
UNKNOWN_REGISTRY_REFS = 0
UNKNOWN_CANDIDATE_GROUPS = 0
MISSING_CORE_FIELDS = 0
STATUS = HYPOTHESIS_ONLY_NO_PROVIDER_CALL for 867/867
```

M6 demand/gap candidates:

```text
M4C_M6_CANDIDATE_ROWS = 5973
M6_CANDIDATE_ID_UNIQUE = 5973
UNKNOWN_CANDIDATE_GROUPS = 0
MISSING_CORE_FIELDS = 0
CONTRIBUTING_CANDIDATE_OCCURRENCE_REFS = 7200
UNIQUE_CONTRIBUTING_CANDIDATE_OCCURRENCE_REFS = 7200
UNKNOWN_CANDIDATE_OCCURRENCE_REFS = 0
STATUS = HOLD_VALIDATION_REQUIRED; NO_WORDSTAT_OR_SEARCH_RUN_IN_M4C for 5973/5973
```

## 5. Claim-boundary QA

All 12,502 page-evidence rows and all 212,200 matrix rows preserve:

`COMPETITOR_PAGE_OBSERVATION_ONLY; NOT_OCTOPORT_PRODUCT_FACT; NOT_PROVEN_DEMAND; NOT_FINAL_PAGE_DECISION`

All 8,431 candidate rows preserve:

`NORMALIZED_KEY_MATCH_IS_EXACT_COMPARISON_GROUPING_ONLY; NOT_SEMANTIC_IDENTITY_PROOF`

All 867 M5 rows preserve:

`DO_NOT_INFER_DEMAND, OCTOPORT_CAPABILITY, AI_SPECIFIC_PAGE, FINAL_CLUSTER, OR PAGE_OWNERSHIP`

All 5,973 M6 rows preserve:

`NORMALIZED_KEY_MATCH_IS_NOT_SEMANTIC_IDENTITY_PROOF; COMPETITOR_TOPIC_IS_NOT_PROVEN_DEMAND`

Therefore:

```text
COMPETITOR_TOPIC_AS_PROVEN_DEMAND = 0
COMPETITOR_CLAIM_AS_OCTOPORT_FACT = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0
```

## 6. M4Q limitation preserved

```text
RANKING_QUERY_LANE = SOURCE_UNAVAILABLE_DECLARED_LIMITATION
M4Q_ZERO_ROWS_INTERPRETED_AS_ZERO_QUERIES = false
KNOWN_COMPETITOR_RANKING_QUERY_RECALL_LIMITATION = ACTIVE
```

This is an accepted M4 source limitation, not a claim of complete reverse-index recall.

## 7. Quality gate

```text
QUALITY_TOTAL = 96 / 100
QUALITY_SCORE = 9.6 / 10
ALL_HARD_GATES = PASS
OPEN_CRITICAL_DEFECTS = 0
```

The score includes the declared M4Q recall limitation and the non-standard literal-tab parser contract as explicit, bounded limitations.

## 8. Final verdict

```text
M4C_R1 = ACCEPTED
M4C_RETURN_TRANSPORT_QA = PASS
M4C_FULL_VOLUME_MECHANICAL_QA = PASS
M4C_CLAIM_BOUNDARY_QA = PASS
M4C_PARSER_CONTRACT = LITERAL_TAB_QUOTE_NONE
M4C_OPEN_CRITICAL_DEFECTS = 0

M4A = ACCEPTED
M4B1 = ACCEPTED
M4B2 = ACCEPTED
M4Q = ACCEPTED_WITH_SOURCE_LIMITATION
M4 = ACCEPTED_WITH_DECLARED_M4Q_SOURCE_LIMITATION

M5 = NEXT_PREPARATION
M6 = NOT_STARTED
M7 = BLOCKED
```

M5 remains hypothesis-only under the current Level2 sequence. No Alice / AI provider acquisition is authorized by this acceptance.

The M4Q limitation remains reopenable only under its existing accepted reopen conditions.
