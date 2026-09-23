# Octoport SEO — M8 Search-only Semantic Master — PRE-HANDOFF R2

WORK_ID: `OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R2`
ROADMAP_STAGE: `M8 / W1`
Status: **READY FOR WORK PROMPT AFTER REMOTE READBACK**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
CURRENT_REMOTE_HEAD: `30948ed933dcd92ef09511629d1218c66341fce1`

## 1. Preparation authority

Executable step-preparation authority:

`docs/seo/M8_STEP_PREPARATION_2026-09-23_R2.md`

Required Git blob:
`bd33d4280935424a2dbc6da591964318df36877f`

Canonical direct-input manifest:

`docs/seo/M8_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-23_R2.json`

Required Git blob:
`0767d7b67b482281d02777cd1ba4530b00d090f4`

M7 complete audit freeze:

`docs/seo/M7_SEARCH_SIDE_FREEZE_MANIFEST_2026-09-23_R1.json`

Required Git blob:
`3cc09a62aa4ac4bed0af44939a9be63820657219`

Frozen Search-side input HEAD:

`3b71060bf529c67c7f3578ca6bfb268407e72b0b`

R1 M8 pre-handoff / prompt:
`SUPERSEDED / DO NOT EXECUTE`.

## 2. WHY_WORK_REQUIRED

```text
PRIMARY RAW OCCURRENCES = 25229
CANONICAL DIRECT/CONTEXT FILES = 46
FULL AUDIT CATALOG = 162

TASKS:
- full-volume raw occurrence accounting;
- conservative dedup / semantic identity formation;
- many-to-many lineage;
- product/demand/Search/competitor/M6 overlays;
- row-level relevance/task/intent/product-fit/priority;
- HOLD propagation;
- independent adversarial semantic QA;
- reason-code and state reconciliation.
```

Ordinary chat execution creates unacceptable risk of skipped rows, lineage loss, partial QA and sample bias.

```text
WORK_TRIGGER = REQUIRED
SAMPLE = FORBIDDEN
FIRST_N = FORBIDDEN
TRUNCATION_AS_ANALYSIS = FORBIDDEN
```

## 3. ALLOWED_INPUT_FILES / SOURCES

Binding canonical list:
`docs/seo/M8_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-23_R2.json`.

Input modes:

```text
PRIMARY_OCCURRENCE
DIRECT_PRODUCT_BOUNDARY
DIRECT_DEMAND_OVERLAY
DIRECT_SEARCH_OVERLAY
DIRECT_COMPETITOR_OVERLAY
DIRECT_M6_OVERLAY
CONTEXT_BOUNDARY
```

Any file outside the R2 direct manifest is unavailable for direct M8 semantic decision use.

If needed for provenance/defect resolution, Work may open only files whose M7 `w1_access` is `audit_fallback`, and must list every such fallback read in `M8_SOURCE_MANIFEST.md`.

Files with M7 access `method_only` define process only and must not become semantic evidence.

## 4. PROHIBITED_INPUTS / SOURCES

Forbidden as M8 semantic input:

```text
M7 w1_access = prohibited_semantic_input
M7 w1_access = prohibited_direct_use
M5 hypothesis register / M5 disposition
M4C M5 hypothesis inputs
Alice / GenSearch / AI-search evidence
new web research by Work
new Wordstat/Search/provider acquisition
chat memory as evidence
superseded M8 R1 prompt/pre-handoff as method authority
```

Hard gate:

`PROHIBITED_SEMANTIC_INPUT_USED = 0`.

## 5. AUTHORITATIVE UPSTREAM ARTIFACTS

At minimum:

- `docs/seo/PRODUCT_TRUTH.md`
- `docs/seo/evidence/M0_SCOPE_SOURCE_RETRO_CONSOLIDATION_2026-09-18.md`
- `docs/seo/technical/M1_OWNER_PRELAUNCH_SCOPE_CORRECTION_2026-09-23_R1.md`
- `docs/seo/technical/M1_LIVE_MEASUREMENT_BASELINE_2026-09-23_R1.md`
- current M2R lineage/family/QA;
- current M3 query authority;
- M4A hardened Search authority;
- M4Q R2 current Search/query authority;
- M4C current competitor candidate/synthesis authority;
- current M6 reconciliation and final acceptance;
- M7 freeze manifest;
- M8 R2 step preparation.

## 6. EXACT EXECUTION GOAL

Produce one complete Search-only semantic master from the frozen Search-side corpus.

Required transformation:

```text
25229 RAW SOURCE OCCURRENCES
-> deterministic raw ledger
-> exact-safe candidate identities
-> evidence-backed semantic equivalence only where proven
-> one semantic identity master
-> WORKING / REVIEW_HOLD / EXCLUDED / BRAND_DEFENSE
-> user task
-> Search intent
-> product fit
-> evidence states
-> priority
-> preliminary family
-> explicit ambiguity / reopen rule
-> independent adversarial QA
```

No final clustering or page decisions.

## 7. PRIMARY RAW OCCURRENCE EXPECTATIONS

