# Octoport SEO — M6 pre-acquisition Main Chat acceptance R1

Date: 2026-09-23
Status: **ACCEPTED / PROVIDER PLAN PARTIALLY RELEASEABLE / CAPABILITY HOLDS PRESERVED**
WORK_ID: `OCTOPORT_SEO_M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1`

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

Work START_HEAD / END_OBSERVED_HEAD:
`409d2bde3f79432141400bd4258dfa23627bf99b`

Owner upload HEAD:
`a15688f8d111e03022929160d5b66a4620a9866e`

## 1. Upload / drift QA

```text
UPLOAD_DELTA_FILES = 7
EXPECTED_RETURN_FILES = 7
UNEXPECTED_PATHS = 0
UPSTREAM_AUTHORITY_CHANGED_IN_UPLOAD = 0
```

GitHub line counts independently confirm:
- candidate reconciliation = 6106 data rows;
- gap register = 19;
- provider candidate manifest = 15;
- M3 control plan = 15.

## 2. Byte identity QA

Main Chat independently recomputed exact UTF-8 bytes and SHA-256 from uploaded Git blobs.

```text
NON_SELF_FILE_BYTES_MATCH = 6/6
NON_SELF_FILE_SHA256_MATCH = 6/6
RETURN_MANIFEST_SELF_HASH_POLICY = VALID
```

Verified SHA-256:
- M6_SOURCE_MANIFEST.md = `0d9eea31a4a4e9e16437edbd362868390bd4fca96948cc4951b6b61f6aa1fbb8`
- M6_DEMAND_CANDIDATE_RECONCILIATION.tsv = `88511188728629062ac065a8bc0f9ac75b5fcd12e13392c65199045a84419832`
- M6_GAP_REGISTER.tsv = `89d1d89ade0deb16e012854e8146f67c2d05f8204860bb0e983bbf4c890107ad`
- M6_PROVIDER_CANDIDATE_MANIFEST.tsv = `483aff4a5cd0d657f896a33f13e11ada9bd1e20c895aa0b3202d9e3479d6481d`
- M6_M3_CONTROL_PLAN.tsv = `8f9b6646f37b428e8ee70299ed3b68dd2ff6d4ce11d9497c1142edde1d11b191`
- M6_QA.md = `87e13f82e2ed12d81e9848fce3c5b46b25064400fd888d75cd9aa4cd3d2f25ed`

## 3. Primary-source provenance QA

Main Chat independently joined all M6 rows to the exact frozen sources.

```text
M4C_BASE_SOURCE_ROWS = 5973
M4C_BASE_RECONCILIATION_ROWS = 5973
M4C_MISSING_SOURCE_IDS = 0
M4C_SOURCE_GROUP_MISMATCH = 0
M4C_RAW_EXAMPLE_MISMATCH = 0
M4C_DISPLAY_WORDING_MISMATCH = 0

TARGETED_OVERLAY_SOURCE_ROWS = 133
TARGETED_OVERLAY_RECONCILIATION_ROWS = 133
OVERLAY_MISSING_SOURCE_IDS = 0
OVERLAY_WORDING_MISMATCH = 0
OVERLAY_STATUS_MISMATCH = 0
OVERLAY_REGISTRY_MISMATCH = 0

TOTAL_PRIMARY_SOURCE_ROWS = 6106/6106
SILENT_SOURCE_LOSS = 0
```

## 4. Disposition accounting

```text
REUSE_EXISTING_WORDSTAT_EVIDENCE = 1
EXACT_DUPLICATE = 0
PROVIDER_REQUIRED_DEMAND_VALIDATION = 4
NO_INCREMENTAL_INFORMATION_GAIN = 2574
OUT_OF_PRODUCT_SCOPE = 1821
HOLD_AMBIGUOUS = 1676
OWNER_OR_PRODUCT_FACT_REQUIRED = 30
TOTAL = 6106/6106
```

The four provider-required demand rows are exactly:

- M6PC001 — `ABC-анализ товаров на OZON`
- M6PC002 — `Как сделать ABC-анализ на Wildberries`
- M6PC003 — `Как построить воронку продаж на маркетплейсе`
- M6PC004 — `Процент возвратов на Wildberries: как считать, анализировать и снижать`

Each provider-required source row maps to exactly one valid provider candidate ID.
The provider-required ID set equals the four Wordstat candidate IDs exactly.

## 5. Wordstat interpretation correction / hard boundary

Fresh official GetTop documentation was rechecked by Main Chat immediately before provider release.

Current official facts:
- GetTop is last-30-days query statistics;
- the key phrase supports search operators;
- `totalCount` counts queries containing all key words regardless of word order;
- results/associations are bounded response evidence;
- `numPhrases` is 1..2000;
- region/device controls are supported.

Therefore the four planned literal source-wording calls are accepted only as:

```text
LITERAL_SOURCE_WORDING_DEMAND_PROBE
!= BROADER_TASK_DEMAND_PROOF
```

