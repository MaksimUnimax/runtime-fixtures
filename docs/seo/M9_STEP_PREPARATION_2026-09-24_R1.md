> **SUPERSEDED FOR EXECUTION / DO NOT RUN.** Replaced by M9 R2 after OSEO-F07. Retained as history only.\n\n# Octoport SEO — M9 Search-only SERP + user-task clustering — STEP PREPARATION R1

Date: 2026-09-24
Status: **PREPARATION COMPLETE / WORK RELEASE NOT YET ISSUED**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
LIVE_HEAD: `48b133943e7c1874e4c89d60b967240164a91f34`

## 1. Two-level authority

LEVEL 1 read/applied:
- `docs/seo/LEVEL1/README.md`
- `docs/seo/EXECUTION_RULES.md`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md`
- `docs/seo/WORK_HANDOFF_RULE.md`
- `docs/seo/METHODOLOGY.md`
- `docs/seo/PRODUCT_TRUTH.md`

LEVEL 2 read/applied:
- `docs/seo/LEVEL2/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md`

Current M8 acceptance/progress and failure history read.

```text
LEVEL1_READ = PASS
APPLICABLE_LEVEL2_READ = PASS
ROADMAP_CURRENT_STATE_READ = PASS
WORK_EVIDENCE_READ = PASS
FAILURE_HISTORY_READ = PASS
```

## 2. Roadmap / current cursor

```text
M0..M7 = accepted current authority
M8 R3 = PASS / ACCEPTED
M9 = CURRENT PREPARATION
M10A = BLOCKED
M10B/C/D = BLOCKED
M11+ = BLOCKED
```

M9 purpose:
decide which accepted Search-side identities can honestly be satisfied by one page, without Alice evidence and without final page ownership.

## 3. Fresh external method research — 2026-09-24

Official / industry sources checked:

1. Yandex Webmaster query selection / clustering:
https://www.yandex.com/support/webmaster/en/service/queries-selection

Supported claim:
Yandex groups search queries by similarity of meaning or user intent.

Project application:
`LEXICAL SIMILARITY != CLUSTER`; task/intent are mandatory.

2. Yandex Webmaster search query monitoring / query-URL statistics:
https://www.yandex.com/support/webmaster/en/service/popular-queries
https://yandex.com/support/webmaster/en/service/statistics

Supported claim:
Search performance is observable by query and by URL; query/page relationships are distinct measurable entities.

Project application:
exact URL behavior is stronger cluster evidence than domain-level coincidence.

3. Ahrefs keyword clustering:
https://ahrefs.com/blog/keyword-clustering/
https://ahrefs.com/blog/secondary-keywords/

Supported industry-method claim:
keywords with same/similar intent are commonly grouped using similarity of ranking URLs / SERP overlap.

Project application:
SERP overlap is a clustering signal, not automatic proof and not demand evidence.

4. Semrush keyword clustering:
https://www.semrush.com/blog/keyword-clustering/
https://www.semrush.com/blog/keyword-manager-clustering-tool/

Supported industry-method claim:
SERP-based clustering compares top organic result URLs; similar URLs support shared intent/page grouping better than lexical similarity alone.

Project application:
capture exact URL overlap metrics but do not impose one universal numeric threshold.

### Research verdict

```text
FRESH_METHOD_RESEARCH = PASS
LEVEL2_CONTRADICTION = false
UNIVERSAL_SERP_OVERLAP_THRESHOLD_JUSTIFIED = false
EXACT_URL_OVERLAP_STRONGER_THAN_DOMAIN_OVERLAP = true
TASK_INTENT_AND_SERP_COMBINATION_REQUIRED = true
```

## 4. Work trigger

M9 clustering universe:
```text
M8_TOTAL_IDENTITIES = 7913
WORKING / CLUSTER_ELIGIBLE = 104
REVIEW_HOLD / CARRIED_NOT_CLUSTERED = 5064
EXCLUDED / NOT_CLUSTERED = 2737
BRAND_DEFENSE / SEPARATE_NOT_CLUSTERED = 8

PAIRWISE_WORKING_PAIRS = 104*103/2 = 5356
```

Search evidence availability among 104 Working:
```text
EXACT_ORGANIC_QUERY_OBSERVED = 22
NO_EXACT_ORGANIC_QUERY_OBSERVATION = 82