```text
M2R = 1123
M4Q_R2_QUERY_UNIVERSE = 15542
M4C_COMPETITOR_CANDIDATE = 8431
M4Q_R2_TARGETED_DELTA = 133

TOTAL = 25229
```

Independent frozen-byte recheck was completed during R2 preparation.

## 8. SCHEMA / LINEAGE

Raw occurrence IDs:

```text
M8RAW_M2R_<000001...>
M8RAW_M4Q_<000001...>
M8RAW_M4C_<000001...>
M8RAW_TGT_<000001...>
```

Semantic identity ID:
`M8SID_<first16 sha256 of sorted unique member exact_safe_keys>`.

For no-raw brand defense:
hash `BRAND_DEFENSE\n<exact_safe_brand_key>`.

Every raw occurrence:
- exactly one primary semantic identity;
- original raw text preserved;
- source native ID preserved;
- provenance preserved.

Semantic dedupe must never erase raw rows.

## 9. NORMALIZATION / DEDUPE

Automatic exact-safe normalization only:

```text
Unicode NFC
outer trim
collapse internal whitespace
case-fold/lower
```

No automatic:
- stemming;
- morphology merge;
- synonym merge;
- word-order merge;
- punctuation deletion with semantic impact;
- marketplace substitution;
- AI/LLM entity substitution;
- Latin/Cyrillic substitution.

Non-exact semantic merge requires explicit equivalence on referent, task, entity scope, action/object meaning, intent and product-fit boundary.

Ambiguity -> separate identity or REVIEW_HOLD.

## 10. SEMANTIC STATES

Exactly one:

```text
WORKING
REVIEW_HOLD
EXCLUDED
BRAND_DEFENSE
```

Every identity requires:
- reason code;
- decision basis;
- claim boundary.

No default WORKING.

## 11. PRIORITY ENUM

```text
P1_CORE
P2_STRONG
P3_SUPPORTING
P4_EXPLORATORY
NA_REVIEW_HOLD
NA_EXCLUDED
NA_BRAND_DEFENSE
```

Priority must use multiple evidence classes and textual basis.

Frequency/rank/competitor recurrence alone cannot assign a tier.

## 12. PRODUCT-FIT ENUM

```text
SUPPORTED_CURRENT
SUPPORTED_WITH_BOUNDARY
UNPROVEN_CAPABILITY_HOLD
OUT_OF_SCOPE
AMBIGUOUS
```

Product Truth is binding.

## 13. SEARCH INTENT ENUM

```text
INFORMATIONAL
COMMERCIAL_INVESTIGATION
TRANSACTIONAL
NAVIGATIONAL
MIXED
AMBIGUOUS
```

`user_task_job` is separate from intent.

## 14. PRELIMINARY FAMILY

Allowed:

```text
F1..F10
NEW_CANDIDATE:<stable_slug>
HOLD
EXCLUDED
BRAND
```

Family is semantic organization only.

`PRELIMINARY FAMILY != FINAL CLUSTER != PAGE`.

## 15. REQUIRED OUTPUT FILES

Exactly 9:

1. `M8_SOURCE_MANIFEST.md`
2. `M8_RAW_OCCURRENCE_LEDGER.tsv`
3. `M8_SEMANTIC_IDENTITY_MASTER.tsv`
4. `M8_IDENTITY_SOURCE_XREF.tsv`
5. `M8_REASON_CODE_DICTIONARY.md`
6. `M8_HOLD_REVIEW_LEDGER.tsv`
7. `M8_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M8_QA.md`
9. `M8_RETURN_MANIFEST.json`

## 16. MANDATORY MASTER FIELDS

As frozen in R2 step preparation:

- semantic_identity_id;
- canonical_display_text;
- member_exact_safe_keys;
- primary_state;
- primary_reason_code;
- decision_basis_text;
- raw_occurrence_count;
- source_layer_count;
- source_layers;
- source_occurrence_ids;
- demand_evidence_state / refs;
- search_evidence_state / refs;
- competitor_evidence_state / refs;
- m6_resolution_state;
- product_fit_state / basis;
- user_task_job;
- intent_primary / secondary;
- commercial_informational_role;
- ambiguity_state;
- evidence_need;
- priority_tier / basis;
- redundancy_relation;
- canonicality_relation;
- preliminary_family_role;
- marketplace_tags;
- llm_entity_tags;
- brand_entity_tags;
- unsupported_capability_risk;
- hold_reopen_rule;
- claim_boundary.

## 17. REASON CODES

Required namespaces:

```text
W_* WORKING
H_* REVIEW_HOLD
X_* EXCLUDED
B_* BRAND_DEFENSE
```

Every used code must exist in the reason-code dictionary with evidence requirements, forbidden inference and reopen policy.

## 18. M6 HOLD PROPAGATION

Must account for:

```text
SOURCE HOLD_AMBIGUOUS ancestry = 1676
PRODUCT_CAPABILITY_HOLD = 29
M6PC004 INVALID_QUERY HOLD = 1
HTML CAPABILITY HOLD = 6
USERAGENT/DEVICE HOLD = 3
```

