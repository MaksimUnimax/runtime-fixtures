# Octoport SEO — M7 Search-side Collection Freeze — 2026-09-23 R1

Status: **PASS / SEARCH-SIDE AUTHORITY FROZEN / M8 ALLOWED**
Branch: seo/wordstat-batch-01-2026-09-16

Frozen input HEAD:
`3b71060bf529c67c7f3578ca6bfb268407e72b0b`

Freeze manifest publication parent HEAD:
`60d3e09a0b53f8c48e8e0c6967905a63a4080f6d`

Canonical machine-readable freeze manifest:
`docs/seo/M7_SEARCH_SIDE_FREEZE_MANIFEST_2026-09-23_R1.json`

Manifest Git blob SHA:
`3cc09a62aa4ac4bed0af44939a9be63820657219`

## 1. Purpose

M7 freezes one auditable Search-side evidence snapshot before full-volume semantic judgment.

This is not a claim that demand/search results can never change. It is the versioned authority boundary for M8/M9/M10A.

Later upstream changes require explicit dependency analysis and selective reopen. They do not silently mutate this freeze.

## 2. Frozen stage state

```text
M0 = PASS
M1 = PASS / PRELAUNCH_NO_PRODUCTION_SITE
M2 = PASS_WITH_ACCEPTED_HISTORICAL_PERSISTENCE_LIMITATION
M3 = PASS_CURRENT_HARDENED_AUTHORITY
M4 = ACCEPTED_WITH_DECLARED_M4Q_SOURCE_LIMITATION
M5 = ACCEPTED_HYPOTHESIS_ONLY / EXCLUDED_FROM_W1 SEMANTIC DECISIONS
M6 = PASS
R4 = PASS

UNKNOWN_PROVIDER_OUTCOMES = 0
ALICE_PROVIDER_EVIDENCE_ROWS = 0
```

## 3. Freeze inventory QA

Machine manifest:

```text
AUTHORITY_FILES = 162
DIRECT_W1_ALLOWED = 66
CONTEXT_ONLY = 32
AUDIT_FALLBACK = 49
METHOD_ONLY = 7
PROHIBITED_SEMANTIC_INPUT = 7
PROHIBITED_DIRECT_USE = 1
```

Every frozen file is identified by exact repository path, exact Git blob SHA, byte size, role and W1 access class.

Remote readback:

```text
manifest.files.length = 162
manifest.authority_file_count = 162
JSON_PARSE = PASS
FROZEN_INPUT_HEAD = exact
UNKNOWN_PROVIDER_OUTCOMES = 0
ALICE_PROVIDER_EVIDENCE_ROWS = 0
```

## 4. Core frozen counts

```text
M2R_LINEAGE_ROWS = 1123
M3_AUTHORITY_QUERIES = 15
M3_PRIMARY_OCCURRENCES = 300
M4A_PAIRWISE_TOP10_ROWS = 105
M4A_REGISTRY_ROWS = 60
M4C_CANDIDATE_OCCURRENCE_ROWS = 8431
M4C_M6_CANDIDATE_ROWS = 5973
M4Q_QUERY_UNIVERSE_ROWS = 15542
M6_PRIMARY_SOURCE_ROWS = 6106
M6_HOLD_AMBIGUOUS_ROWS = 1676
M6_OWNER_PRODUCT_ROWS = 30
M6_REGION_CONTROL_ROWS = 40
```

These counts are frozen expectations for W1 accounting, not semantic KEEP counts.

## 5. Current accepted source layers

### Product / scope

Current product truth is frozen from PRODUCT_TRUTH, M0 consolidation and M1 prelaunch baseline.
Product truth may constrain relevance/product-fit. Search evidence may not invent product capability.

### Demand

Current demand authority:
- B01/B02 raw observations retained for audit/recovery;
- M2 retrospective gate;
- M2R 1123-row lineage ledger;
- M2R family coverage;
- Main Chat corrections.

Historical B01-01..14 exact-wrapper limitation remains explicit. No wrapper-only replay is required.

### Ordinary Search / M3

Current M3 authority:
- 15 accepted query authorities;
- 20 accepted organic rows each;
- accepted top20 exports/manifests/analyses;
- M4A 300-row classification;
- 105/105 pairwise Top10 overlap;
- later M4Q temporal/current Search evidence;
- M6 regional controls.

Current evidence is explicitly ordinary organic XML where applicable, not full-SERP HTML.

### Competitor / M4

Current competitor/search-surface authority:
- M4A hardened Search-derived registry and page candidates;
- M4Q R2 current query universe/visibility/targeted overlay;
- M4C current synthesis and candidate register;
- current Main Chat acceptance chain.