BOTH_EXACT_SERP_PAIRS = 231
ONE_EXACT_SERP_PAIRS = 1804
NO_EXACT_SERP_PAIRS = 3321
```

Full pairwise + cluster reconciliation + adversarial QA creates quality risk in ordinary chat.

`WORK_TRIGGER_DECISION = WORK_REQUIRED`.

No sampling/first-N/truncation.

## 5. Exact direct inputs

Canonical direct manifest:
`docs/seo/M9_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-24_R1.json`

Required files: 18.

The semantic authority is:
- accepted M8 semantic master;
- M8 lineage/HOLD/reason/QA;
- Product Truth;
- current M3/M4A Search evidence;
- current M4Q current-SERP evidence;
- recovered targeted page evidence;
- M6 region-sensitivity evidence.

No M8 raw ledger is required as a direct clustering input because M9 operates on accepted semantic identities; upstream lineage remains available through M8 master + XREF and M8 final acceptance.

## 6. Eligibility contract

Every one of the 7,913 M8 identities must receive one M9 eligibility state:

```text
CLUSTER_ELIGIBLE = M8 WORKING = 104
CARRIED_REVIEW_HOLD = 5064
EXCLUDED_NOT_CLUSTERED = 2737
BRAND_DEFENSE_SEPARATE = 8
```

Only `CLUSTER_ELIGIBLE` identities enter the 5,356-pair matrix.

REVIEW_HOLD cannot be promoted merely to fill a cluster.
EXCLUDED cannot re-enter.
BRAND_DEFENSE is preserved outside ordinary Search cluster formation unless later Search authority explicitly observes it; M9 does not invent demand from Product Truth.

## 7. Pairwise evidence contract

For every unordered pair among the 104 eligible identities, produce exactly one row.

Required relation dimensions:

```text
USER_TASK_RELATION =
  SAME | COMPATIBLE | DIFFERENT | AMBIGUOUS

INTENT_RELATION =
  SAME | COMPATIBLE | DIFFERENT | AMBIGUOUS

MARKETPLACE_SCOPE_RELATION =
  SAME | GENERIC_SPECIFIC_COMPATIBLE | DIFFERENT | AMBIGUOUS

PRODUCT_FIT_RELATION =
  COMPATIBLE | DIFFERENT | AMBIGUOUS

SEARCH_COMPARABILITY =
  BOTH_EXACT_SERP | ONE_EXACT_SERP | NO_EXACT_SERP
```

Where both exact current SERPs are available, compute:

- exact URL overlap top10 count;
- exact URL union top10 count;
- exact URL Jaccard top10;
- exact URL overlap top20 count;
- exact URL union top20 count;
- exact URL Jaccard top20;
- domain overlap top10 count;
- domain Jaccard top10;
- result/page-type alignment;
- Search evidence refs.

For one/no exact SERP:
- overlap metrics = `NA_NOT_COMPARABLE`;
- do NOT encode missing evidence as zero overlap.

Exact URL overlap is stronger than domain overlap.

## 8. Pair decision

Every pair gets exactly one:

```text
MERGE_SUPPORTED
SPLIT_SUPPORTED
HOLD_BOUNDARY
```

No universal numeric threshold.

### MERGE_SUPPORTED

Requires:
- same/compatible real user task;
- same/compatible Search intent;
- compatible product answer/capability boundary;
- compatible marketplace scope;
- no accepted evidence of materially distinct content type/page job;
- Search evidence support where comparable.

Possible evidence grades:

```text
A_SERP_CONFIRMED
  both identities have exact current SERP and overlap/page-type behavior supports same page

B_SEARCH_ANCHORED_TASK_MATCH
  one identity has exact current SERP; the other lacks exact SERP but has same task/intent/product answer and no contrary Search evidence
