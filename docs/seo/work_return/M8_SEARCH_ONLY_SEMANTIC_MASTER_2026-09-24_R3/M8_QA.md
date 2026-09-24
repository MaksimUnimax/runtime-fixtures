# M8 R3 QA

WORK_ID = OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3  
START_HEAD = cc9c667844dd6de5fc7cdb46c9abfd9cf05d3001  
END_OBSERVED_HEAD = cc9c667844dd6de5fc7cdb46c9abfd9cf05d3001  
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED  
VERDICT = PASS

LEVEL1_READ = PASS  
LEVEL2_READ = PASS  
ROADMAP_CURRENT_STATE_READ = PASS  
FAILURE_HISTORY_READ = PASS  
FRESH_METHOD_RESEARCH_AUTHORITY_READ = PASS

M7_BASE_FREEZE_BLOB_MATCH = true  
M7_TRANSPORT_CORRECTION_BLOB_MATCH = true  
M8_STEP_PREPARATION_R3_BLOB_MATCH = true  
M8_PRE_HANDOFF_R3_BLOB_MATCH = true  
M8_R3_DIRECT_INPUT_MANIFEST_BLOB_MATCH = true  
M8_R2_HOLD_RETURN_BLOB_MATCH = true  
FROZEN_INPUT_HEAD = 3b71060bf529c67c7f3578ca6bfb268407e72b0b

DIRECT_TSV_FILES_SCANNED = 26/26  
DIRECT_TSV_FILES_PASS = 26/26  
MALFORMED_DIRECT_TSV_PHYSICAL_LINES = 0  
RECOVERED_TARGETED_PAGE_EVIDENCE_BLOB_MATCH = true  
RECOVERED_TARGETED_PAGE_EVIDENCE_SHA256_MATCH = true  
RECOVERED_TARGETED_PAGE_EVIDENCE_ROWS = 47/47  
RECOVERED_TARGETED_PAGE_EVIDENCE_WIDTH = 21/21  
RECOVERED_TARGETED_PAGE_EVIDENCE_UNIQUE_IDS = 47/47  
HISTORICAL_MALFORMED_TARGETED_PAGE_EVIDENCE_DIRECTLY_PARSED = 0  
R2_SUPERSEDED_EXECUTION_AUTHORITY_USED = 0

M2R_OCCURRENCES = 1123/1123  
M4Q_QUERY_UNIVERSE_OCCURRENCES = 15542/15542  
M4C_CANDIDATE_OCCURRENCES = 8431/8431  
TARGETED_DELTA_OCCURRENCES = 133/133  
RAW_OCCURRENCE_ROWS = 25229/25229  
SILENT_SOURCE_LOSS = 0  
DUPLICATE_RAW_OCCURRENCE_ID = 0  
UNIQUE_RAW_OCCURRENCE_IDS = 25229

SEMANTIC_IDENTITY_ROWS = 7913  
WORKING = 104  
REVIEW_HOLD = 5064  
EXCLUDED = 2737  
BRAND_DEFENSE = 8  
STATE_SUM_EQUALS_IDENTITY_ROWS = true  
XREF_ROWS = 25229  
UNLINKED_RAW_OCCURRENCES = 0  
RAW_OCCURRENCE_MULTI_PRIMARY_IDENTITY = 0  
NON_BRAND_IDENTITIES_WITHOUT_LINEAGE = 0

EVERY_IDENTITY_HAS_STATE_REASON = true  
DEFAULT_KEEP = 0  
UNCERTAINTY_EXPLICIT = true  
REASON_CODES_ALL_DEFINED = true