M4Q reverse ranking-query recall limitation remains explicit.

### M6 closure

Current M6 authority:
- full 6106-row pre-acquisition reconciliation;
- provider manifests/gap register/control plan;
- exact Wordstat raw outcomes;
- exact deferred Search lifecycle and full region export;
- 40-row regional comparison;
- product-fact overlay;
- explicit HOLD register;
- final M6 acceptance.

## 6. Explicit nonblocking HOLD / known limitations

```text
M6PC004_PROVIDER_INVALID_QUERY_HOLD = 1
SEARCH_HTML_CAPABILITY_HOLDS = 6
SEARCH_USERAGENT_CAPABILITY_HOLDS = 3
SOURCE_IDENTITY_HOLD_AMBIGUOUS = 1676
PRODUCT_CAPABILITY_HOLDS = 29
M4Q_RANKING_QUERY_SOURCE_LIMITATION = ACTIVE
B01_01_14_EXACT_WRAPPER_LIMITATION = ACTIVE / ACCEPTED
```

Hard interpretation:

```text
HOLD != ZERO DEMAND
HOLD != OUT_OF_SCOPE
HOLD != SUPPORTED PRODUCT TASK
HOLD != DEFAULT KEEP
```

M8 must preserve unresolved ambiguity explicitly.

## 7. W1/M8 allowed-input contract

The machine manifest assigns one access class to every frozen authority.

### allowed

May directly feed Search semantic identity / relevance / task / intent / priority.

Primary examples:
- Product Truth;
- M2R demand lineage;
- M3 query authority;
- M4A hardened Search evidence;
- M4Q current Search universe/visibility;
- M4C current competitor candidate/synthesis layers;
- M6 reconciliation/closure layers.

### context_only

May constrain interpretation or explain accepted decisions. It must not create new query evidence by itself.

### audit_fallback

May be read only for provenance recovery, discrepancy resolution, known-failure regression and source verification.
It must not be treated as a second independent occurrence universe.

### method_only

Defines execution/QA rules only.

### prohibited

prohibited_semantic_input:
- M5 AI diagnostic hypotheses and their input layers.

prohibited_direct_use:
- malformed historical S03 normalized transport.

The accepted corrected/recovered authority must be used instead where applicable.

## 8. Alice / AI exclusion

```text
ALICE_INPUT_ROWS = 0
AI_SOURCE_USED_FOR_SEARCH_RELEVANCE = 0
AI_SOURCE_USED_FOR_SEARCH_INTENT = 0
AI_SOURCE_USED_FOR_PRIORITY = 0
M5_HYPOTHESIS_USED_AS_SEARCH_TRUTH = 0
```

M5 files exist in the repository but are frozen as prohibited semantic inputs for W1.

AI diagnostic evidence remains M10C only after M10A Search-only baseline.

## 9. M8 boundary

M8 may decide semantic identity, Search-side relevance state, user task/job, intent/mixed intent, commercial/informational role, product/business-fit state, ambiguity/evidence need, priority tier with textual evidence, redundancy/canonicality relation, preliminary family role and marketplace/LLM/entity tags.

M8 may not finalize clusters, page ownership, URL architecture, H1/Title, IA or final CREATE/KEEP page plan.

## 10. M7 hard gate

```text
PRODUCT_SCOPE_CURRENT = PASS
M2_DEMAND_AUTHORITY = PASS_WITH_ACCEPTED_LIMITATIONS
M3_CONTROL_DEBT = CLOSED_WITH_EXPLICIT_NONBLOCKING_LIMITATIONS
M4_COMPETITOR_CORPUS = ACCEPTED
M6_HIGH_VALUE_GAPS = CLOSED_OR_EXPLICIT_NONBLOCKING_HOLD
UNKNOWN_PROVIDER_OUTCOMES = 0
SEARCH_EVIDENCE_DURABLE_READBACK = PASS
ALICE_EVIDENCE_IN_SEARCH_FREEZE = 0
FREEZE_MANIFEST = COMPLETE
W1_INPUT_AUTHORITY = FROZEN
OPEN_CRITICAL_DEFECTS = 0
```

## 11. Verdict

```text
M7_SEARCH_SIDE_COLLECTION_FREEZE = PASS
EVIDENCE_COLLECTION_COMPLETE = true
M8_SEMANTIC_MASTER_ALLOWED = true
```

Next physical stage:

`M8 SEARCH-ONLY SEMANTIC MASTER / W1 FULL-VOLUME WORK`.
