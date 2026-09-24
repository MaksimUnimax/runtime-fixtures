# Octoport SEO — M9 Search-only clustering — STEP PREPARATION R2

Date: 2026-09-24
Status: **PREPARATION COMPLETE / WORK RELEASE NOT YET ISSUED**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
LIVE_HEAD: `47f269040adfd669c48e00a6b6ce0db604c74e5c`

Recovery:
- M9 R1 execution authority is superseded under OSEO-F07.
- No M9 Work execution/result exists.
- R2 freezes the previously implicit operational Search-comparison rules.

## 0. Mandatory two-level gate

LEVEL 1 read in full/current:
- `docs/seo/LEVEL1/README.md`
- `docs/seo/EXECUTION_RULES.md`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md`
- `docs/seo/WORK_HANDOFF_RULE.md`
- `docs/seo/METHODOLOGY.md`
- `docs/seo/PRODUCT_TRUTH.md`

LEVEL 2 read in full/current:
- `docs/seo/LEVEL2/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md`

Current M8 authority, M9 history and failure ledger read.

```text
LEVEL1_READ = PASS
LEVEL2_READ = PASS
ROADMAP_CURRENT_STATE_READ = PASS
WORK_EVIDENCE_READ = PASS
FAILURE_HISTORY_READ = PASS
LEVEL2_CONTRADICTION = false
```

## 1. Roadmap / current state

```text
M0..M7 = ACCEPTED CURRENT AUTHORITY
M8 R3 = PASS / SEARCH-ONLY SEMANTIC MASTER ACCEPTED
M9 R1 = SUPERSEDED / NOT EXECUTABLE
M9 R2 = CURRENT PREPARATION
M10A = BLOCKED
M10B/C/D = BLOCKED
M11+ = BLOCKED
```

M9 purpose:
decide which accepted M8 Search-side Working identities can honestly share one future page-purpose cluster, and which must remain split or unresolved.

M9 does NOT assign final page owners, URLs, H1, Title or IA.

## 2. Fresh external method research — 2026-09-24

### Yandex Webmaster — query selection / clusters
https://www.yandex.com/support/webmaster/en/service/queries-selection

Supported claim:
Yandex defines clustering as automatic grouping of search queries similar in meaning or user intent.

Project application:
`LEXICAL_SIMILARITY != FINAL_CLUSTER`.
User task and intent are mandatory cluster evidence.

### Yandex Webmaster — query / URL statistics
https://www.yandex.com/support/webmaster/en/service/popular-queries
https://yandex.com/support/webmaster/en/service/statistics
https://yandex.com/support/webmaster/en/service/urls

Supported claim:
Yandex exposes Search evidence grouped by query and by URL; query/page relationships, impressions and positions are distinct observable entities.

Project application:
observed URL behavior is a legitimate clustering signal.
Exact URL agreement is treated as stronger project evidence than domain-only agreement.

### Ahrefs — keyword clustering
https://ahrefs.com/blog/keyword-clustering/
https://ahrefs.com/blog/secondary-keywords/

Supported industry claim:
keyword clustering groups keywords with same/similar intent; similarity of ranking URLs/SERP results is commonly used to infer whether one page can serve multiple queries.

Project application:
current exact-URL SERP overlap is a primary pairwise signal, not an automatic verdict.

### Semrush — keyword clustering
https://www.semrush.com/blog/keyword-clustering/
https://www.semrush.com/blog/keyword-manager-clustering-tool/
https://www.semrush.com/blog/what-are-methods-for-keyword-clustering-and-topic-modeling/

Supported industry claim:
search intent and SERP overlap are core clustering inputs; Semrush describes grouping based on similar top organic URLs rather than word similarity alone.

Project application:
Search result similarity outranks lexical similarity as cluster evidence.

### Google Search Central — spam / people-first
https://developers.google.com/search/docs/essentials/spam-policies
https://developers.google.com/search/docs/fundamentals/creating-helpful-content

Supported claim:
creating substantially similar pages for similar queries can become doorway/search-first behavior; content should primarily serve users.

Project application:
`QUERY != PAGE`.
M9 must reduce false page proliferation but must not force unrelated tasks into one page merely to reduce page count.

### What external sources do NOT define

The sources above do not define:
- one universal overlap threshold suitable for Octoport;
- our complete-link all-pairs cluster rule;
- our one-sided Search-anchor evidence grade;
- our exact HOLD propagation rule.

Those are **project conservative heuristics**, governed by Level 2 and this R2 contract, not external facts.

```text
FRESH_METHOD_RESEARCH = PASS
SOURCE_TO_METHOD_TRACE = PASS
UNIVERSAL_OVERLAP_THRESHOLD_EXTERNALLY_JUSTIFIED = false
PROJECT_HEURISTICS_DISCLOSED = true
```

## 3. Work trigger

Accepted M8:
```text
TOTAL_IDENTITIES = 7913
WORKING = 104
REVIEW_HOLD = 5064
EXCLUDED = 2737
BRAND_DEFENSE = 8
```

Only Working enters pairwise clustering.

```text
ELIGIBLE = 104
PAIRWISE = 104*103/2 = 5356
```

Full pairwise judgment + Search joins + cluster consistency + adversarial QA is quality-risky in ordinary chat.

```text
WORK_TRIGGER_DECISION = WORK_REQUIRED
SAMPLING = FORBIDDEN
FIRST_N = FORBIDDEN
TRUNCATION_AS_ANALYSIS = FORBIDDEN
```

## 4. Exact input authority

Canonical R2 direct-input manifest:

`docs/seo/M9_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-24_R2.json`

Required Git blob:
`424f2e61c54388c90fb5cc91495f7f5c8f81898b`

Search-anchor map:

`docs/seo/M9_SEARCH_ANCHOR_MAP_2026-09-24_R2.tsv`

Required Git blob:
`61a6d6c5befbc20f75fadddfd035b7affc6fe14c`

Required rows:
`22/22`.

Direct/context files:
`19`.

Any file outside the R2 manifest is audit fallback only for a named discrepancy and must be disclosed.

## 5. Identity eligibility — account all 7,913

Exactly one M9 eligibility state per M8 identity:

```text
M8 WORKING 104 -> CLUSTER_ELIGIBLE
M8 REVIEW_HOLD 5064 -> CARRIED_REVIEW_HOLD
M8 EXCLUDED 2737 -> EXCLUDED_NOT_CLUSTERED
M8 BRAND_DEFENSE 8 -> BRAND_DEFENSE_SEPARATE
```

Only the 104 `CLUSTER_ELIGIBLE` identities enter the pair universe.

Forbidden:
- promoting REVIEW_HOLD to fill clusters;
- reintroducing EXCLUDED;
- treating BRAND_DEFENSE as ordinary demand/Search cluster evidence.

## 6. Current Search-anchor contract

Exactly 22/104 Working identities have accepted exact current organic Search evidence.

The R2 anchor map proves:

```text
WORKING_SEARCH_ANCHORED = 22
M4Q_QUERY_IDS = 22 unique
MAPPING = 1 identity : 1 M4Q query ID
SEARCH_TYPE = SEARCH_TYPE_RU
REGION = 225
DEPTH = 100
GROUP_MODE = FLAT
DOCS_IN_GROUP = 1
FAMILY_MODE = MODERATE
FIX_TYPO = OFF
```

The other 82 identities have no exact current organic query observation.

Pair comparability:

```text
BOTH_CURRENT_SERP = C(22,2) = 231
ONE_CURRENT_SERP = 22*82 = 1804
NO_CURRENT_SERP = C(82,2) = 3321
TOTAL = 5356
```

## 7. Search evidence precedence

Current clustering-overlap authority:

`M4Q_R2_SERP_RESULT_LEDGER.tsv`

For the mapped 22 query IDs.

Current metric fields:

```text
URL = result_url_normalized
DOMAIN = result_domain
RANK = result_rank
```

Rules:

- do not re-normalize `result_url_normalized`;
- exact URL equality means exact string equality of that field;
- domain equality means exact string equality of `result_domain`;
- use unique values as sets;
- top10 = rows with rank <= 10;
- top20 = rows with rank <= 20;
- Jaccard = |intersection| / |union|;
- report overlap and union counts alongside Jaccard.

M4Q current RU225 is primary for current overlap metrics.

Historical M4A:
- may support intent/page-type/context;
- must NOT be mixed into current M4Q URL/domain overlap sets.

M6 region 213:
- sensitivity context only;
- must NOT be mixed into RU225 overlap sets.

```text
CURRENT_HISTORICAL_SERP_MIX = 0
REGION_213_IN_RU225_OVERLAP = 0
AD_HOC_URL_RENORMALIZATION = 0
```

## 8. Page-type authority

Seven Search-anchored identities have accepted historical M4A query-profile page-type authority in the anchor map.

For those:
use the frozen `dominant_top10_page_type` only as historical/supporting page-type evidence.

For the other 15 Search anchors:
`page_type_authority = NA_NOT_AUTHORIZED`.

Work must NOT infer a new page-type taxonomy from M4Q raw URL/title/snippet.

Pair field:

```text
result_page_type_relation =
  SAME
  DIFFERENT
  AMBIGUOUS
  NA_NOT_AUTHORIZED
