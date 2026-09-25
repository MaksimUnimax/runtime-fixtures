# Octoport SEO — M10D Search-vs-AI reconciliation — STEP PREPARATION — 2026-09-25 R1

Status: **PREPARATION COMPLETE / WORK REQUIRED / NO PROVIDER EXECUTION**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation parent HEAD: `25c01635dc945807b59ac710ac2ca856b0f83803`

## 1. Roadmap cursor

```text
M0..M9 = ACCEPTED
M10A = ACCEPTED / FROZEN SEARCH-ONLY PAGE-IA BASELINE
M10B = ACCEPTED / 15 FINAL AI DIAGNOSTIC CASES
M10C = ACCEPTED / 15 CASES TERMINAL / PROVIDER ACQUISITION CLOSED
M10D = CURRENT PREPARATION
M11+ = BLOCKED
```

M10D purpose:
for every accepted M10B case, compare the immutable M10A Search-only baseline to the complete accepted M10C AI-search evidence and classify exactly one causal effect:
`CHANGE | ENRICH | DE_RISK | NO_CHANGE | HOLD`.

M10D does not acquire new evidence and does not assign final page ownership.

## 2. Mandatory authorities read

LEVEL 1:
- `docs/seo/LEVEL1/README.md` blob `4c3a30644ac736b926ec82bba6b1a6e33434ac06`
- `docs/seo/EXECUTION_RULES.md` blob `4e999af4826d6f72fd15f481a698f674c8ed2d5c`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md` blob `9917a52b837bcb8ae50eb63cc53e7becd1671b39`
- `docs/seo/WORK_HANDOFF_RULE.md` blob `71a031e74b921dade5998beb842fb3afcc4478e7`
- `docs/seo/METHODOLOGY.md` blob `6a85c53ec7994e3f68636dccc49c71d5be95d5ae`
- `docs/seo/PRODUCT_TRUTH.md` blob `6a469d5743142d3e476afa5d2cda653fd411ecb8`

LEVEL 2:
- `docs/seo/LEVEL2/README.md` blob `4c9427619d35dcc0bfa62385b48e9278cdaaff0a`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md` blob `2438ed88a5d129b41dca88d2f87a22bc4b3515cd`
- `docs/seo/LEVEL2/M5_M10_SEARCH_ONLY_AND_ALICE_SEQUENCE_RULES.md` blob `2c63e4228f9cc6f2d26555fcb02d445baafb1000`
- `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md` blob `2f87943fbe9037c58276d2dd3a805d070bd070a4`

Failure history:
- `docs/seo/FAILURE_LEDGER.md` blob `2527cb7adb10a57795f0b80f16660b4475f6e825`

## 3. Accepted upstream authorities

M10A acceptance:
- `docs/seo/M10A_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`
- blob `a0cc44f9631067f4938044fe0a4c21e6ed4898cb`

M10A data:
- cluster baseline: blob `81a385400dffce94441525938ac4916d4db95cc2`, 104 rows / 24 columns
- material boundary baseline: blob `aafa9698cc1cc83751699ac45048b53d5505f96b`, 1,399 rows / 20 columns / 1,557,644 UTF-8 bytes
- existing site surface: blob `b1805310f77263a8734260fafb00ef0c5025d44a`, 4 rows

Important readback note:
the GitHub connector may render the 1.56 MB boundary TSV as empty. Direct Git object verification at the current remote branch proves 1,557,644 bytes / 1,400 lines with the expected header. Work must read the actual Git file from checkout, not connector-rendered empty content.

M10B acceptance:
- `docs/seo/M10B_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`
- blob `e35c5a8b58e3e9e34c375938a7593ffa6deb85b6`

M10B data:
- final cases: blob `c0ff9b679387ff737f6e5f013286383bb7814169`, 15 rows / 26 columns
- case-cluster XREF: blob `8c2dff5e5686ba88b37b3c32fe1ce0339c05c1ab`, 184 rows / 12 columns
- case-boundary XREF: blob `613873b6c6499425ed3570a43927c6e283900602`, 166 rows / 10 columns / 155 unique pair IDs
- hypothesis disposition: blob `bc66e4d1c525a1fa83637f50327ba859133a5318`

M10C acceptance:
- `docs/seo/M10C_MAIN_CHAT_ACCEPTANCE_2026-09-25_R1.md`
- blob `179dd999133fba7eeeaad83e3d72876c79dcda90`

M10C accepted evidence manifest:
- `docs/seo/M10C_ACCEPTED_EVIDENCE_MANIFEST_2026-09-25_R1.json`
- blob `5a07366b653b7c0db6b49a791dfe739e900724f8`
- 27 raw `SEARCH_RESULT_V1` files
- 15 terminal case closures
- 27 unique request IDs
- provider failures = 0
- estimated provider cost = 137.16 RUB

## 4. Fresh external method check — 2026-09-25

