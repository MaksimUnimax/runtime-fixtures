# Octoport SEO — M9 boundary-resolution pre-acquisition — STEP PREPARATION R1

Date: 2026-09-24
Status: **PREPARATION COMPLETE / WORK RELEASE NOT YET ISSUED / PROVIDER NOT AUTHORIZED**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
LIVE_HEAD: `440eed8162f84a18e79c9f779194fcdb6e7ad99c`

## 0. Mandatory two-level gate

LEVEL 1 read/current:
- `docs/seo/LEVEL1/README.md`
- `docs/seo/EXECUTION_RULES.md`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md`
- `docs/seo/WORK_HANDOFF_RULE.md`
- `docs/seo/METHODOLOGY.md`
- `docs/seo/PRODUCT_TRUTH.md`
- `docs/seo/PROVIDER_QUERY_RELEASE_RULE.md`

LEVEL 2 read/current:
- `docs/seo/LEVEL2/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md`
- `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md` for incremental provider information-gain controls.

Current work/evidence/failure history read:
- accepted M8;
- accepted M9 R2 bounded authority;
- M9 progress;
- failure ledger including OSEO-F01/F07.

```text
LEVEL1_READ = PASS
APPLICABLE_LEVEL2_READ = PASS
ROADMAP_CURRENT_STATE_READ = PASS
WORK_EVIDENCE_READ = PASS
FAILURE_HISTORY_READ = PASS
```

## 1. Current cursor

```text
M0..M8 = ACCEPTED
M9 R2 = PASS_WITH_HOLD_BOUNDARIES / ACCEPTED_BOUNDED_AUTHORITY

MERGE_SUPPORTED = 3
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1518
MATERIAL_HOLD_BOUNDARIES = 1424

CLUSTER_ELIGIBLE = 104
CURRENT_SEARCH_ANCHORED = 22
NO_CURRENT_EXACT_SERP = 82

RETAINED_CLUSTER = 0
RETAINED_SINGLETON = 0
HOLD_CLUSTER_BOUNDARY = 104

M10A = BLOCKED
```

This step stays inside M9.

Purpose:
identify which unresolved M9 Search boundaries justify additional ordinary Yandex Search evidence and which should remain explicit HOLD without provider acquisition.

This step does NOT:
- call a provider;
- alter M8 semantic states;
- assign page owners;
- use Alice;
- start M10A.

## 2. Fresh external method/provider research — 2026-09-24

### Yandex Webmaster query clustering
https://www.yandex.com/support/webmaster/en/service/queries-selection

Supported claim:
Yandex describes query clusters as automatic grouping of queries similar in meaning or user intent.

Application:
new Search acquisition is useful only when it can resolve a concrete same-page boundary; query similarity alone does not justify provider calls.

### Yandex Webmaster query/URL evidence
https://www.yandex.com/support/webmaster/en/service/search-queries
https://www.yandex.com/support/webmaster/en/service/popular-queries
https://yandex.com/support/webmaster/en/service/statistics

Supported claim:
Search evidence is observable by query and URL, and region/device context matters.

Application:
boundary resolution must preserve exact query + region + Search snapshot identity.

### Yandex Search API service / region docs
https://yandex.cloud/ru/services/search-api
https://yandex.cloud/docs/search-api/reference/regions

Supported claim:
Search API exposes the Yandex search base; Russian search supports region targeting; `225` is Russia.

Application:
any future M9 boundary-resolution Search wave uses the same Russia-225 context as accepted M4Q current anchors unless a separately prepared control says otherwise.

### Yandex Search API limits
https://yandex.cloud/en/docs/overview/concepts/quotas-limits

Supported current claim:
Yandex Search API can return up to 250 results; deferred and synchronous request quotas are separately bounded.

Application:
Top100 remains technically within current provider limits; depth 100 is chosen for comparability with accepted M4Q anchors, not because it is the provider maximum.

### Yandex Search API POST / region request semantics
https://yandex.cloud/ru-kz/docs/search-api/concepts/post-request

Supported claim:
Russian search accepts a region field and grouped result parameters.

Application:
the previously accepted RU225 / flat / docs-in-group=1 request shape remains externally representable.

### Provider pricing

Current exact Search API tariff is NOT frozen by this pre-acquisition step.

Hard rule:
`FRESH_TARIFF_RECHECK = REQUIRED immediately before any billable submit release`.

### Bridge capability

Accepted project evidence:
`docs/seo/serp/competitors/M4Q_R2_BRIDGE_PREFLIGHT_2026-09-23_R2.md`

It proves Yandex Marketing Bridge 0.1.9 supported:
- deferred async Search;
- start / submitN / collectN / exportPage;
- SEARCH_TYPE_RU;
- region;
- groupsOnPage up to the required 100;
- docsInGroup=1;
- flat grouping;
- typo off;
- durable operation identity/raw-before-normalize.

This is historical accepted capability context, not a claim that the currently installed package is still 0.1.9.

Hard rule:
`CURRENT_BRIDGE_CAPABILITY_RECHECK = REQUIRED before the first Bridge command`.

### Research verdict

```text
FRESH_METHOD_RESEARCH = PASS
FRESH_PROVIDER_DOCS_CHECK = PASS
CURRENT_REGION_225_CONTRACT = PASS
TOP100_WITHIN_PROVIDER_LIMIT = PASS
CURRENT_TARIFF = RECHECK_BEFORE_SUBMIT
CURRENT_BRIDGE_PACKAGE = RECHECK_BEFORE_FIRST_COMMAND
```

## 3. Why this is a Work step

Current unresolved universe:

```text
M9_HOLD_BOUNDARY = 1518
M9_MATERIAL_HOLD = 1424