```

Rules:
- SAME/DIFFERENT only when both sides have accepted comparable page-type authority;
- one/both missing -> NA_NOT_AUTHORIZED;
- conflicting accepted authority -> AMBIGUOUS.

```text
AD_HOC_PAGE_TYPE_INFERENCE = 0
```

## 9. Pairwise universe

Exactly one row for every unordered pair among 104 identities.

Deterministic pair ID:

`M9PAIR_<first16 lowercase SHA256(sorted [id_a,id_b] joined by newline)>`.

Required rows:
`5356`.

Required pair dimensions:

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
  BOTH_CURRENT_SERP | ONE_CURRENT_SERP | NO_CURRENT_SERP
```

Overlap metrics are numeric only for `BOTH_CURRENT_SERP`.

For ONE/NO current SERP:

`NA_NOT_COMPARABLE`.

Missing evidence is never encoded as zero overlap.

## 10. Pair decisions

Exactly one:

```text
MERGE_SUPPORTED
SPLIT_SUPPORTED
HOLD_BOUNDARY
```

### Evidence grades

```text
A_CURRENT_SERP_BILATERAL
B_CURRENT_SERP_UNILATERAL
C_NON_SERP_TASK_SPLIT
H_INSUFFICIENT_BOUNDARY
```

### MERGE_SUPPORTED