M6_HOLD_ANCESTRY_ACCOUNTED = true  
M6_SOURCE_HOLD_ROWS_LINKED = 1676/1676  
M6_PRODUCT_FACT_HOLD_ROWS_LINKED = 29/29  
M6_INVALID_QUERY_HOLD = 1/1  
M6_HOLD_PROMOTED_TO_NON_HOLD = 0  
M6_HTML_CAPABILITY_HOLD = 6 (contextual collection limitation)  
M6_USERAGENT_DEVICE_HOLD = 3 (contextual collection limitation)  
PRODUCT_CAPABILITY_HOLD_ESCALATED_WITHOUT_AUTHORITY = 0  
PROVIDER_FAILURE_AS_ZERO_DEMAND = 0  
SEARCH_VISIBILITY_AS_DEMAND = 0  
COMPETITOR_TOPIC_AS_DEMAND = 0

ALICE_INPUT_ROWS = 0  
AI_SOURCE_USED_FOR_SEARCH_RELEVANCE = 0  
AI_SOURCE_USED_FOR_SEARCH_INTENT = 0  
AI_SOURCE_USED_FOR_PRIORITY = 0  
M5_HYPOTHESIS_USED_AS_SEARCH_TRUTH = 0  
PROHIBITED_SEMANTIC_INPUT_USED = 0

FINAL_CLUSTER_DECISIONS = 0  
FINAL_PAGE_OWNERSHIP_DECISIONS = 0  
FINAL_URL_H1_TITLE_IA_DECISIONS = 0  
INDEPENDENT_SEMANTIC_QA = PASS  
OPEN_CRITICAL_DEFECTS = 0  
PROVIDER_CALLS = 0  
WEB_ACQUISITION = 0  
GITHUB_WRITES = 0

### State distribution

| Value | Identities |
|---|---:|
| `REVIEW_HOLD` | 5064 |
| `EXCLUDED` | 2737 |
| `WORKING` | 104 |
| `BRAND_DEFENSE` | 8 |

### Reason distribution

| Value | Identities |
|---|---:|
| `H_M6_SOURCE_IDENTITY` | 2144 |
| `H_COMPETITOR_ONLY` | 1496 |
| `X_ACCEPTED_SOURCE_SCOPE` | 1400 |
| `X_THIRD_PARTY_CONNECTOR` | 685 |
| `X_M2R_NOISE` | 432 |
| `H_OTHER_ENTITY_NAVIGATION` | 387 |
| `H_M4Q_AMBIGUOUS` | 245 |
| `H_SOURCE_FRAGMENT` | 235 |
| `H_FINANCIAL_COMPLETENESS` | 125 |
| `H_M2R_BOUNDARY` | 109 |
| `X_STATUTORY_ONLY` | 109 |
| `H_HUMAN_SOFTWARE_ROLE` | 69 |
| `X_FOREIGN_ENTITY` | 65 |
| `W_M2R_PRODUCT_MATCH` | 53 |
| `W_PRODUCT_BOUNDED_COMPETITOR_LANGUAGE` | 51 |
| `H_EXTERNAL_INTELLIGENCE` | 50 |
| `H_SOURCE_PRODUCT_SCOPE_CONFLICT` | 45 |
| `H_UNSUPPORTED_ACTION` | 33 |
| `X_BUYER_ONLY` | 30 |
| `H_M6_PRODUCT_CAPABILITY` | 29 |
| `H_CREATIVE_CARD_COLLISION` | 26 |
| `H_UNDER_SPECIFIED` | 19 |
| `X_HUMAN_TRAINING` | 16 |
| `H_STATUTORY_SELLER_BOUNDARY` | 15 |
| `H_DEVELOPER_INTENT` | 9 |
| `H_PROCEDURAL_OR_CURRENT_POLICY` | 8 |
| `H_CARD_CONTENT_BOUNDARY` | 8 |
| `B_PRODUCT_BRAND` | 8 |
| `H_SEARCH_ONLY_PRODUCT_FIT` | 5 |
| `H_UNRESOLVED_CONTEXT` | 2 |
| `H_LLM_ADAPTER_UNPROVEN` | 2 |
| `H_REPORT_ACTOR_AMBIGUITY` | 2 |
| `H_M6_INVALID_QUERY` | 1 |

### Source layer to state (raw occurrence joins)