MISSING_CURRENT_SEARCH_IDENTITIES = 82

MATERIAL HOLD composition:
  ANCHOR <-> ANCHOR = 47
  ANCHOR <-> MISSING = 371
  MISSING <-> MISSING = 1006

ONE_CURRENT_SERP HOLD rows = 396
unique missing identities in one-current-SERP HOLD = 82

H_ONE_SERP_INSUFFICIENT rows = 150
unique missing identities = 56
```

All 82 missing identities touch at least one one-current-SERP HOLD.
81/82 touch at least one material HOLD with an existing Search anchor.

But:
- only part of the 82 are demand-backed/query-like;
- many are competitor/page-title-like phrases;
- blindly searching all 82 would violate information-gain discipline.

Full-volume row-level query-form review + graph impact + bounded wave selection is a Work quality task.

```text
WORK_TRIGGER_DECISION = WORK_REQUIRED
PROVIDER_EXECUTION_IN_WORK = forbidden
```

## 4. Exact inputs

Canonical input manifest:

`docs/seo/M9_BOUNDARY_RESOLUTION_PREACQ_INPUT_MANIFEST_2026-09-24_R1.json`

Direct/context files:
`14`.

The authoritative unresolved boundary universe is:
- M9 pairwise evidence;
- M9 material HOLD ledger;
- M9 membership/cluster states;
- M8 semantic identity master;
- existing 22 Search anchors.

## 5. Identity disposition universe

Work must account exactly:

```text
EXISTING_CURRENT_SEARCH_ANCHOR = 22
MISSING_CURRENT_SEARCH = 82
TOTAL_CLUSTER_ELIGIBLE = 104
```

For the 82 missing identities assign exactly one pre-acquisition disposition:

```text
WAVE1_SEARCH_CANDIDATE
DEFER_SEARCH_CANDIDATE
PERSISTENT_HOLD_NO_EXACT_QUERY_PROBE
QUERY_FORM_AMBIGUOUS_HOLD
```

No M8 REVIEW_HOLD/EXCLUDED/BRAND identity may become a provider candidate.

## 6. Query-form classification

Every one of the 82 missing identities receives exactly one query-form class:

```text
DEMAND_OR_TESTED_EXACT_QUERY
NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND
PAGE_TITLE_OR_SOURCE_PHRASE
AMBIGUOUS_QUERY_FORM
```

### DEMAND_OR_TESTED_EXACT_QUERY

Allowed when M8 has accepted M2R/tested-seed lineage for that exact semantic identity and the canonical display text is an executable query form.

This class does NOT claim positive demand when the upstream state is an empty-success/tested seed.

### NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND

Allowed when:
- no accepted Wordstat demand exists;
- the exact canonical text itself is a plausible standalone user search formulation;
- searching that exact text answers a named M9 boundary question;
- no rephrasing is required.

Search success does not create Wordstat demand.

### PAGE_TITLE_OR_SOURCE_PHRASE

Use when the canonical text is materially tied to editorial/page-title/source wording such that exact Search is likely to test source-string retrieval rather than a useful user query boundary.

This class is not provider-released in Wave 1.

### AMBIGUOUS_QUERY_FORM

Use when Work cannot honestly determine whether exact canonical text is a useful Search probe.

HOLD; no provider release.

Hard:
```text
QUERY_REPHRASE = 0
RELATED_QUERY_EXPANSION = 0
WORK_INVENTED_QUERY_TEXT = 0
```

Provider query text, where selected, must equal `M8_SEMANTIC_IDENTITY_MASTER.canonical_display_text` exactly.

## 7. Provider technical validity precheck

For any Search candidate Work must record:

- UTF-8 query text;
- Unicode codepoint length;
- whitespace-delimited word count;
- provider-limit status.

Current provider bounds checked:
- <=400 characters;
- <=40 words.

Any failing row:
`QUERY_FORM_AMBIGUOUS_HOLD` or `PERSISTENT_HOLD_NO_EXACT_QUERY_PROBE`, never silent truncation/rewrite.

## 8. Boundary impact metrics

For every one of the 82 missing identities compute from accepted M9:

- total HOLD pair degree;
- material HOLD pair degree;
- one-current-SERP HOLD degree;
- material HOLD degree to current Search anchors;
- no-current-SERP material HOLD degree;
- H_ONE_SERP_INSUFFICIENT degree;
- H_MIXED_INTENT_BOUNDARY degree;
- H_GENERIC_SPECIFIC_UNRESOLVED degree;
- H_SEARCH_EVIDENCE_CONFLICT degree;
- whether identity is an outside material-HOLD neighbor of any of the 3 MERGE_SUPPORTED endpoints;
- whether acquiring this identity can turn at least one current `ONE_CURRENT_SERP` boundary into `BOTH_CURRENT_SERP`.

Counts must be derived from current M9 artifacts, not estimated.

## 9. Wave-1 information-gain gate

A row may be `WAVE1_SEARCH_CANDIDATE` only if all are true:

1. M8 state = WORKING.
2. Current exact Search anchor = absent.
3. query-form class is:
   - DEMAND_OR_TESTED_EXACT_QUERY; or
   - NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND.
4. exact query passes provider length/word bounds.
5. acquisition resolves a named current M9 information gap:
   - creates bilateral Search comparability for at least one current one-sided HOLD; OR
   - directly tests a boundary blocking materialization of one of the 3 supported merge edges; OR
   - tests the unresolved no-SERP singleton boundary where current Search can materially determine page satisfaction.
6. no existing durable exact Search snapshot already answers the same exact query/context.

No candidate is released merely because it has high graph degree.

## 10. First-wave cap and ordering

First wave:

`0 <= WAVE1_QUERY_COUNT <= 25`.

Why bounded:
- stop after one information-gain wave and reconcile before further provider acquisition;
- avoid recursive collection;
- current accepted Bridge context handles submit slices of at most 25.

25 is a ceiling, not a target.

Among rows passing the Wave-1 gate, deterministic selection order:

1. `blocks_supported_merge_materialization = YES`;
2. material HOLD degree to existing Search anchors descending;
3. total material HOLD degree descending;
4. one-current-SERP HOLD degree descending;
5. query-form class priority:
   `DEMAND_OR_TESTED_EXACT_QUERY` before `NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND`;
6. semantic_identity_id ascending.

If fewer than 25 rows pass, release fewer.

## 11. Provider-release row contract

Every Wave-1 candidate must contain a complete per-query future release contract:

- boundary_query_id;
- semantic_identity_id;
- exact_query_text;
- query_text_source;
- query_form_class;
- open_decision;
- affected_hold_pair_ids;
- affected_material_hold_count;
- affected_anchor_hold_count;
- blocks_supported_merge_materialization;
- why_current_evidence_insufficient;
- expected_incremental_information_gain;
- success_with_results_changes;
- success_with_valid_zero_changes;
- technical_or_incomplete_failure_changes;
- intended_provider;
- intended_mode;
- intended_search_type;
- intended_region;
- intended_page;
- intended_depth;
- intended_group_mode;
- intended_docs_in_group;
- intended_family_mode;
- intended_fix_typo_mode;
- intended_sort;
- max_submit_requests_for_this_query;
- no_blind_retry_rule;
- raw_persistence_path;
- downstream_decision;
- reopen_escalation_condition.

Fixed intended Search context:

```text
provider = Yandex Search API
mode = DEFERRED_ASYNC via Yandex Marketing Bridge after separate release
searchType = SEARCH_TYPE_RU
region = 225
page = 0
groupsOnPage/depth = 100
docsInGroup = 1
groupMode = GROUP_MODE_FLAT
familyMode = FAMILY_MODE_MODERATE
fixTypoMode = FIX_TYPO_MODE_OFF
sortMode = SORT_MODE_BY_RELEVANCE
sortOrder = SORT_ORDER_DESC
```

No provider action is authorized by the Work output itself.

## 12. Outcome semantics for future provider execution

### SUCCESS_WITH_RESULTS

Means:
a valid current RU225 exact-query Search snapshot exists.

It may:
- create a new M9 Search anchor;
- convert affected ONE/NO Search pairs to bilateral/one-sided comparability;
- change merge/split/HOLD evidence.

It does NOT:
- create Wordstat demand;
- directly create a page.

### VALID_ZERO / VALID_NO_RESULTS

Means only:
no result was returned for that exact query in that exact provider context/snapshot.

It does NOT mean:
- zero demand;
- irrelevance;
- SPLIT;
- EXCLUDED.

Default downstream:
retain HOLD unless other accepted evidence resolves it.

### TECHNICAL_FAILURE / UNKNOWN / INCOMPLETE

Semantic effect:
none.

No retry unless separately released.
No replacement query.
No negative evidence inference.

## 13. Post-wave rule

After future Wave-1 provider results are:
- terminal;
- fully persisted;
- remote-readback;
- normalized under the existing Search transport rules;

then:

```text
ADD ACCEPTED NEW CURRENT SEARCH ANCHORS
-> REBUILD CURRENT SEARCH-ANCHOR MAP
-> RERUN COMPLETE M9 5356 PAIR UNIVERSE
-> RERUN CLUSTER CONSTRUCTION
-> RERUN ADVERSARIAL QA
-> ACCEPT NEW M9 AUTHORITY OR HOLD
```

No patch-only recomputation of affected pairs.

M10A remains blocked until the rerun yields retained cluster/singleton authority sufficient for ownership, or a separately accepted persistent-HOLD architecture rule explicitly allows otherwise.

## 14. Exact Work outputs — exactly 9

1. `M9BR_SOURCE_MANIFEST.md`
2. `M9BR_IDENTITY_DISPOSITION.tsv`
3. `M9BR_BOUNDARY_IMPACT_LEDGER.tsv`
4. `M9BR_WAVE1_QUERY_MANIFEST.tsv`
5. `M9BR_DEFERRED_OR_PERSISTENT_HOLD.tsv`
6. `M9BR_PROVIDER_RELEASE_PLAN.tsv`
7. `M9BR_ADVERSARIAL_DIAGNOSTIC.tsv`
8. `M9BR_QA.md`
9. `M9BR_RETURN_MANIFEST.json`

## 15. Row contracts

### Identity disposition

Exactly `104` rows:
- 22 EXISTING_CURRENT_SEARCH_ANCHOR;
- 82 with one of four missing-search dispositions.

### Boundary impact ledger

Exactly `82` rows, one per missing Search identity.

### Wave-1 query manifest

`0..25` rows.
One row per selected exact query.

### Deferred/persistent HOLD

Exactly:
`82 - WAVE1_QUERY_COUNT` rows.

### Provider release plan

Exactly:
`WAVE1_QUERY_COUNT` rows.

## 16. Required QA

```text
M9_ACCEPTANCE = PASS_WITH_HOLD_BOUNDARIES
M9_ELIGIBLE = 104/104
EXISTING_SEARCH_ANCHORS = 22/22
MISSING_CURRENT_SEARCH = 82/82

