> **SUPERSEDED / DO NOT EXECUTE.** Replaced by M8 R2 two-level preparation after OSEO-F04. This file is retained as history only.

# M8 — canonical ChatGPT Work Search-only semantic master prompt

WORK_ID: `OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R1`

CONTINUE THE EXISTING OCTOPORT SEO PROGRAM.

THIS IS AN EXECUTION TASK.
THIS IS M8 / W1 SEARCH-ONLY SEMANTIC MASTER ONLY.

THIS IS NOT A NEW PROJECT.
THIS IS NOT WORDSTAT EXECUTION.
THIS IS NOT YANDEX SEARCH EXECUTION.
THIS IS NOT ALICE / GENSEARCH.
THIS IS NOT M9 CLUSTERING.
THIS IS NOT QUERY->PAGE OWNERSHIP.
THIS IS NOT SITE ARCHITECTURE.
THIS IS NOT URL / H1 / TITLE / IA DESIGN.
THIS IS NOT SITE IMPLEMENTATION.

Repository:
`MaksimUnimax/runtime-fixtures`

Branch:
`seo/wordstat-batch-01-2026-09-16`

Frozen Search-side input HEAD:
`3b71060bf529c67c7f3578ca6bfb268407e72b0b`

M7 freeze manifest:
`docs/seo/M7_SEARCH_SIDE_FREEZE_MANIFEST_2026-09-23_R1.json`

Required freeze-manifest Git blob:
`3cc09a62aa4ac4bed0af44939a9be63820657219`

M7 acceptance:
`docs/seo/M7_SEARCH_SIDE_COLLECTION_FREEZE_2026-09-23_R1.md`

M8 pre-handoff contract:
`docs/seo/M8_SEARCH_ONLY_SEMANTIC_MASTER_PRE_HANDOFF_2026-09-23_R1.md`

Required pre-handoff Git blob:
`7685fc0af3672e487639cb2666883ec222a1c355`

Prompt preparation parent HEAD:
`bdc212bd93595f28ecf5cc2d67fc682d03a4d696`

======================================================================
0. FIRST ACTION — LIVE PREFLIGHT
======================================================================

Fetch the live remote branch and record START_HEAD.

Read in full:

- docs/seo/LEVEL1/README.md
- docs/seo/EXECUTION_RULES.md
- docs/seo/WORK_HANDOFF_RULE.md
- docs/seo/QUALITY_FIRST_RESOURCE_RULE.md
- docs/seo/PRODUCT_TRUTH.md
- docs/seo/SEO_MASTER_ROADMAP_2026-09-16.md
- docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md
- docs/seo/LEVEL2/M7_M8_SEARCH_FREEZE_AND_SEMANTIC_MASTER_RULES.md
- docs/seo/M7_SEARCH_SIDE_COLLECTION_FREEZE_2026-09-23_R1.md
- docs/seo/M7_SEARCH_SIDE_FREEZE_MANIFEST_2026-09-23_R1.json
- docs/seo/M8_SEARCH_ONLY_SEMANTIC_MASTER_PRE_HANDOFF_2026-09-23_R1.md
- docs/seo/R4_PRE_M7_CURRENT_AUTHORITY_RESCORE_2026-09-23_R1.md
- docs/seo/M6_FINAL_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md

Verify before execution:

```text
M7_SEARCH_SIDE_COLLECTION_FREEZE = PASS
M8_SEMANTIC_MASTER_ALLOWED = true
FREEZE_MANIFEST_BLOB = 3cc09a62aa4ac4bed0af44939a9be63820657219
PRE_HANDOFF_BLOB = 7685fc0af3672e487639cb2666883ec222a1c355
```

Then verify every frozen file used by this task against the exact Git blob SHA stored in the M7 manifest.

If current branch HEAD advanced only because M7/M8 handoff/progress files were added while all frozen input blobs remain identical:

`AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED`

If any frozen product/method/semantic evidence blob changed:

`VERDICT = HOLD_AUTHORITY_DRIFT`

