> **SUPERSEDED / DO NOT EXECUTE.** Replaced by M8 R2 two-level preparation after OSEO-F04. This file is retained as history only.

# Octoport SEO — M8 Search-only Semantic Master — Work pre-handoff R1

WORK_ID: `OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R1`
ROADMAP_STAGE: `M8 / W1`
Status: **PRE-HANDOFF FROZEN / WORK REQUIRED / NO PROVIDER EXECUTION**
Current preparation HEAD: `91f446706c7490bfe7e63ddac12dd3bf3cc422c2`

## 1. Why Work is required

Full-volume Search semantic master requires cross-source occurrence preservation, conservative identity formation, many-to-many lineage, nuanced row decisions, reason-code accounting and independent adversarial QA.

Ordinary chat fallback by sampling/first-N/truncation is forbidden.

## 2. Frozen input authority

Canonical M7 authority:
- `docs/seo/M7_SEARCH_SIDE_COLLECTION_FREEZE_2026-09-23_R1.md`
- `docs/seo/M7_SEARCH_SIDE_FREEZE_MANIFEST_2026-09-23_R1.json`

Frozen input HEAD:
`3b71060bf529c67c7f3578ca6bfb268407e72b0b`

Freeze manifest blob:
`3cc09a62aa4ac4bed0af44939a9be63820657219`

Work must use the exact frozen blob identities in the manifest.

## 3. Primary raw semantic occurrence layers

Exactly four primary occurrence layers feed the raw occurrence union:

```text
M2R_PHRASE_LINEAGE_LEDGER = 1123
M4Q_R2_QUERY_UNIVERSE = 15542
M4C_COMPETITOR_CANDIDATE_REGISTER = 8431
M4Q_R2_TARGETED_CANDIDATE_DELTA = 133

EXPECTED_RAW_SOURCE_OCCURRENCES = 25229
```

These are source occurrences, not unique semantic identities.
Cross-layer duplicates are expected and must remain recoverable.

Do not add M3 SERP result rows, M4A SERP occurrences, M6 reconciliation rows, provider result rows or M5 hypotheses to the 25,229 occurrence count. Those are evidence/decision overlays.

## 4. Overlay authorities

Work must join current overlays where applicable:
- Product Truth / M0 / M1 constraints;
- M3 exact query authority;
- M4A 300-row Search evidence, query profiles, collision ledger and 105-pair overlap;
- M4Q current visibility/result evidence;
- M6 6106-row reconciliation, gap register, provider outcomes, product-fact overlay and regional control outcomes.

Overlays enrich/limit semantic decisions but do not duplicate primary occurrences.

## 5. Prohibited inputs

Strictly prohibited for Search semantic relevance/intent/priority:
- every freeze-manifest row with `w1_access = prohibited_semantic_input`;
- M5 AI diagnostic hypothesis register and M5 input disposition ledger;
- any Alice / GenSearch / AI-search evidence;
- malformed historical S03 transport marked `prohibited_direct_use`;
- chat memory as evidence;
- external web research not explicitly frozen;
- new provider calls.

```text
ALICE_INPUT_ROWS = 0
AI_SOURCE_USED_FOR_SEARCH_RELEVANCE = 0
AI_SOURCE_USED_FOR_SEARCH_INTENT = 0
AI_SOURCE_USED_FOR_PRIORITY = 0
```

## 6. Semantic identity contract

Create stable semantic identities conservatively.

Automatic exact-safe normalization may use only:
- Unicode NFC;
- outer trim;
- collapse internal whitespace;
- case-fold/lowercase.

Do not silently merge by:
- morphology;
- stemming;
- synonymy;
- marketplace substitution;
- LLM substitution;
- punctuation removal that changes meaning;
- Latin/Cyrillic brand substitution;
- broad topic similarity.

Semantic relations may be recorded as relations, but uncertain equivalence must remain separate/HOLD.

## 7. Required semantic states

Every semantic identity gets exactly one primary state:

```text
WORKING
REVIEW_HOLD
EXCLUDED
BRAND_DEFENSE
```

No default WORKING.

Brand-defense identities may be created from current Product Truth brand variants even when not demand-observed, but must be marked:
`demand_observed = false`, `authority_class = PRODUCT_BRAND_DEFENSE`, and must never inflate demand counts.