IDENTITY_DISPOSITION_ROWS = 104/104
BOUNDARY_IMPACT_ROWS = 82/82

MATERIAL_HOLD_RECOMPUTED = 1424/1424
ONE_CURRENT_SERP_HOLD_RECOMPUTED = 396/396
MISSING_IDENTITIES_WITH_ONE_SERP_HOLD = 82/82

WAVE1_QUERY_COUNT <= 25
WAVE1_DUPLICATE_SEMANTIC_ID = 0
WAVE1_DUPLICATE_QUERY_TEXT = 0
WAVE1_REPHRASED_QUERY = 0
WAVE1_PROVIDER_LIMIT_VIOLATION = 0
WAVE1_EXISTING_SEARCH_DUPLICATE = 0
WAVE1_WITHOUT_NAMED_INFO_GAIN = 0

PAGE_TITLE_OR_SOURCE_PHRASE_RELEASED = 0
AMBIGUOUS_QUERY_FORM_RELEASED = 0

PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
ALICE_INPUT_ROWS = 0
M10A_PAGE_OWNERSHIP_DECISIONS = 0

INDEPENDENT_PREACQ_QA = PASS
OPEN_CRITICAL_DEFECTS = 0
```

Also report:
- query-form distribution;
- disposition distribution;
- Wave-1 coverage of material holds;
- Wave-1 coverage of existing-anchor holds;
- how many of the 3 supported merge edges have at least one blocking boundary addressed by Wave 1;
- deferred reason distribution.

## 17. Independent adversarial QA

Must test at minimum:

1. demand-backed wording promoted solely because demand exists;
2. competitor page title accidentally released as query;
3. natural question rejected only because Wordstat missing;
4. query rewritten/rephrased;
5. selected query duplicates existing 22 current anchors;
6. selected query has no named M9 boundary impact;
7. high-degree graph node selected despite title-like query form;
8. supported-merge blockers ignored by deterministic ordering;
9. 25 treated as target rather than ceiling;
10. provider limits silently handled by truncation;
11. M8 non-WORKING identity admitted;
12. Alice/M5 contamination;
13. provider execution attempted inside Work.

If a mechanism defect appears:
`ROOT CAUSE -> AFFECTED 82-IDENTITY UNIVERSE -> FIX -> RERUN ALL 82 -> SIBLING CHANGE REPORT`.

## 18. Stop / HOLD

`HOLD_AUTHORITY_DRIFT`:
M8/M9/Product Truth/governing method changed.

`HOLD_INPUT_IDENTITY`:
required input blob/count differs.

`HOLD_PREACQ_ACCOUNTING`:
104/82/1424/396 counts do not reconcile.

`HOLD_QUERY_SELECTION_CONTRACT_DEFECT`:
query-form or information-gain decision cannot be represented without inventing methodology.

Row-level persistent HOLD is valid.

## 19. Provider / Bridge boundary

Work:
```text
PROVIDER_CALLS = 0
BRIDGE_COMMANDS = 0
WEB_ACQUISITION = 0
```

After Work return Main Chat must:
1. remote-readback and accept/rework;
2. fresh-check current installed Bridge capability;
3. fresh-check exact current tariff;
4. create durable per-query/batch release covering every selected row;
5. remote-readback;
6. only then issue local `start`.

No Search command is released by this preparation.

## 20. Publication

Work returns one ZIP containing exactly 9 files.

Staging:
`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/`

Upload:
`https://github.com/MaksimUnimax/runtime-fixtures/upload/seo/wordstat-batch-01-2026-09-16/docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/`