| Source layer | WORKING | REVIEW_HOLD | EXCLUDED | BRAND_DEFENSE | Total |
|---|---:|---:|---:|---:|---:|
| M2R | 97 | 359 | 667 | 0 | 1123 |
| M4Q_R2_QUERY_UNIVERSE | 218 | 10119 | 5205 | 0 | 15542 |
| M4C_COMPETITOR_CANDIDATE | 87 | 6065 | 2279 | 0 | 8431 |
| M4Q_R2_TARGETED_DELTA | 9 | 84 | 40 | 0 | 133 |

### Intent distribution

| Value | Identities |
|---|---:|
| `AMBIGUOUS` | 5496 |
| `INFORMATIONAL` | 1634 |
| `COMMERCIAL_INVESTIGATION` | 737 |
| `MIXED` | 38 |
| `NAVIGATIONAL` | 8 |

### Priority distribution

| Value | Identities |
|---|---:|
| `NA_REVIEW_HOLD` | 5064 |
| `NA_EXCLUDED` | 2737 |
| `P4_EXPLORATORY` | 95 |
| `P1_CORE` | 8 |
| `NA_BRAND_DEFENSE` | 8 |
| `P3_SUPPORTING` | 1 |

### Preliminary family distribution

| Value | Identities |
|---|---:|
| `HOLD` | 5064 |
| `EXCLUDED` | 2737 |
| `F3` | 78 |
| `F2` | 9 |
| `F1` | 8 |
| `BRAND` | 8 |
| `F6` | 6 |
| `F4` | 3 |

### Marketplace tags

| Value | Identities |
|---|---:|
| `UNSPECIFIED` | 3566 |
| `WILDBERRIES` | 1970 |
| `OZON` | 1542 |
| `GENERIC_MARKETPLACE` | 1071 |

### LLM entity tags

| Value | Identities |
|---|---:|
| `NONE` | 7362 |
| `CHATGPT` | 533 |
| `CLAUDE` | 13 |
| `DEEPSEEK` | 6 |
| `ALICE` | 5 |
| `GEMINI` | 3 |
| `QWEN` | 2 |

### Brand entity tags

| Value | Identities |
|---|---:|
| `NONE` | 7905 |
| `OCTOPORT_PRODUCT_TRUTH` | 8 |

### Top HOLD classes

| Value | Identities |
|---|---:|
| `H_M6_SOURCE_IDENTITY` | 2144 |
| `H_COMPETITOR_ONLY` | 1496 |
| `H_OTHER_ENTITY_NAVIGATION` | 387 |
| `H_M4Q_AMBIGUOUS` | 245 |
| `H_SOURCE_FRAGMENT` | 235 |
| `H_FINANCIAL_COMPLETENESS` | 125 |
| `H_M2R_BOUNDARY` | 109 |
| `H_HUMAN_SOFTWARE_ROLE` | 69 |
| `H_EXTERNAL_INTELLIGENCE` | 50 |
| `H_SOURCE_PRODUCT_SCOPE_CONFLICT` | 45 |
| `H_UNSUPPORTED_ACTION` | 33 |
| `H_M6_PRODUCT_CAPABILITY` | 29 |

### Independent diagnostic classes

| Value | Identities |
|---|---:|
| `MARKETPLACE_SCOPE_MIX` | 236 |
| `EXTERNAL_INTERNAL_ANALYTICS` | 92 |
| `HIGH_FREQUENCY_EXCLUDED` | 77 |
| `WORKING_WITHOUT_OBSERVED_COUNT` | 61 |
| `BUYER_SELLER_ROLE` | 55 |
| `SOURCE_LAYER_DISAGREEMENT` | 54 |
| `HUMAN_SOFTWARE_ROLE` | 52 |
| `READ_ONLY_MUTATION` | 35 |
| `CAPABILITY_AND_NAMED_ADAPTER_MECHANISM_RECHECK` | 13 |
| `SOURCE_FRAGMENT_MECHANISM_RECHECK` | 8 |
| `OPERATOR_DEVELOPER` | 6 |
| `SEARCH_PRODUCT_FIT_CONFLICT` | 6 |
| `NEAR_SIBLING_STATE_DIFFERENCE` | 2 |