A successful empty/low response for a long editorial source phrase means only no/low returned evidence for that literal phrase constraint in the observed interval/region/device. It must not be generalized to absence of demand for a shorter natural-language task.

No synthetic shortened query is authorized by this acceptance.

## 6. Provider candidate QA

```text
PROVIDER_CANDIDATE_ROWS = 15
WORDSTAT_GET_TOP = 4
SEARCH_XML_REGION_CONTROL = 2
SEARCH_HTML_CONTROL_CAPABILITY_HOLD = 6
SEARCH_USERAGENT_CONTROL_CAPABILITY_HOLD = 3

EXECUTION_ALLOWED_IN_WORK_RETURN = false for 15/15
INVALID_PROVIDER_GAP_REFS = 0
INVALID_M3_PROVIDER_REFS = 0
```

Current Main Chat capability decision:

```text
WORDSTAT_GET_TOP_4 = RELEASEABLE_AFTER_CURRENT_TARIFF_CHECK
SEARCH_XML_REGION_CONTROL_2 = RELEASEABLE_AFTER_CURRENT_TARIFF_CHECK

SEARCH_HTML_CONTROL_6 = HOLD_BRIDGE_CAPABILITY_REQUIRED
SEARCH_USERAGENT_CONTROL_3 = HOLD_BRIDGE_CAPABILITY_REQUIRED
```

Current YMB 0.1.9 limitations remain:
- Search response format fixed to XML;
- no userAgent field.

No fake HTML/device command is accepted.

## 7. Fresh current tariff verification

Official Yandex Search API pricing rechecked on 2026-09-23:

```text
WORDSTAT_GET_TOP = 20 RUB / 1000 = 0.02 RUB/request
4 GET_TOP CALLS = 0.08 RUB

DAY_DEFERRED_SEARCH = 30.5 RUB / 1000 = 0.0305 RUB/request
2 REGION SEARCH SUBMISSIONS = 0.061 RUB day-price ceiling
```

Current YMB default Wordstat policy cost is also `0.02 RUB/getTop`.

Current deferred Search policy reserves `30500 microrub = 0.0305 RUB/submit`.

No pricing mismatch exists for the release ceilings.

## 8. M3 control QA

```text
M3_QUERIES_ACCOUNTED = 15/15
OVERLAP_CONTROL = REUSE_ACCEPTED_M4A for 15/15
TEMPORAL_CONTROL = REUSE_ACCEPTED_M4Q_R2_CURRENT_SNAPSHOT for 15/15

REGION:
NO_MATERIAL_INFO_GAIN = 13
SEARCH_REGION_PROVIDER_CANDIDATE = 2

FULL_SERP_HTML:
NO_MATERIAL_INFO_GAIN = 9
HOLD_BRIDGE_CAPABILITY_REQUIRED = 6

DEVICE_BROWSER:
NO_MATERIAL_INFO_GAIN = 12
HOLD_BRIDGE_CAPABILITY_REQUIRED = 3
```

M4A 105/105 pairwise Top10 authority closes overlap acquisition debt without new provider calls.

M4Q R2 2026-09-23 current snapshots close the organic temporal-repeat acquisition purpose for all 15 exact controls, subject to existing comparison/identity limitations.

## 9. Open non-provider dependencies

```text
OWNER_OR_PRODUCT_FACT_ROWS = 30
HOLD_AMBIGUOUS_ROWS = 1676
M1_PRE_M7_DEPENDENCY = OPEN/BLOCKING_PRE_M7
```

These do not authorize provider calls.

The 30 owner/product rows are separate from the four currently released Wordstat candidates.

M1 remains source-audit-only and must close before M6 final closure / M7.

## 10. Final verdict

```text
M6_PRE_ACQUISITION_UPLOAD_QA = PASS
M6_PRE_ACQUISITION_BYTE_IDENTITY_QA = PASS
M6_PRIMARY_SOURCE_PROVENANCE_QA = PASS
M6_PROVIDER_PLAN_QA = PASS_WITH_EXPLICIT_CAPABILITY_HOLDS
M6_M3_CONTROL_PLAN_QA = PASS

M6_PRE_ACQUISITION = ACCEPTED

PROVIDER_EXECUTION_RELEASEABLE:
  WORDSTAT = 4
  SEARCH_REGION = 2

CAPABILITY_HOLD:
  SEARCH_HTML = 6
  SEARCH_USERAGENT = 3

OPEN_CRITICAL_DEFECTS = 0
```

## 11. Execution order

To keep exactly-once persistence simple:

1. execute the two `numPhrases=200` ABC Wordstat probes as one durable Wordstat batch job;
2. persist/readback each provider result before the next provider call;
3. execute the two `numPhrases=100` Wordstat probes as a second durable batch job;
4. persist/readback;
5. execute the two region-213 Search controls as one deferred Search job;
6. persist/readback lifecycle and exported result evidence;
7. reconcile M6 provider outcomes;
8. separately close M1 before final M6/M7.

No provider replay on unknown outcome.