## 8. Required row-level fields

At minimum the semantic identity master must contain:
- semantic_identity_id;
- canonical_display_text;
- exact_safe_key;
- primary_state;
- primary_reason_code;
- decision_basis_text;
- raw_occurrence_count;
- source_layer_count;
- source_layers;
- source_occurrence_ids;
- demand_evidence_state;
- demand_evidence_refs;
- search_evidence_state;
- search_evidence_refs;
- competitor_evidence_state;
- competitor_evidence_refs;
- m6_resolution_state;
- product_fit_state;
- product_fit_basis;
- user_task_job;
- intent_primary;
- intent_secondary_or_mixed;
- commercial_informational_role;
- ambiguity_state;
- evidence_need;
- priority_tier;
- priority_basis_text;
- redundancy_relation;
- canonicality_relation;
- preliminary_family_role;
- marketplace_tags;
- llm_entity_tags;
- brand_entity_tags;
- unsupported_capability_risk;
- hold_reopen_rule;
- claim_boundary.

Every identity must have a state and reason.

## 9. Critical semantic collision controls

At minimum independently test:
- buyer/consumer intent vs seller intent;
- product card/image/infographic generation vs operational/data assistant;
- courses/jobs/training vs software/tool;
- human assistant/manager/agency vs software/AI helper;
- native marketplace AI/features vs third-party product;
- external market/niche/competitor intelligence vs seller-owned/internal analytics;
- developer API/docs intent vs user-facing integration;
- unsupported mutation/automation vs current read-only launch truth;
- accounting/statutory/tax-only intent vs seller operational analytics;
- generic AI/agent meanings unrelated to marketplaces;
- marketplace name collisions / foreign platform intent;
- brand/reference strings that look product-relevant but refer to unrelated entities.

Positive tokens such as `ИИ`, `Ozon`, `Wildberries`, `аналитика`, `селлер` do not override foreign context.

## 10. Frequency / rank boundaries

```text
LOW FREQUENCY != EXCLUDE
HIGH FREQUENCY != KEEP
SEARCH VISIBILITY != DEMAND
COMPETITOR TOPIC != DEMAND
SERP RANK != PRODUCT FIT
```

Priority must use multiple evidence classes and textual basis.

## 11. M6 HOLD propagation

Current explicit M6 holds must survive unless the same frozen Search-side evidence already resolves them without inventing facts.

Important classes:
- 1676 source-identity ambiguous rows;
- 29 product-capability holds;
- M6PC004 provider-invalid-query hold;
- six HTML capability holds;
- three explicit userAgent/device holds.

Do not convert a technical/provider/capability HOLD to negative demand or EXCLUDED unless another accepted evidence class independently supports exclusion.

## 12. Required output files — exactly 9

1. `M8_SOURCE_MANIFEST.md`
2. `M8_RAW_OCCURRENCE_LEDGER.tsv`
3. `M8_SEMANTIC_IDENTITY_MASTER.tsv`
4. `M8_IDENTITY_SOURCE_XREF.tsv`
5. `M8_REASON_CODE_DICTIONARY.md`
6. `M8_HOLD_REVIEW_LEDGER.tsv`
7. `M8_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M8_QA.md`
9. `M8_RETURN_MANIFEST.json`

## 13. Output 1 — source manifest

Record:
- START_HEAD and END_OBSERVED_HEAD;
- M7 freeze identity/blob;
- every actual input path/blob used;
- parser rules;
- occurrence-layer row counts;
- overlays used;
- prohibited inputs verified absent;
- authority drift classification.

## 14. Output 2 — raw occurrence ledger

Exactly `25,229` data rows.

Minimum fields:
- raw_occurrence_id;
- source_layer;
- source_native_id;
- raw_text;
- exact_safe_key;
- source_status;
- source_evidence_refs;
- source_registry_or_entity_ref;
- original_frequency_or_provider_fields where present;
- original_route_or_disposition where present;
- semantic_identity_id;
- lineage_notes.

Hard gate:
```text
RAW_OCCURRENCE_ROWS = 25229/25229
SILENT_SOURCE_LOSS = 0
DUPLICATE_RAW_OCCURRENCE_ID = 0
```

## 15. Output 3 — semantic identity master

One row per deduplicated semantic identity.

All mandatory M8 fields from section 8 are required.

