# M9BR R1 pre-acquisition reconciliation QA

WORK_ID = OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1  
START_HEAD = 3903b57bf9bd64b2b06e79d74f30cd936c5dceb7  
END_OBSERVED_HEAD = 3903b57bf9bd64b2b06e79d74f30cd936c5dceb7  
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED  
VERDICT = PASS_PREACQ_PLANNING_ONLY

LEVEL1_READ = PASS  
LEVEL2_READ = PASS  
ROADMAP_CURRENT_STATE_READ = PASS  
FAILURE_HISTORY_READ = PASS  
FRESH_METHOD_RESEARCH_AUTHORITY_READ = PASS (frozen step preparation; Work web calls = 0)  
M9BR_STEP_PREPARATION_BLOB_MATCH = true  
M9BR_PRE_HANDOFF_BLOB_MATCH = true  
M9BR_INPUT_MANIFEST_BLOB_MATCH = true  
CANONICAL_DIRECT_INPUT_IDENTITIES = 14/14  
DIRECT_TSV_PHYSICAL_WIDTH_PASS = 7/7

M9_ACCEPTANCE = PASS_WITH_HOLD_BOUNDARIES  
M9_ELIGIBLE = 104/104  
EXISTING_SEARCH_ANCHORS = 22/22  
MISSING_CURRENT_SEARCH = 82/82  
M9_PAIRWISE_ROWS = 5356/5356  
M9_HOLD_BOUNDARY = 1518/1518  
IDENTITY_DISPOSITION_ROWS = 104/104  
BOUNDARY_IMPACT_ROWS = 82/82  
MATERIAL_HOLD_RECOMPUTED = 1424/1424  
MATERIAL_HOLD_LEDGER_EXACT_PAIR_JOIN = 1424/1424  
MATERIAL_HOLD_ANCHOR_ANCHOR = 47/47  
MATERIAL_HOLD_ANCHOR_MISSING = 371/371  
MATERIAL_HOLD_MISSING_MISSING = 1006/1006  
ONE_CURRENT_SERP_HOLD_RECOMPUTED = 396/396  
MISSING_IDENTITIES_WITH_ONE_SERP_HOLD = 82/82  
H_ONE_SERP_INSUFFICIENT = 150/150  
MISSING_IDENTITIES_WITH_H_ONE_SERP_INSUFFICIENT = 56/56

The material HOLD predicate was reapplied to all 1,518 frozen HOLD pairs: task SAME/COMPATIBLE; intent SAME/COMPATIBLE/AMBIGUOUS; scope/product neither DIFFERENT. Its exact 1,424 pair IDs equal the independent HOLD ledger. The degree vector for every one of the 82 missing identities was independently counted again from pair rows, not from the emitted impact ledger.

## Query form, disposition, and bounded first wave

| Query-form class | Identities |
|---|---:|
| `DEMAND_OR_TESTED_EXACT_QUERY` | 33 |
| `PAGE_TITLE_OR_SOURCE_PHRASE` | 33 |
| `NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND` | 11 |
| `AMBIGUOUS_QUERY_FORM` | 5 |

| Disposition | Identities |
|---|---:|
| `PERSISTENT_HOLD_NO_EXACT_QUERY_PROBE` | 33 |
| `WAVE1_SEARCH_CANDIDATE` | 25 |
| `EXISTING_CURRENT_SEARCH_ANCHOR` | 22 |
| `DEFER_SEARCH_CANDIDATE` | 19 |
| `QUERY_FORM_AMBIGUOUS_HOLD` | 5 |

QUERY_FORM_ROWS = 82/82  
GATED_EXACT_SEARCH_CANDIDATES = 44  
WAVE1_QUERY_COUNT = 25 <= 25  
PROVIDER_RELEASE_PLAN_ROWS = 25/25  
DEFERRED_OR_PERSISTENT_ROWS = 57/(82-25)  
WAVE1_DUPLICATE_SEMANTIC_ID = 0  
WAVE1_DUPLICATE_QUERY_TEXT = 0  
WAVE1_REPHRASED_QUERY = 0  
WAVE1_PROVIDER_LIMIT_VIOLATION = 0  
WAVE1_EXISTING_SEARCH_DUPLICATE = 0  
WAVE1_WITHOUT_NAMED_INFO_GAIN = 0  
PAGE_TITLE_OR_SOURCE_PHRASE_RELEASED = 0  
AMBIGUOUS_QUERY_FORM_RELEASED = 0

All 82 exact canonical strings were counted by Unicode codepoints and whitespace-delimited words against 400/40 limits without truncation. M2R direct/seed lineage supports an exact query-form class only; empty-success and totalCount-only rows do not claim positive demand. Natural no-demand query forms require a self-contained seller task and a named one-sided M9 HOLD. Title-like and ambiguous exact source strings remain unreleased even at high graph degree.

| Deferred/hold reason | Rows |
|---|---:|
| `SOURCE_TITLE_NOT_USER_QUERY` | 33 |
| `WAVE1_CAP_RANK` | 19 |
| `EXACT_QUERY_FORM_UNRESOLVED` | 5 |

WAVE1_MATERIAL_HOLD_COVERAGE = 592/1424 distinct accepted material pair IDs touching a selected identity  
WAVE1_ANCHOR_HOLD_COVERAGE = 135/371 distinct material existing-anchor/missing pair IDs  
WAVE1_ONE_CURRENT_SERP_HOLD_COVERAGE = 135/396 distinct one-sided HOLD pair IDs  
SUPPORTED_MERGE_BLOCKERS_COVERED = 2/3 supported merge edges have an external material HOLD adjacent to at least one selected identity.

The third supported edge is the ChatGPT pairing: its missing outside blockers have integration source-title wording, so their graph degree does not justify releasing those exact strings. The existing-anchor/existing-anchor HOLDs also remain outside this missing-query wave. Coverage counts measure questions to be tested, not resolved pair decisions.

## Independent adversarial QA and regression

ADVERSARIAL_DIAGNOSTIC_ROWS = 14  
INDEPENDENT_PREACQ_QA = PASS  
ROWS_CHANGED_AFTER_QA = 0  
SIBLING_DECISION_CHANGES_AFTER_QA = 0  
OPEN_CRITICAL_DEFECTS = 0

The diagnostic independently checked all 13 frozen failure classes, and recounted all 82 source pair/hold degree vectors separately. It tested high-degree title-like blockers (including those with 60 material HOLDs), empty/totalCount-only seeds, natural queries without demand, exact query equality, duplicate current anchors, deterministic blocker-first ordering, provider bounds, non-WORKING admission, AI contamination and absence of execution. A source-title explanation was refined across all 82 during production and the full 82 were rerun; there were zero class/disposition changes and zero unreviewed sibling changes. This was an explanatory improvement, not a manual one-row fix.

## Hard boundary

PROVIDER_CALLS = 0  
BRIDGE_COMMANDS = 0  
WEB_ACQUISITION = 0  
GITHUB_WRITES = 0  
ALICE_INPUT_ROWS = 0  
M5_HYPOTHESIS_USED = 0  
M10A_PAGE_OWNERSHIP_DECISIONS = 0  
FINAL_URL_H1_TITLE_IA_DECISIONS = 0

This return is **planning authority only**. Main Chat must remote-read back/accept it, recheck current Bridge capability and tariff, issue a separate durable per-query release, and only then consider provider execution. Valid zero is bounded to an exact query/context and leaves HOLD by default; technical/unknown/incomplete has no semantic effect. After a future terminal, persisted and read-back wave, rerun all 5,356 M9 pairs and clusters; no partial patch and no M10A advance here.