Allowed only when:
- task SAME/COMPATIBLE;
- intent SAME/COMPATIBLE;
- product answer compatible;
- marketplace scope SAME/GENERIC_SPECIFIC_COMPATIBLE;
- no accepted contrary evidence.

Allowed evidence grades:
- `A_CURRENT_SERP_BILATERAL`;
- `B_CURRENT_SERP_UNILATERAL`.

A pair with `NO_CURRENT_SERP` cannot be MERGE_SUPPORTED.

### SPLIT_SUPPORTED

Allowed when accepted evidence establishes a materially different page-satisfaction need via:
- task;
- intent;
- marketplace-specific answer;
- product answer/capability boundary;
- accepted page-type difference;
- comparable current SERP divergence plus semantic/task separation.

Can use `C_NON_SERP_TASK_SPLIT` when Search is unavailable but the task/product boundary itself proves separate satisfaction needs.

Zero URL overlap alone is never sufficient.

### HOLD_BOUNDARY

Required when same/compatible potential page need cannot be resolved honestly.

## 11. Frozen pair reason codes

MERGE:

```text
M_SERP_URL_CONVERGENCE
M_ONE_SERP_TASK_COMPATIBLE
```

SPLIT:

```text
S_TASK_DIFFERENT
S_INTENT_DIFFERENT
S_MARKETPLACE_ANSWER_DIFFERENT
S_PRODUCT_ANSWER_DIFFERENT
S_PAGE_TYPE_DIFFERENT
S_SERP_DIVERGENCE_WITH_SEMANTIC_SPLIT
```

HOLD:

```text
H_NO_BILATERAL_SERP_SAME_TASK
H_ONE_SERP_INSUFFICIENT
H_GENERIC_SPECIFIC_UNRESOLVED
H_MIXED_INTENT_BOUNDARY
H_PAGE_TYPE_AMBIGUOUS
H_SEARCH_EVIDENCE_CONFLICT
H_OTHER_BOUNDARY
```

Every pair uses one primary reason code and bounded rationale.
No ad-hoc reason-code creation inside Work.

## 12. Conflict-free cluster construction

Cluster ID:

`M9CL_<first16 lowercase SHA256(sorted member semantic_identity_ids joined by newline)>`.

Cluster states:

```text
RETAINED_CLUSTER
RETAINED_SINGLETON
HOLD_CLUSTER_BOUNDARY
```

### Multi-member positive cluster

Required:

```text
EVERY INTRA-CLUSTER PAIR = MERGE_SUPPORTED
INTRA SPLIT = 0
INTRA HOLD = 0
AT LEAST ONE CURRENT SEARCH ANCHOR = true
```

This complete-link rule is a **project conservative heuristic** to prevent transitive overmerge.