Official Yandex sources checked:
- https://yandex.ru/support/webmaster/en/alice
- https://yandex.ru/support/webmaster/ru/service/alice-answers
- https://yandex.ru/support/search/ru/alice
- https://aistudio.yandex.ru/en/docs/search-api/concepts/generative-response

Supported project method facts:
- AI search compiles answers from source pages and cites sources;
- source/answer composition can vary for the same query over time;
- AI answers can contain inaccuracies;
- indexed Search pages remain the source substrate;
- therefore AI output is an observation layer, not demand/product truth.

Project consequence:
`M10A frozen Search baseline -> M10C AI evidence -> causal M10D delta`.
No reverse contamination of M10A is allowed.

## 5. Work trigger

`WORK_TRIGGER_DECISION = WORK_REQUIRED`.

Reason:
complete reconciliation requires full-volume joins across:
- 15 cases;
- 27 raw AI snapshots;
- 15 terminal evidence states;
- 184 case→cluster links;
- 166 case→boundary links;
- 104 M10A clusters;
- 1,399 M10A material boundaries;
- 63 cluster targets touched by >=2 cases;
- 11 boundary targets touched by >=2 cases.

Ordinary-chat processing would materially risk skipped rows, inconsistent cross-case synthesis, and lost lineage.

No sampling, first-N, or representative subset is allowed.

## 6. M10D outcome rule

Every one of 15 cases receives exactly one and only one:
```text
CHANGE
ENRICH
DE_RISK
NO_CHANGE
HOLD
```

Operational definitions:

`HOLD`:
accepted AI evidence remains materially conflicting, insufficient, or ambiguous such that no safe causal effect on the frozen M10A decision can be stated.

`CHANGE`:
accepted AI evidence directly contradicts or invalidates a specific frozen M10A interpretation/boundary such that M11 must reconsider that decision. M10D still does not assign the final owner/page.

`DE_RISK`:
accepted AI evidence consistently narrows a named M10A HOLD or materially distinguishes a boundary, but does not itself authorize final page ownership.

`ENRICH`:
accepted AI evidence adds useful task/source/capability context for M11 without materially narrowing or reversing the frozen baseline HOLD.

`NO_CHANGE`:
accepted AI evidence produces no causally relevant decision delta beyond the frozen Search-only baseline.

Precedence when evaluating one case:
```text
unsafe/insufficient/conflicted -> HOLD
else direct contradiction requiring reconsideration -> CHANGE
else material uncertainty narrowed -> DE_RISK
else useful non-decisive context -> ENRICH
else -> NO_CHANGE
```

Do not force diversity across outcomes. All cases may legitimately land in the same class if evidence supports it.

## 7. Required outputs — exactly 9

1. `M10D_SOURCE_MANIFEST.md`
2. `M10D_CASE_EVIDENCE_SUMMARY.tsv`
3. `M10D_CASE_RECONCILIATION.tsv`
4. `M10D_CLUSTER_DELTA_XREF.tsv`
5. `M10D_BOUNDARY_DELTA_XREF.tsv`
6. `M10D_CROSS_CASE_RECONCILIATION.tsv`
7. `M10D_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M10D_QA.md`
9. `M10D_RETURN_MANIFEST.json`

## 8. Exact row accounting

```text
CASE_EVIDENCE_SUMMARY_ROWS = 15
CASE_RECONCILIATION_ROWS = 15
CLUSTER_DELTA_XREF_ROWS = 184
BOUNDARY_DELTA_XREF_ROWS = 166
BOUNDARY_DELTA_UNIQUE_PAIR_IDS = 155
CROSS_CASE_RECONCILIATION_ROWS = 74
  SHARED_CLUSTER_TARGETS = 63
  SHARED_BOUNDARY_TARGETS = 11
RAW_M10C_SNAPSHOTS_ACCOUNTED = 27/27
TERMINAL_M10C_CASES_ACCOUNTED = 15/15
```

No silent skip. No dedupe of XREF rows.

## 9. Required schemas

### M10D_CASE_EVIDENCE_SUMMARY.tsv — 15 rows

Required columns:
```text
case_id
source_m5_hypothesis_ids
exact_ai_prompt
marketplace_scope
task_or_intent_scope
snapshot_count
request_ids
m10c_terminal_evidence_state
source_role_summary
official_marketplace_source_state
byo_llm_signal_state
autonomous_write_signal_state
report_accounting_signal_state
variability_summary
evidence_quality_state
raw_evidence_refs
terminal_closure_ref
claim_boundary
```

### M10D_CASE_RECONCILIATION.tsv — 15 rows

Required columns:
```text
case_id
primary_cluster_id
frozen_m10a_owner_state
frozen_m10a_page_role_state
frozen_m10a_boundary_context
frozen_uncertainty
m10c_terminal_evidence_state
m10d_outcome
causal_delta_summary
causal_strength
affected_decision_dimensions
affected_cluster_ids
affected_boundary_pair_ids
m11_implication
evidence_refs
claim_boundary
```