Observed numeric low-frequency WORKING cases at threshold <=5: 0. WORKING without an observed numeric count: 61. These were inspected separately; absence of a numeric count is not a zero-demand finding.

### Adversarial run and changes

ADVERSARIAL_DIAGNOSTIC_ROWS = 697  
IDENTITIES_CHANGED_AFTER_ADVERSARIAL_QA = 21  
ROOT_CAUSE = Source fragments previously reached source exclusion or a bounded working task; competitor titles with named endpoints, action promises or unsupported adapters reached WORKING.  
FIX = Apply source completeness before scope inference, and capability/adapter checks before bounded WORKING.  
AFFECTED_UNIVERSE = All 7,905 exact-safe raw-backed identities / all 25,229 primary source rows; full rerun completed.  
KNOWN_EXAMPLE_REGRESSION = Fragment `#\nКак найти и скачать отчёт в Ozon Seller` and `Прайс-листы поставщиков для обновления остатков и цен на маркетплейсах` are REVIEW_HOLD.  
SIBLING_CHANGE_REPORT = 21 expected changed identities, zero unexpected state changes across complete exact-safe universe. Non-exact siblings remain distinct; all cross-state near siblings are listed in diagnostic, not auto-merged.

| Prior state | Current state | Count |
|---|---|---:|
| EXCLUDED | REVIEW_HOLD | 7 |
| WORKING | REVIEW_HOLD | 14 |

### Mandatory known-failure regressions

| Regression | Observed violations | Evidence |
|---|---:|---|
| `DEFAULT_KEEP` | 0 | Every WORKING has W reason and explicit bounded basis; no fallthrough keep. |
| `LOW_FREQUENCY_ONLY_EXCLUDE` | 0 | Low frequency WORKING risk scan retained; no frequency branch in state rule. |
| `HIGH_FREQUENCY_ONLY_KEEP` | 0 | High frequency EXCLUDED risk scan retained; no frequency branch in state rule. |
| `SEARCH_VISIBILITY_AS_DEMAND` | 0 | Demand refs exclusively M2R raw IDs; Search fields separate. |
| `COMPETITOR_TOPIC_AS_DEMAND` | 0 | Competitor refs separate; competitor-only rows have no Wordstat claim. |
| `PROVIDER_FAILURE_AS_ZERO_DEMAND` | 0 | M6 invalid query labelled invalid and held; empty literal top separated. |
| `PRODUCT_HOLD_AS_SUPPORTED_TASK` | 0 | 29 product hold M6 IDs linked to HOLD identities. |
| `BUYER_SELLER_COLLISION_SILENT` | 0 | Buyer/seller lexical scan and diagnostic rows; ambiguity held or buyer-only excluded. |
| `HUMAN_SOFTWARE_COLLISION_SILENT` | 0 | Human/software lexical scan and diagnostic rows; ambiguity held. |
| `EXTERNAL_INTERNAL_ANALYTICS_COLLISION_SILENT` | 0 | External intelligence requires endpoint proof; internal reports bounded. |
| `UNSUPPORTED_MUTATION_PROMOTED` | 0 | Product mutation guard precedes WORKING; changed examples in diagnostic. |
| `M5_AI_CONTAMINATION` | 0 | M5 hypothesis files absent from 46 direct paths. |
| `RAW_LINEAGE_LOSS` | 0 | Every raw row linked exactly once, original fields retained. |
| `SILENT_ROW_LOSS` | 0 | Physical row counts and four layer equation reconciled. |
| `HISTORICAL_MALFORMED_PAGE_FILE_DIRECTLY_PARSED` | 0 | Only recovered page path in direct manifest, historical path disallowed. |
| `R2_SUPERSEDED_EXECUTION_AUTHORITY_USED` | 0 | R3 blobs verified, R2 hold read for defect history only. |

M8 identities do not imply M9 cluster membership or any page, title, URL, H1, or IA decision. M9 remains blocked pending Main Chat acceptance.