Forbidden:
`A merge B + B merge C + A hold/split C -> ABC cluster`.

### External material HOLD rule

A cluster cannot be `RETAINED_CLUSTER` or `RETAINED_SINGLETON` if any member has a material `HOLD_BOUNDARY` to an outside eligible identity where:
- user task is SAME/COMPATIBLE; AND
- intent is SAME/COMPATIBLE/AMBIGUOUS; AND
- product/scope is not already DIFFERENT.

Such cluster state becomes `HOLD_CLUSTER_BOUNDARY`.

Hard gate:
`RETAINED_CLUSTER_EXTERNAL_MATERIAL_HOLD = 0`.

### No-SERP identities

A no-current-SERP identity:
- may join only a Search-anchored retained multi-member cluster and only if MERGE_SUPPORTED to every member;
- cannot merge with another no-current-SERP identity;
- may be a `RETAINED_SINGLETON` only if all plausible same-page neighbors are SPLIT_SUPPORTED from accepted non-SERP task/product evidence;
- otherwise it is `HOLD_CLUSTER_BOUNDARY`.

### HOLD representation

Unresolved identities remain membership singletons with `HOLD_CLUSTER_BOUNDARY`.
The pairwise/HOLD ledgers preserve all alternative unresolved boundaries.
Do not invent a positive multi-member HOLD cluster.

## 13. Outputs — exactly 9

1. `M9_SOURCE_MANIFEST.md`
2. `M9_IDENTITY_ELIGIBILITY_LEDGER.tsv`
3. `M9_PAIRWISE_CLUSTER_EVIDENCE.tsv`
4. `M9_CLUSTER_MASTER.tsv`
5. `M9_CLUSTER_MEMBERSHIP.tsv`
6. `M9_HOLD_BOUNDARY_LEDGER.tsv`
7. `M9_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M9_QA.md`
9. `M9_RETURN_MANIFEST.json`

## 14. Required row contracts

Eligibility:
`7913` rows.

Pairwise:
`5356` rows.

Membership:
`104` rows.

Every eligible identity exactly once.

HOLD ledger:
one row per material `HOLD_BOUNDARY` pair plus affected cluster/member state and reopen rule.

Cluster master:
one row per deterministic cluster membership group.

## 15. Cluster master fields

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
- pairwise_merge_count;
- external_material_hold_count;
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

No final page owner/URL.

## 16. HOLD boundary ledger fields

At minimum:

- hold_id;
- pair_id;
- semantic_identity_id_a;
- semantic_identity_id_b;
- cluster_id_a;
- cluster_id_b;
- pair_reason_code;
- exact_unknown;
- current_evidence;
- missing_evidence;
- why_not_guess;
- blocking_for_m10a;
- reopen_trigger;
- claim_boundary.

## 17. Independent adversarial QA

Must independently test:

1. chain/transitive overmerge;
2. giant F3 analytics cluster;
3. exact-SERP merge with weak/contradictory URL evidence;
4. same URLs but different task/intent;
5. zero-overlap split without semantic separation;
6. no-SERP merge;
7. generic/Ozon/WB overmerge;
8. commercial service-comparison vs informational report help;
9. F1 AI-agent vs F2 connect-own-AI;
10. report analytics vs DRR/ad analysis;
11. retained cluster with external material HOLD;
12. singleton retained only because Search missing;
13. accidental M8 HOLD/EXCLUDED/BRAND admission;
14. duplicate membership.

Systematic defect:
`ROOT CAUSE -> AFFECTED UNIVERSE -> FIX -> RERUN ALL 5356 PAIRS -> SIBLING CHANGE REPORT`.

## 18. Hard gates