and stop.

======================================================================
1. EXECUTION BOUNDARY — NO PROVIDER / NO WEB / NO GITHUB WRITES
======================================================================

This is full-volume local/repository analysis only.

Forbidden:

```text
WORDSTAT_EXECUTION
YANDEX_SEARCH_EXECUTION
ALICE_EXECUTION
GENSEARCH_EXECUTION
WEB_ACQUISITION
NEW LIVE SITE CRAWL
GITHUB_WRITES
```

Required:

```text
PROVIDER_CALLS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES = 0
```

Do not emit any executable Bridge command.

======================================================================
2. FROZEN INPUT ACCESS CLASSES ARE BINDING
======================================================================

The M7 machine manifest assigns every frozen file one `w1_access` class.

Interpret exactly:

### allowed
May directly feed Search semantic identity, relevance, task, intent and priority.

### context_only
May constrain interpretation or explain accepted decisions.
Must not create new query truth by itself.

### audit_fallback
May be read only for provenance recovery, discrepancy resolution, source verification and known-failure regression.
Must not be counted as a second independent occurrence universe.

### method_only
Defines execution and QA method only.

### prohibited_semantic_input
Must not be used for Search relevance/intent/priority decisions.

### prohibited_direct_use
Must not be parsed/used directly; use accepted recovery authority instead.

Hard requirement:

```text
PROHIBITED_INPUT_USED = 0
```

======================================================================
3. PRIMARY RAW OCCURRENCE UNIVERSE — EXACTLY 25,229
======================================================================

Build one complete raw occurrence ledger from exactly these four primary layers:

### A. M2R Wordstat lineage

`docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv`

Required rows:
`1123`

Required Git blob:
`9343048ed82f129b3f7433c46899e6f255a420a8`

### B. M4Q R2 query universe

`docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/M4Q_R2_QUERY_UNIVERSE_LEDGER_R2.tsv`

Required rows:
`15542`

Required Git blob:
`23b1a272ddfae3bf03d2b4a57525a773ace7fdac`

### C. M4C competitor candidate register

`docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COMPETITOR_CANDIDATE_REGISTER.tsv`

Required rows:
`8431`

Required Git blob:
`93debb9c20c2f6df6d146e018e9b5afa96350124`

### D. M4Q targeted candidate delta

`docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv`

Required rows:
`133`

Required Git blob:
`dc9aa037a5da3101c72d4c6460109e4f69d5eea2`

Hard equation:

```text
1123 + 15542 + 8431 + 133 = 25229
```

These are RAW SOURCE OCCURRENCES, not unique queries.

Cross-layer duplicates are expected.

Do not deduplicate before the raw occurrence ledger exists.

Do not add the following to the 25,229 raw-occurrence count:

- M3 SERP result rows;
- M4A SERP occurrences;
- M4Q SERP result rows;
- M6 6106 reconciliation rows;
- M6 provider-result rows;
- M5 hypothesis rows.

Those are evidence/decision overlays.

======================================================================
4. CURRENT PRODUCT / SCOPE AUTHORITY
======================================================================

Use current Product Truth for product/business-fit boundaries.

Important current product truths:

- Octoport is a browser bridge/tool, not its own LLM;
- selected external web AI/LLM works with permitted Ozon/Wildberries data/tools;
- launch scope is read/data retrieval/reports/analysis/explanation/recommendation/preparation;
- launch does not promise business-state mutation;
- external market/niche/competitor intelligence is allowed only where actual accepted marketplace sources support it;
- unsupported capability language remains HOLD or excluded from product-fit, never invented;
- public SEO site is prelaunch/not yet a production SEO site.

Search evidence cannot create product capability.

======================================================================
5. DEMAND AUTHORITY / WORDSTAT CLAIM BOUNDARY
======================================================================

Use M2R lineage as current demand/lexical authority.

Read current M2 retrospective and Main Chat corrections.

Preserve:

- observed provider strings;
- seed lineage;
- result/association/source distinctions;
- empty-response meaning;
- historical B01 wrapper limitation.

Hard boundaries:

```text
WORDSTAT != INTENT
LOW FREQUENCY != EXCLUDE
HIGH FREQUENCY != KEEP
EMPTY RESULT != GLOBAL ZERO DEMAND
```

Do not replay historical Wordstat.

======================================================================
6. ORDINARY SEARCH / M3-M4A OVERLAY
======================================================================

Read allowed/context M3/M4A frozen authorities.

Current facts:

```text
M3_AUTHORITY_QUERIES = 15
M3_PRIMARY_OCCURRENCES = 300
M4A_PAIRWISE_TOP10 = 105/105
M4A_REGISTRY_ROWS = 60
```

Use M3/M4A to enrich:

- exact query authority;
- observed Search intent/result types;
- collision/mixed-intent evidence;
- query-profile evidence;
- URL/domain overlap evidence;
- recurring Search competitor evidence.

Do not turn SERP rank into demand.

Do not treat M4A occurrence rows as raw semantic query occurrences.

======================================================================
7. CURRENT M4Q SEARCH OVERLAY
======================================================================

Use allowed current M4Q files from the freeze manifest.

Especially:

- M4Q_R2_QUERY_UNIVERSE_LEDGER_R2.tsv;
- M4Q_R2_SEARCH_EXECUTION_MANIFEST_R2.tsv;
- M4Q_R2_SERP_RESULT_LEDGER.tsv;
- M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv;
- M4Q_R2_COMPETITOR_VISIBILITY_MATRIX.tsv;
- M4Q_R2_COMPETITOR_VISIBILITY_SUMMARY.tsv;
- M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv;
- M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv;
- accepted M4Q reconciliation files.

Search visibility is evidence of visibility/context, not demand.

The accepted ranking-query source limitation remains active.

Do not infer missing competitor ranking-query recall as zero.

======================================================================
8. CURRENT M4C COMPETITOR SYNTHESIS OVERLAY
======================================================================

Use current allowed M4C layers from the freeze manifest.

Primary semantic-support files:

- M4C_COMPETITOR_CANDIDATE_REGISTER.tsv;
- M4C_HARDENED_COMPETITOR_REGISTRY.tsv;
- M4C_COVERAGE_LEDGER.tsv;
- M4C_M6_DEMAND_GAP_CANDIDATES.tsv;
- M4C_SOURCE_MANIFEST.md;
- M4C_QA.md.

M4C candidate rows are competitor-derived evidence.

Hard boundaries:

```text
COMPETITOR TOPIC != DEMAND
COMPETITOR CLAIM != OCTOPORT PRODUCT FACT
COMPETITOR RECURRENCE != FINAL PAGE DECISION
```

Do not use M4C_M5_AI_HYPOTHESIS_INPUTS.tsv for semantic decisions.

======================================================================
9. M6 OVERLAY — CURRENT GAP / HOLD / PROVIDER RESULTS
======================================================================

Read all allowed M6 frozen authorities.

Key current facts:

```text
M6_PRIMARY_SOURCE_ROWS = 6106
M6_HOLD_AMBIGUOUS = 1676
M6_OWNER_PRODUCT_ROWS = 30
M6_PRODUCT_CAPABILITY_HOLDS = 29
M6_OWNER_PRODUCT_OUT_OF_SCOPE = 1
M6PC004_PROVIDER_INVALID_QUERY_HOLD = 1
SEARCH_HTML_CAPABILITY_HOLDS = 6
SEARCH_USERAGENT_CAPABILITY_HOLDS = 3
M6_REGION_CONTROL_ROWS = 40
```

Current provider outcomes:

```text
M6PC001 = VALID_EMPTY_LITERAL_TOP_RESPONSE
M6PC002 = VALID_EMPTY_LITERAL_TOP_RESPONSE
M6PC003 = VALID_EMPTY_LITERAL_TOP_RESPONSE
M6PC004 = FAILED_TERMINAL / INVALID_QUERY / NONBLOCKING HOLD
M6PC006 = NO_MATERIAL_CHANGE
M6PC008 = ENRICH
UNKNOWN_PROVIDER_OUTCOMES = 0
```