## 21. Mandatory preparation record

```text
LIVE_HEAD = 440eed8162f84a18e79c9f779194fcdb6e7ad99c
LEVEL1_FILES_READ = PASS
OCTOPORT_STEP_RULES_INDEX_READ = PASS
APPLICABLE_LEVEL2_FILES_READ = PASS
WORK_EVIDENCE_FILES_READ = PASS
FAILURE_HISTORY_READ = PASS
EXTERNAL_SOURCES_CHECKED = PASS
WORK_TRIGGER_DECISION = WORK_REQUIRED

EXACT_INPUTS = FROZEN
EXACT_OUTPUTS = FROZEN
SCHEMA_AND_LINEAGE = FROZEN
QUERY_FORM_CLASSES = FROZEN
INFORMATION_GAIN_GATE = FROZEN
WAVE1_SELECTION_ORDER = FROZEN
PROVIDER_OUTCOME_SEMANTICS = FROZEN
HARD_GATES = FROZEN
STOP_HOLD_REOPEN_RULES = FROZEN
WORK_PROVIDER_POLICY = FROZEN
PUBLICATION_PATH = FROZEN

PROVIDER_EXECUTION_ALLOWED = false
WORK_PROMPT_ALLOWED_BEFORE_REMOTE_READBACK = false
```

After commit + remote readback:
`M9BR_PRE_HANDOFF_ALLOWED = true`.