State accounting must reconcile exactly to total identity rows.

## 16. Output 4 — identity/source xref

Preserve full many-to-many lineage.

One row per `(semantic_identity_id, raw_occurrence_id)` link.

Hard gates:
- every raw occurrence links to exactly one primary semantic identity;
- every semantic identity has at least one lineage source unless it is explicit PRODUCT_BRAND_DEFENSE;
- brand-defense no-demand rows must identify Product Truth authority.

## 17. Output 5 — reason-code dictionary

Define every reason code used in the master.

For each reason:
- code;
- allowed states;
- definition;
- evidence requirements;
- forbidden inference;
- reopen rule where relevant.

No ad-hoc unexplained reason strings.

## 18. Output 6 — HOLD/REVIEW ledger

Include every `REVIEW_HOLD` identity and any material nonblocking limitation affecting WORKING identities.

Minimum fields:
- semantic_identity_id;
- hold_class;
- exact_unknown;
- current_evidence;
- missing_evidence;
- why_not_guess;
- blocking_for_m9;
- reopen_trigger;
- claim_boundary.

## 19. Output 7 — independent adversarial diagnostic

This must not simply replay the production classification rule.

Build independent diagnostics over the completed master, including:
- high-frequency EXCLUDED rows;
- low-frequency WORKING rows;
- rows with source-layer disagreement;
- rows promoted despite M6 HOLD ancestry;
- seller/buyer collision probes;
- human/software collision probes;
- external/internal analytics collision probes;
- unsupported capability probes;
- brand/entity collision probes;
- exact-safe duplicate inconsistencies;
- sibling rows with materially different states;
- state/reason outliers.

Every flagged row gets:
- diagnostic_id;
- semantic_identity_id;
- diagnostic_class;
- observed_conflict;
- expected_review;
- final_resolution;
- changed_by_diagnostic true/false;
- sibling_impact_checked.

If the diagnostic reveals a mechanism defect:
`FIX MECHANISM -> RERUN COMPLETE AFFECTED UNIVERSE -> REPORT SIBLING CHANGES`.

Do not patch only the flagged examples.

## 20. Output 8 — QA

At minimum report:

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
STATE_SUM = SEMANTIC_IDENTITY_ROWS

XREF_ROWS =
UNLINKED_RAW_OCCURRENCES = 0
IDENTITIES_WITHOUT_LINEAGE = 0 except explicit BRAND_DEFENSE

EVERY_IDENTITY_HAS_STATE_REASON = true
DEFAULT_KEEP = 0
UNCERTAINTY_EXPLICIT = true
REASON_CODES_ALL_DEFINED = true

M6_HOLD_ANCESTRY_ACCOUNTED = true
PRODUCT_CAPABILITY_HOLD_ESCALATED_WITHOUT_AUTHORITY = 0
PROVIDER_FAILURE_AS_ZERO_DEMAND = 0

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

## 21. Output 9 — return manifest

Record exact UTF-8 bytes, SHA-256 and row counts for eight non-self outputs.
Use self-hash exclusion for the manifest itself.

## 22. Stop conditions

`HOLD_AUTHORITY_DRIFT` if any governing/frozen authority blob changed or a prohibited input became necessary.

`PARTIAL_REWORK_REQUIRED` if 25,229/25,229 raw occurrences cannot be accounted.

`HOLD_SEMANTIC_CONTRACT_DEFECT` if the required states/fields cannot represent a material class without changing methodology.

Do not invent a new permanent method inside Work.

## 23. Before return

Re-fetch live remote branch and record END_OBSERVED_HEAD.

If the branch advanced only by M7/M8 handoff/state files while all frozen input blob SHAs remain identical, classify:
`AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED`.

If any frozen semantic/product/method input changed, stop with HOLD_AUTHORITY_DRIFT.

## 24. Publication policy

Work must not write to GitHub.

Create exactly one downloadable ZIP containing exactly the nine final files.

Owner will upload all nine unpacked files together in one GitHub UI action to:

`docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R1/`

Main Chat will remote-readback and independently accept/reject.

## 25. Downstream boundary

Do not continue to M9 clustering.

Do not create final page architecture.

Do not use Alice/AI evidence.

Final response must provide one real downloadable ZIP and the compact execution summary required by the canonical Work prompt.