Join M6 decisions to raw source occurrences by exact source IDs/provenance.

Do not convert:

- provider invalid query -> zero demand;
- product capability HOLD -> irrelevant demand;
- source ambiguity HOLD -> EXCLUDED without independent evidence;
- HTML/device capability HOLD -> organic Search invalidity.

======================================================================
10. M5 / AI EXCLUSION — ABSOLUTE
======================================================================

Every freeze row marked prohibited_semantic_input is forbidden for Search semantic decisions.

In particular:

- M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER.tsv;
- M5_INPUT_DISPOSITION_LEDGER.tsv;
- M4C_M5_AI_HYPOTHESIS_INPUTS.tsv;
- M5 source/QA/manifest.

Hard gates:

```text
ALICE_INPUT_ROWS = 0
AI_SOURCE_USED_FOR_SEARCH_RELEVANCE = 0
AI_SOURCE_USED_FOR_SEARCH_INTENT = 0
AI_SOURCE_USED_FOR_PRIORITY = 0
M5_HYPOTHESIS_USED_AS_SEARCH_TRUTH = 0
```

======================================================================
11. NORMALIZATION — CONSERVATIVE ONLY
======================================================================

Automatic exact-safe key:

- Unicode NFC;
- outer trim;
- collapse internal whitespace;
- case-fold/lowercase.

Preserve original raw text.

Do NOT automatically merge by:

- morphology;
- stemming;
- synonymy;
- word-order similarity;
- punctuation deletion that can change meaning;
- marketplace substitution;
- Ozon <-> Wildberries substitution;
- AI/LLM brand substitution;
- Latin/Cyrillic substitution;
- broad thematic similarity.

Exact-safe duplicate is not automatically semantic-equivalent to a broader/narrower phrase.

Uncertain equivalence remains separate or REVIEW_HOLD.

======================================================================
12. SEMANTIC STATES — EXACTLY ONE PRIMARY STATE PER IDENTITY
======================================================================

Allowed:

```text
WORKING
REVIEW_HOLD
EXCLUDED
BRAND_DEFENSE
```

No default WORKING.

Every identity requires a primary reason code and textual basis.

### WORKING
Search-side identity is sufficiently relevant/product-compatible to continue into M9, subject to later clustering.

### REVIEW_HOLD
Material ambiguity/evidence conflict remains; do not force KEEP or EXCLUDE.

### EXCLUDED
Clear non-target/out-of-scope/foreign context under accepted evidence.

### BRAND_DEFENSE
Current Product Truth brand spelling/variant tracked for navigation/defense; not demand-proven unless separate demand evidence exists.

======================================================================
13. BRAND DEFENSE
======================================================================

Create explicit BRAND_DEFENSE identities from current Product Truth brand variants if needed.

They are authority-derived, not demand-derived.

Required fields:

```text
demand_observed = false unless separately evidenced
authority_class = PRODUCT_BRAND_DEFENSE
priority must not inherit demand score from product truth
```

Do not add BRAND_DEFENSE rows to the 25,229 raw occurrence count unless the same text actually appears in a primary occurrence layer.

======================================================================
14. REQUIRED SEMANTIC MASTER FIELDS
======================================================================

At minimum:

- semantic_identity_id
- canonical_display_text
- exact_safe_key
- primary_state
- primary_reason_code
- decision_basis_text
- raw_occurrence_count
- source_layer_count
- source_layers
- source_occurrence_ids
- demand_evidence_state
- demand_evidence_refs
- search_evidence_state
- search_evidence_refs
- competitor_evidence_state
- competitor_evidence_refs
- m6_resolution_state
- product_fit_state
- product_fit_basis
- user_task_job
- intent_primary
- intent_secondary_or_mixed
- commercial_informational_role
- ambiguity_state
- evidence_need
- priority_tier
- priority_basis_text
- redundancy_relation
- canonicality_relation
- preliminary_family_role
- marketplace_tags
- llm_entity_tags
- brand_entity_tags
- unsupported_capability_risk
- hold_reopen_rule
- claim_boundary