Closed `causal_strength`:
`DIRECT | SUPPORTING | NONE | CONFLICTED`.

Closed `m11_implication`:
`REOPEN_FOR_M11_CAUSAL_DELTA | NARROW_HOLD_FOR_M11 | ADD_CONTEXT_ONLY | PRESERVE_M10A_BASELINE | HOLD_FOR_M11`.

Required mapping:
- CHANGE -> REOPEN_FOR_M11_CAUSAL_DELTA
- DE_RISK -> NARROW_HOLD_FOR_M11
- ENRICH -> ADD_CONTEXT_ONLY
- NO_CHANGE -> PRESERVE_M10A_BASELINE
- HOLD -> HOLD_FOR_M11

### M10D_CLUSTER_DELTA_XREF.tsv — 184 rows

Preserve every M10B case→cluster XREF row one-to-one and append:
```text
m10d_case_outcome
cluster_effect_class
causal_rationale
m11_constraint
evidence_refs
```

Closed `cluster_effect_class`:
`REOPEN | NARROW_HOLD | ENRICH_ONLY | PRESERVE | HOLD`.

### M10D_BOUNDARY_DELTA_XREF.tsv — 166 rows

Preserve every M10B case→boundary XREF row one-to-one and append:
```text
m10d_case_outcome
boundary_effect_class
causal_rationale
m11_constraint
evidence_refs
```

Closed `boundary_effect_class`:
`REOPEN | NARROW_HOLD | ENRICH_ONLY | PRESERVE | HOLD`.

### M10D_CROSS_CASE_RECONCILIATION.tsv — 74 rows

Exactly one row for every target touched by >=2 cases.

Required columns:
```text
target_type
target_id
case_ids
case_count
case_outcomes
effect_classes
cross_case_state
synthesis
m11_constraint
evidence_refs
```

`target_type = CLUSTER | BOUNDARY`.

Closed `cross_case_state`:
`CONSISTENT | COMPLEMENTARY | MATERIAL_CONFLICT | HOLD`.

All 63 shared clusters + 11 shared boundaries must be present exactly once.

## 10. Causal discipline

For every case:
```text
FROZEN M10A BASELINE
-> ACCEPTED M10C EVIDENCE
-> EXPLICIT CAUSAL DELTA OR NO DELTA
-> M11 IMPLICATION CONSTRAINT
```

Forbidden shortcuts:
- AI answer text -> demand;
- cited third-party claim -> official marketplace truth;
- source presence -> page creation;
- AI framing -> final owner;
- one case -> automatic change to every linked cluster/boundary;
- semantic similarity -> merge;
- repeated source -> authority truth;
- official source absence -> negative market fact.

## 11. Hard prohibitions

```text
M10A_MUTATIONS = 0
M10B_MUTATIONS = 0
M10C_RAW_MUTATIONS = 0
M10C_TERMINAL_CLOSURE_MUTATIONS = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
SITE_MUTATIONS = 0
FINAL_PAGE_OWNER_ASSIGNMENTS = 0
FINAL_KEEP_OPTIMIZE_CREATE_ROUTE_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0
M11_EXECUTION = 0
```

## 12. QA / adversarial requirements

Must prove:
- 15/15 exact case IDs accounted once;
- every case outcome belongs to closed vocabulary;
- 27/27 raw snapshots linked to exactly their accepted cases;
- 184/184 cluster XREF rows preserved;
- 166/166 boundary XREF rows preserved;
- 155 unique boundary pair IDs preserved;
- 74/74 shared targets reconciled;
- cross-case material conflicts cannot be silently collapsed;
- M10A frozen fields match upstream exactly;
- M10C terminal state used must match closure file;
- NO_CHANGE is allowed and not treated as failure;
- HOLD is allowed and not force-resolved;
- no final M11 architecture leakage;
- no fake CREATE;
- no product-truth conflict;
- no third-party provider claim promoted to official truth;
- no unsupported consumer-Alice equivalence;
- no new provider/web evidence;
- source manifests/hashes/row counts pass.

## 13. Stop / HOLD conditions

Stop with no analytical output claim if:
- any binding input blob mismatches;
- M10A large boundary file cannot be read from Git checkout;
- case ID set is not exact 15/15;
- raw evidence manifest does not account 27/27;
- M10B XREF counts drift;
- frozen M10A fields drift;
- governing rules changed materially after Work start.

Row-level uncertainty must use M10D `HOLD`, not an invented resolution.

## 14. Publication

Work writes no GitHub commits.

Staging path after owner relay:
`docs/seo/work_return/M10D_SEARCH_VS_AI_RECONCILIATION_2026-09-25_R1/`

Work returns exactly the nine final files above, packaged into one ZIP for owner download.

Main Chat independently remote-readbacks and accepts/rejects before M11 can open.