```

A pair with `NO_EXACT_SERP` on both sides cannot be promoted to `MERGE_SUPPORTED` solely from lexical or preliminary-family similarity.

### SPLIT_SUPPORTED

Allowed when one or more are materially different:
- user task;
- primary/mixed intent;
- required answer/content type;
- marketplace-specific answer;
- product capability boundary;
- funnel/job stage;
- current comparable SERP behavior.

Zero exact URL overlap may support split only when both queries are actually comparable current SERPs and the surrounding task/page-type evidence supports separation.

### HOLD_BOUNDARY

Use when:
- task/intent appears close but Search evidence is absent/conflicting;
- generic/specific marketplace relationship is unresolved;
- page-type expectation conflicts;
- merge would rely only on wording/family;
- evidence is insufficient to honestly decide.

## 9. Cluster construction rule

Cluster IDs:
`M9CL_<first16 lowercase SHA256(sorted member semantic_identity_ids joined by newline)>`.

Retained multi-member cluster hard rule:

```text
EVERY INTRA-CLUSTER PAIR = MERGE_SUPPORTED
NO INTRA-CLUSTER SPLIT_SUPPORTED
NO INTRA-CLUSTER HOLD_BOUNDARY
AT LEAST ONE MEMBER = EXACT_ORGANIC_QUERY_OBSERVED
```

This is complete-link / conflict-free construction.

Forbidden:
```text
A merges B
B merges C
A HOLD/SPLIT C
-> one ABC cluster
```

Chain transitivity cannot override a conflicting pair.

A no-exact-SERP identity may join a retained cluster only when:
- the cluster has a Search-anchored member;
- it is MERGE_SUPPORTED to every other cluster member.

Singleton handling:
- exact-SERP identity may be a retained singleton when no supported merge exists and split rationale is explicit;
- no-exact-SERP singleton is `HOLD_CLUSTER_BOUNDARY` unless its distinct task/page need is independently established strongly enough to support a Search-only singleton without treating missing SERP as proof.

## 10. Cluster states

```text
RETAINED_CLUSTER
RETAINED_SINGLETON
HOLD_CLUSTER_BOUNDARY
```

Every one of the 104 eligible identities must belong to exactly one M9 cluster candidate/state.

HOLD clusters do not advance to ordinary M10A page ownership until their boundary is resolved or explicitly carried as HOLD.

## 11. Required cluster fields

At minimum:

- cluster_id;
- cluster_state;
- member_count;
- member_semantic_identity_ids;
- canonical_cluster_label;
- primary_user_job;
- intent_primary;
- intent_mixed_notes;
- marketplace_scope;
- product_fit_boundary;
- search_anchor_identity_ids;
- exact_serp_member_count;
- serp_evidence_summary;
- exact_url_overlap_summary;
- result_page_type_expectation;
- merge_rationale;
- split_boundary_rationale;
- cannibalization_risk;
- ambiguity_hold;
- hold_reopen_rule;
- upstream_m8_refs;
- search_evidence_refs;
- claim_boundary.

This is not a URL/page owner contract.

## 12. Required outputs — exactly 9

1. `M9_SOURCE_MANIFEST.md`
2. `M9_IDENTITY_ELIGIBILITY_LEDGER.tsv`
3. `M9_PAIRWISE_CLUSTER_EVIDENCE.tsv`
4. `M9_CLUSTER_MASTER.tsv`
5. `M9_CLUSTER_MEMBERSHIP.tsv`
6. `M9_HOLD_BOUNDARY_LEDGER.tsv`
7. `M9_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M9_QA.md`
9. `M9_RETURN_MANIFEST.json`

## 13. Output schemas / row expectations

### Eligibility ledger

Exactly 7,913 rows.

Fields:
- semantic_identity_id;
- m8_primary_state;
- m9_eligibility_state;
- canonical_display_text;
- user_task_job;
- intent_primary;
- marketplace_tags;
- product_fit_state;
- search_evidence_state;
- search_evidence_refs;
- eligibility_reason;
- m8_upstream_ref.

Hard counts:
```text
CLUSTER_ELIGIBLE = 104
CARRIED_REVIEW_HOLD = 5064
EXCLUDED_NOT_CLUSTERED = 2737
BRAND_DEFENSE_SEPARATE = 8
```

### Pairwise ledger

Exactly 5,356 rows.
One unordered pair per two eligible identities.

Required fields include all relation dimensions, URL/domain metrics, evidence grade, pair decision, reason code, rationale and evidence refs.

### Cluster membership

Exactly 104 rows.
Each eligible identity appears exactly once.

### Cluster master

One row per deterministic cluster candidate.
Count not predeclared.

### HOLD boundary ledger

Every cluster/pair boundary whose final cluster state is HOLD, plus any material nonblocking uncertainty affecting a retained cluster.

## 14. Independent adversarial QA

Must independently test:

- chain-overmerge / transitivity defects;
- giant generic F3 analytics cluster;
- exact-SERP pairs merged despite divergent page types;
- zero-overlap pairs merged without supporting context;
- no-SERP pairs merged only by wording/family;
- generic vs Ozon vs Wildberries overmerge;
- commercial service-comparison vs informational report-help overmerge;
- AI-agent category vs connect-your-own-AI integration overmerge;
- report analytics vs ad-analysis / DRR overmerge;
- singleton proliferation caused only by missing SERP;
- retained cluster with internal HOLD/SPLIT pair;
- duplicate identity membership;
- M8 HOLD/EXCLUDED/BRAND identity accidentally admitted.

If a mechanism defect appears:
`ROOT CAUSE -> AFFECTED UNIVERSE -> FIX -> RERUN COMPLETE 5,356 PAIRS -> SIBLING CHANGE REPORT`.

No example-only patch.

## 15. AI / downstream boundary

```text
ALICE_INPUT_ROWS = 0
M5_HYPOTHESIS_USED = 0
AI_SOURCE_USED_FOR_CLUSTER = 0

FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_DECISIONS = 0
FINAL_H1_TITLE_DECISIONS = 0
FINAL_IA_DECISIONS = 0
```

Page/content-type expectation is allowed only as a clustering attribute, not final page ownership.

## 16. Provider / web policy

```text
WORDSTAT_CALLS = 0
YANDEX_SEARCH_CALLS = 0
ALICE_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
```

M9 uses the frozen Search evidence.
If clustering evidence is insufficient, HOLD rather than reopen provider collection inside Work.

## 17. Hard gates

```text
LEVEL1_READ = PASS
LEVEL2_READ = PASS
FRESH_METHOD_RESEARCH = PASS

M8_ACCEPTANCE = PASS
M8_IDENTITY_ROWS_ACCOUNTED = 7913/7913

CLUSTER_ELIGIBLE = 104/104
PAIRWISE_ROWS = 5356/5356
PAIRWISE_DUPLICATES = 0
PAIRWISE_SELF_PAIRS = 0

MEMBERSHIP_ROWS = 104/104
ELIGIBLE_IDENTITIES_WITHOUT_CLUSTER_STATE = 0
IDENTITY_MULTI_CLUSTER_MEMBERSHIP = 0

RETAINED_CLUSTER_INTERNAL_SPLIT_PAIR = 0
RETAINED_CLUSTER_INTERNAL_HOLD_PAIR = 0
RETAINED_MULTIMEMBER_CLUSTER_WITHOUT_SEARCH_ANCHOR = 0

MISSING_SERP_AS_ZERO_OVERLAP = 0
UNIVERSAL_OVERLAP_THRESHOLD_USED = 0
PRELIMINARY_FAMILY_AS_CLUSTER_PROOF = 0
LEXICAL_SIMILARITY_AS_CLUSTER_PROOF = 0

M8_REVIEW_HOLD_CLUSTERED = 0
M8_EXCLUDED_CLUSTERED = 0
M8_BRAND_DEFENSE_ORDINARY_CLUSTERED = 0

ALICE_INPUT_ROWS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0

INDEPENDENT_CLUSTER_QA = PASS
OPEN_CRITICAL_DEFECTS = 0
```

## 18. Stop / HOLD

`HOLD_AUTHORITY_DRIFT`:
M8 or current Search authority changes.

`HOLD_INPUT_IDENTITY`:
required input blob/row identity differs.

`HOLD_PAIRWISE_ACCOUNTING`:
5,356 pair universe does not reconcile.

`HOLD_CLUSTER_CONTRACT_DEFECT`:
cluster relation cannot be represented without inventing methodology.

Row/cluster-level `HOLD_BOUNDARY` is valid and expected.

## 19. Publication

Work required.
Work does not write GitHub.

One ZIP containing exactly 9 files.

Staging:
`docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R1/`

Owner upload URL:
`https://github.com/MaksimUnimax/runtime-fixtures/upload/seo/wordstat-batch-01-2026-09-16/docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R1/`

## 20. Preparation record

```text
LIVE_HEAD = 48b133943e7c1874e4c89d60b967240164a91f34
LEVEL1_FILES_READ = PASS
LEVEL2_README_READ = PASS
OCTOPORT_STEP_RULES_INDEX_READ = PASS
APPLICABLE_LEVEL2_FILES_READ = PASS
WORK_EVIDENCE_FILES_READ = PASS
FAILURE_HISTORY_READ = PASS
EXTERNAL_SOURCES_CHECKED = PASS
WORK_TRIGGER_DECISION = WORK_REQUIRED
EXACT_INPUTS = FROZEN
EXACT_OUTPUTS = FROZEN
SCHEMA_AND_LINEAGE = FROZEN
HARD_GATES = FROZEN
STOP_HOLD_REOPEN_RULES = FROZEN
PUBLICATION_PATH = FROZEN

WORK_PROMPT_ALLOWED_BEFORE_REMOTE_READBACK = false
```

After remote readback:
`M9_PRE_HANDOFF_ALLOWED = true`.