Every field must have deterministic representation for empty/not-applicable values.

======================================================================
15. COLLISION / CONTAMINATION CONTROLS
======================================================================

Explicitly test at full volume:

1. buyer/consumer vs seller;
2. card/image/infographic generation vs operational/data assistant;
3. courses/jobs/training vs software/tool;
4. human assistant/manager/agency vs software/AI helper;
5. native marketplace feature/AI vs third-party tool;
6. external market/niche/competitor intelligence vs seller-owned/internal analytics;
7. developer API/docs vs user-facing integration;
8. unsupported mutation/autobid/write-back vs read-only launch promise;
9. accounting/statutory/tax-only vs seller operational analytics;
10. generic AI/agent unrelated to marketplaces;
11. marketplace/entity collisions;
12. brand strings referring to unrelated entities.

Positive product-looking tokens do not override foreign context.

======================================================================
16. PRIORITY
======================================================================

Priority is not frequency sorting.

Use multiple current evidence classes:

- demand evidence;
- Search intent evidence;
- product fit;
- seller task clarity;
- current competition/search surface;
- ambiguity/hold state;
- provenance strength.

Every priority tier requires textual basis.

Do not create final page priority.

======================================================================
17. PRELIMINARY FAMILY ROLE
======================================================================

Family role is preliminary semantic organization only.

Hard boundary:

```text
PRELIMINARY FAMILY != FINAL CLUSTER
PRELIMINARY FAMILY != PAGE
PRELIMINARY FAMILY != IA
```

Do not optimize family count.

Residual/generic families must receive heterogeneity review.

======================================================================
18. REQUIRED OUTPUT 1 — M8_SOURCE_MANIFEST.md
======================================================================

Record:

- WORK_ID;
- START_HEAD;
- END_OBSERVED_HEAD;
- M7 freeze ID/head/blob;
- pre-handoff blob;
- every actual input path + Git blob used;
- access class;
- parser rules;
- primary occurrence counts;
- overlay counts;
- prohibited input checks;
- authority drift classification;
- no-provider/no-web/no-GitHub-write accounting.

======================================================================
19. REQUIRED OUTPUT 2 — M8_RAW_OCCURRENCE_LEDGER.tsv
======================================================================

Exactly `25,229` data rows.

Minimum fields:

- raw_occurrence_id
- source_layer
- source_native_id
- raw_text
- exact_safe_key
- source_status
- source_evidence_refs
- source_registry_or_entity_ref
- original_frequency_or_provider_fields
- original_route_or_disposition
- semantic_identity_id
- lineage_notes

Required source-layer row counts:

```text
M2R = 1123
M4Q_R2_QUERY_UNIVERSE = 15542
M4C_COMPETITOR_CANDIDATE = 8431
M4Q_R2_TARGETED_DELTA = 133
TOTAL = 25229
```

Hard gates:

```text
RAW_OCCURRENCE_ROWS = 25229
UNIQUE_RAW_OCCURRENCE_IDS = 25229
SILENT_SOURCE_LOSS = 0
```

======================================================================
20. REQUIRED OUTPUT 3 — M8_SEMANTIC_IDENTITY_MASTER.tsv
======================================================================

One row per semantic identity.

Use all mandatory fields from section 14.

State accounting must reconcile exactly.

Do not predeclare identity count.

======================================================================
21. REQUIRED OUTPUT 4 — M8_IDENTITY_SOURCE_XREF.tsv
======================================================================

One row per `(semantic_identity_id, raw_occurrence_id)` link.

Hard gates:

```text
EVERY_RAW_OCCURRENCE_LINKED = true
RAW_OCCURRENCE_MULTI_PRIMARY_IDENTITY = 0
EVERY_NON_BRAND_IDENTITY_HAS_RAW_LINEAGE = true
BRAND_DEFENSE_AUTHORITY_LINEAGE_PRESENT = true
```

======================================================================
22. REQUIRED OUTPUT 5 — M8_REASON_CODE_DICTIONARY.md
======================================================================

Define every reason code used.

For each reason code record:

- code;
- allowed state(s);
- definition;
- evidence requirements;
- forbidden inference;
- reopen rule if relevant;
- representative rule example, not a patch target.

No unexplained ad-hoc reason strings.

======================================================================
23. REQUIRED OUTPUT 6 — M8_HOLD_REVIEW_LEDGER.tsv
======================================================================

Include every REVIEW_HOLD identity and every material nonblocking limitation affecting a WORKING identity.

Minimum fields:

- semantic_identity_id
- hold_class
- exact_unknown
- current_evidence
- missing_evidence
- why_not_guess
- blocking_for_m9
- reopen_trigger
- claim_boundary

Do not hide M6 HOLD ancestry.

======================================================================
24. REQUIRED OUTPUT 7 — M8_ADVERSARIAL_DIAGNOSTIC.tsv
======================================================================

This must be independent/adversarial and must not simply replay the production classifier.

At minimum inspect:

- high-frequency EXCLUDED identities;
- low-frequency WORKING identities;
- source-layer disagreement;
- identities with M6 HOLD ancestry but non-HOLD final state;
- seller/buyer collisions;
- human/software collisions;
- external/internal analytics collisions;
- unsupported capability collisions;
- brand/entity collisions;
- exact-safe duplicate inconsistencies;
- sibling identities with materially different states;
- state/reason outliers;
- identities where one evidence class dominates against contradictory evidence.

Minimum fields:

- diagnostic_id
- semantic_identity_id
- diagnostic_class
- observed_conflict
- expected_review
- final_resolution
- changed_by_diagnostic
- sibling_impact_checked
- notes

If a mechanism defect is found:

```text
FIX MECHANISM
-> RERUN COMPLETE AFFECTED UNIVERSE
-> REPORT SIBLING CHANGES
```

Do not patch only examples.

======================================================================
25. REQUIRED OUTPUT 8 — M8_QA.md
======================================================================

At minimum:

```text
FROZEN_MANIFEST_BLOB_MATCH =
FROZEN_INPUT_HEAD =
AUTHORITY_DRIFT_STATUS =

M2R_OCCURRENCES = 1123/1123
M4Q_QUERY_UNIVERSE_OCCURRENCES = 15542/15542
M4C_CANDIDATE_OCCURRENCES = 8431/8431
TARGETED_DELTA_OCCURRENCES = 133/133
RAW_OCCURRENCE_ROWS = 25229/25229
SILENT_SOURCE_LOSS = 0
DUPLICATE_RAW_OCCURRENCE_ID = 0

SEMANTIC_IDENTITY_ROWS =
WORKING =
REVIEW_HOLD =
EXCLUDED =
BRAND_DEFENSE =
STATE_SUM_EQUALS_IDENTITY_ROWS = true

XREF_ROWS =
UNLINKED_RAW_OCCURRENCES = 0
NON_BRAND_IDENTITIES_WITHOUT_LINEAGE = 0

EVERY_IDENTITY_HAS_STATE_REASON = true
DEFAULT_KEEP = 0
UNCERTAINTY_EXPLICIT = true
REASON_CODES_ALL_DEFINED = true

M6_HOLD_ANCESTRY_ACCOUNTED = true
PRODUCT_CAPABILITY_HOLD_ESCALATED_WITHOUT_AUTHORITY = 0
PROVIDER_FAILURE_AS_ZERO_DEMAND = 0
SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_TOPIC_AS_DEMAND = 0

ALICE_INPUT_ROWS = 0
AI_SOURCE_USED_FOR_SEARCH_RELEVANCE = 0
AI_SOURCE_USED_FOR_SEARCH_INTENT = 0
AI_SOURCE_USED_FOR_PRIORITY = 0
M5_HYPOTHESIS_USED_AS_SEARCH_TRUTH = 0

FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0

INDEPENDENT_SEMANTIC_QA = PASS
OPEN_CRITICAL_DEFECTS = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES = 0
```