```text
LEVEL1_READ = PASS
LEVEL2_READ = PASS
FRESH_METHOD_RESEARCH = PASS
SOURCE_TO_METHOD_TRACE = PASS

M8_ACCEPTANCE = PASS
M8_IDENTITIES = 7913/7913

ELIGIBILITY_ROWS = 7913/7913
CLUSTER_ELIGIBLE = 104/104
CARRIED_REVIEW_HOLD = 5064/5064
EXCLUDED_NOT_CLUSTERED = 2737/2737
BRAND_DEFENSE_SEPARATE = 8/8

SEARCH_ANCHOR_MAP = 22/22
SEARCH_ANCHOR_DUPLICATE_QUERY_IDS = 0
SEARCH_ANCHOR_MULTI_QUERY_IDENTITIES = 0

PAIRWISE_ROWS = 5356/5356
PAIRWISE_DUPLICATES = 0
PAIRWISE_SELF_PAIRS = 0
BOTH_CURRENT_SERP = 231/231
ONE_CURRENT_SERP = 1804/1804
NO_CURRENT_SERP = 3321/3321

MISSING_SERP_AS_ZERO_OVERLAP = 0
AD_HOC_URL_RENORMALIZATION = 0
CURRENT_HISTORICAL_SERP_MIX = 0
REGION_213_IN_RU225_OVERLAP = 0
AD_HOC_PAGE_TYPE_INFERENCE = 0
UNIVERSAL_OVERLAP_THRESHOLD_USED = 0

MEMBERSHIP_ROWS = 104/104
IDENTITY_MULTI_CLUSTER_MEMBERSHIP = 0
ELIGIBLE_IDENTITIES_WITHOUT_CLUSTER_STATE = 0
RETAINED_CLUSTER_INTERNAL_SPLIT_PAIR = 0
RETAINED_CLUSTER_INTERNAL_HOLD_PAIR = 0
RETAINED_CLUSTER_EXTERNAL_MATERIAL_HOLD = 0
RETAINED_MULTIMEMBER_CLUSTER_WITHOUT_SEARCH_ANCHOR = 0
NO_SERP_TO_NO_SERP_MERGE = 0

M8_REVIEW_HOLD_CLUSTERED = 0
M8_EXCLUDED_CLUSTERED = 0
M8_BRAND_DEFENSE_ORDINARY_CLUSTERED = 0

ALICE_INPUT_ROWS = 0
M5_HYPOTHESIS_USED = 0
AI_SOURCE_USED_FOR_CLUSTER = 0

FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0

INDEPENDENT_CLUSTER_QA = PASS
OPEN_CRITICAL_DEFECTS = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
```

## 19. Stop / HOLD

`HOLD_AUTHORITY_DRIFT`:
accepted M8/current Search/method authority changed.

`HOLD_INPUT_IDENTITY`:
required input blob/row/search-anchor identity differs.

`HOLD_PAIRWISE_ACCOUNTING`:
5356 universe does not reconcile.

`HOLD_CLUSTER_CONTRACT_DEFECT`:
material cluster relation cannot be represented without inventing methodology.

Row/pair/cluster-level HOLD is valid and expected.

## 20. Work / provider policy

```text
WORK = REQUIRED
WORDSTAT_CALLS = 0
YANDEX_SEARCH_CALLS = 0
ALICE_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
SITE_MUTATION = 0
```

If current Search evidence is insufficient, HOLD.
No provider reopening inside Work.

## 21. Publication

Work returns one ZIP containing exactly 9 final files.
Work does not write GitHub.

Staging:
`docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2/`

Owner upload URL:
`https://github.com/MaksimUnimax/runtime-fixtures/upload/seo/wordstat-batch-01-2026-09-16/docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2/`

## 22. Preparation record

```text
LIVE_HEAD = 47f269040adfd669c48e00a6b6ce0db604c74e5c
LEVEL1_FILES_READ = PASS
LEVEL2_README_READ = PASS
OCTOPORT_STEP_RULES_INDEX_READ = PASS
APPLICABLE_LEVEL2_FILES_READ = PASS
WORK_EVIDENCE_FILES_READ = PASS
FAILURE_HISTORY_READ = PASS
EXTERNAL_SOURCES_CHECKED = PASS
FRESH_METHOD_RESEARCH = PASS
SOURCE_TO_METHOD_TRACE = PASS
WORK_TRIGGER_DECISION = WORK_REQUIRED

EXACT_INPUTS = FROZEN
SEARCH_ANCHOR_MAP = FROZEN
SEARCH_SNAPSHOT_PRECEDENCE = FROZEN
URL_DOMAIN_COMPARISON = FROZEN
PAGE_TYPE_AUTHORITY = FROZEN
PAIR_REASONS = FROZEN
CLUSTER_CONFLICT_RULES = FROZEN
EXACT_OUTPUTS = FROZEN
HARD_GATES = FROZEN
STOP_HOLD_REOPEN_RULES = FROZEN
PUBLICATION_PATH = FROZEN

M9_R1_EXECUTION_AUTHORITY = SUPERSEDED
WORK_PROMPT_ALLOWED_BEFORE_REMOTE_READBACK = false
```

After remote readback:
`M9_R2_PRE_HANDOFF_ALLOWED = true`.