Any M6-HOLD ancestry that ends in a non-HOLD M8 state must appear in the adversarial diagnostic with exact resolving frozen evidence.

## 19. KNOWN FAILURE REGRESSIONS

Must explicitly test:

```text
DEFAULT_KEEP = 0
LOW_FREQUENCY_ONLY_EXCLUDE = 0
HIGH_FREQUENCY_ONLY_KEEP = 0
SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_TOPIC_AS_DEMAND = 0
PROVIDER_FAILURE_AS_ZERO_DEMAND = 0
PRODUCT_HOLD_AS_SUPPORTED_TASK = 0
BUYER_SELLER_COLLISION_SILENT = 0
HUMAN_SOFTWARE_COLLISION_SILENT = 0
EXTERNAL_INTERNAL_ANALYTICS_COLLISION_SILENT = 0
UNSUPPORTED_MUTATION_PROMOTED = 0
M5_AI_CONTAMINATION = 0
RAW_LINEAGE_LOSS = 0
SILENT_ROW_LOSS = 0
```

If a systematic defect is discovered:
fix mechanism -> rerun complete affected universe -> sibling-change report.

## 20. QA / ACCEPTANCE CHECKS

Hard accounting:

```text
RAW_OCCURRENCE_ROWS = 25229/25229
UNIQUE_RAW_OCCURRENCE_IDS = 25229
SILENT_ROW_LOSS = 0
UNLINKED_RAW_OCCURRENCES = 0
RAW_OCCURRENCE_MULTI_PRIMARY_IDENTITY = 0
NON_BRAND_IDENTITIES_WITHOUT_LINEAGE = 0

EVERY_IDENTITY_HAS_STATE_REASON = true
STATE_SUM_EQUALS_IDENTITY_ROWS = true
REASON_CODES_ALL_DEFINED = true
UNCERTAINTY_EXPLICIT = true

ALICE_INPUT_ROWS = 0
M5_HYPOTHESIS_USED_AS_SEARCH_TRUTH = 0

FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0

INDEPENDENT_SEMANTIC_QA = PASS
OPEN_CRITICAL_DEFECTS = 0
```

Main Chat later performs independent remote return QA and 10-dimension quality scoring.

## 21. STOP CONDITIONS

`HOLD_AUTHORITY_DRIFT`:
frozen product/method/semantic input changed.

`HOLD_INPUT_IDENTITY`:
required frozen identity does not match.

`PARTIAL_REWORK_REQUIRED`:
25229/25229 raw occurrence accounting fails.

`HOLD_SEMANTIC_CONTRACT_DEFECT`:
material evidence cannot be represented under frozen method.

Row-level `REVIEW_HOLD` is valid and expected.

## 22. PROVIDER / WEB POLICY

```text
WORDSTAT_CALLS = 0
YANDEX_SEARCH_CALLS = 0
ALICE_CALLS = 0
GENSEARCH_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
SITE_MUTATION = 0
GITHUB_WRITES_BY_WORK = 0
```

## 23. AUTHORITY DRIFT

At Work start:
fetch live branch and record START_HEAD.

Before return:
re-fetch and record END_OBSERVED_HEAD.

If only M8 release/progress/staging files changed and all frozen M7 inputs remain byte-identical:

`AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED`.

If frozen governing or input authority changed:
stop.

## 24. PUBLICATION POLICY

Work:
- creates exactly 9 final files;
- runs local QA;
- records hashes/bytes/rows;
- creates exactly one downloadable ZIP;
- does not write GitHub.

Owner:
- downloads one ZIP;
- extracts;
- uploads all nine files in one action.

Staging:

`docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R2/`

Exact upload URL:

https://github.com/MaksimUnimax/runtime-fixtures/upload/seo/wordstat-batch-01-2026-09-16/docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R2/

## 25. OWNER RELAY

Main Chat must provide the final canonical Work prompt **directly in chat**, complete and copy-ready.

The owner must not:
- reconstruct it from GitHub;
- merge multiple prompt fragments;
- decide output paths;
- repair methodology.

## 26. HANDOFF VERDICT

```text
WORK_ID = OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R2
ROADMAP_STAGE = M8 / W1
STEP_PREPARATION_R2 = PASS / REMOTE READBACK REQUIRED
WHY_WORK_REQUIRED = FROZEN
ALLOWED_INPUT_FILES = FROZEN
PROHIBITED_INPUTS = FROZEN
AUTHORITATIVE_UPSTREAM_ARTIFACTS = FROZEN
EXACT_EXECUTION_GOAL = FROZEN
REQUIRED_OUTPUT_FILES = 9
MANDATORY_FIELDS = FROZEN
ROW_JOIN_LINEAGE_EXPECTATIONS = FROZEN
CLAIM_BOUNDARIES = FROZEN
KNOWN_FAILURE_REGRESSIONS = FROZEN
QA_ACCEPTANCE_CHECKS = FROZEN
STOP_CONDITIONS = FROZEN
PUBLICATION_POLICY = FROZEN
OWNER_RELAY_STAGING_PATH = FROZEN

WORK_PROMPT_ALLOWED_BEFORE_THIS_FILE_READBACK = false
```