Also provide:

- state/reason distribution;
- source-layer -> state matrix;
- marketplace-tag distribution;
- intent-role distribution;
- top material HOLD classes;
- adversarial diagnostic row count;
- number of identities changed after adversarial QA;
- sibling-change accounting where mechanism fixes occurred.

======================================================================
26. REQUIRED OUTPUT 9 — M8_RETURN_MANIFEST.json
======================================================================

Record exact UTF-8 byte length, SHA-256 and row counts for the eight non-self outputs.

Use established self-hash exclusion policy.

======================================================================
27. MANDATORY KNOWN-FAILURE REGRESSIONS
======================================================================

Explicitly prove:

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

======================================================================
28. STOP CONDITIONS
======================================================================

Stop with:

`HOLD_AUTHORITY_DRIFT`

if frozen governing/input blobs changed.

Stop with:

`PARTIAL_REWORK_REQUIRED`

if 25,229/25,229 raw occurrences cannot be accounted.

Stop with:

`HOLD_SEMANTIC_CONTRACT_DEFECT`

if a material evidence class cannot be represented without changing permanent methodology.

Row-level REVIEW_HOLD is valid and expected.

======================================================================
29. BEFORE RETURN
======================================================================

Re-fetch live remote branch.

Record END_OBSERVED_HEAD.

If remote changed only through M7/M8 handoff/progress docs and frozen blobs remain identical:

`AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED`

Work must not write to GitHub.

======================================================================
30. PUBLICATION
======================================================================

Create exactly ONE downloadable ZIP containing exactly these nine final files:

1. M8_SOURCE_MANIFEST.md
2. M8_RAW_OCCURRENCE_LEDGER.tsv
3. M8_SEMANTIC_IDENTITY_MASTER.tsv
4. M8_IDENTITY_SOURCE_XREF.tsv
5. M8_REASON_CODE_DICTIONARY.md
6. M8_HOLD_REVIEW_LEDGER.tsv
7. M8_ADVERSARIAL_DIAGNOSTIC.tsv
8. M8_QA.md
9. M8_RETURN_MANIFEST.json

Do not put temporary files, scripts, caches or source downloads in the ZIP.

Owner upload staging path:

`docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R1/`

Work does not upload to GitHub.

======================================================================
31. FINAL RESPONSE FORMAT
======================================================================

Return a compact summary containing:

```text
WORK_ID = OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R1
START_HEAD =
END_OBSERVED_HEAD =
AUTHORITY_DRIFT_STATUS =
VERDICT =

M2R_OCCURRENCES = 1123/1123
M4Q_QUERY_UNIVERSE_OCCURRENCES = 15542/15542
M4C_CANDIDATE_OCCURRENCES = 8431/8431
TARGETED_DELTA_OCCURRENCES = 133/133
RAW_OCCURRENCE_ROWS = 25229/25229

SEMANTIC_IDENTITY_ROWS =
WORKING =
REVIEW_HOLD =
EXCLUDED =
BRAND_DEFENSE =

XREF_ROWS =
UNLINKED_RAW_OCCURRENCES =
ADVERSARIAL_DIAGNOSTIC_ROWS =
IDENTITIES_CHANGED_AFTER_ADVERSARIAL_QA =

ALICE_INPUT_ROWS = 0
M5_HYPOTHESIS_USED_AS_SEARCH_TRUTH = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0

OPEN_CRITICAL_DEFECTS =
PROVIDER_CALLS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES = 0

FILES_IN_ZIP = 9
ZIP_SHA256 =
```

Provide one real downloadable ZIP artifact/link.

Do not continue to M9.
