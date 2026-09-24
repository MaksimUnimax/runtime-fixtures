# Octoport SEO — M9 boundary-resolution pre-acquisition Main Chat acceptance — 2026-09-24 R1

WORK_ID: `OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1`

Status: **PASS_PREACQ / ACCEPTED PLANNING AUTHORITY**
Branch: `seo/wordstat-batch-01-2026-09-16`
FROZEN_WORK_START_HEAD: `3903b57bf9bd64b2b06e79d74f30cd936c5dceb7`
OWNER_UPLOAD_HEAD: `1e5f90c8587385e198df62ea2aed5bdab3ad9c43`

## 1. Publication and authority drift

Staging:
`docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/`

Required files = 9.
Published files = 9.
Extra staging files = 0.

Git compare from frozen Work start HEAD to owner-upload HEAD:
- ahead by 1 commit;
- exactly the 9 required return files were added;
- no frozen M8/M9 authority/source file changed.

```text
PUBLICATION_MEMBERSHIP_GATE = PASS
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED
```

## 2. Return-manifest integrity

Main Chat independently recomputed SHA-256 and byte/line counts for all eight non-self outputs.

```text
RETURN_MANIFEST_NONSELF_HASH_MATCH = 8/8
RETURN_MANIFEST_NONSELF_BYTE_MATCH = 8/8
RETURN_MANIFEST_NONSELF_LINE_MATCH = 8/8
```

## 3. Frozen M9 universe reconciliation

Main Chat independently read the frozen M8/M9 Git blobs and recomputed the current universe.

```text
M9_ELIGIBLE = 104/104
EXISTING_CURRENT_SEARCH_ANCHORS = 22/22
MISSING_CURRENT_EXACT_SERP = 82/82
PAIRWISE_ROWS = 5356/5356
HOLD_BOUNDARY = 1518/1518
MATERIAL_HOLD = 1424/1424
ONE_CURRENT_SERP_HOLD = 396/396
H_ONE_SERP_INSUFFICIENT = 150/150
```

Material HOLD composition independently recomputed:

```text
anchor-anchor = 47
anchor-missing = 371
missing-missing = 1006
```

The exact 1,424 material pair IDs match the accepted M9 HOLD ledger.

## 4. Boundary-impact ledger

```text
IDENTITY_DISPOSITION_ROWS = 104/104
BOUNDARY_IMPACT_ROWS = 82/82
MISSING_IDENTITY_SET_MATCH = 82/82
```

For every one of the 82 missing-current-Search identities, Main Chat independently recomputed from the frozen 5,356-pair universe:
- HOLD pair degree;
- material HOLD degree;
- one-current-SERP HOLD degree;
- material-HOLD-to-existing-anchor degree;
- no-current-SERP material HOLD degree;
- H_ONE_SERP_INSUFFICIENT degree;
- H_MIXED_INTENT_BOUNDARY degree;
- H_GENERIC_SPECIFIC_UNRESOLVED degree;
- H_SEARCH_EVIDENCE_CONFLICT degree.

```text
BOUNDARY_IMPACT_DEGREE_MISMATCH = 0
```

## 5. Query-form and disposition reconciliation

Observed query-form classes for the 82 missing identities:

```text
DEMAND_OR_TESTED_EXACT_QUERY = 33
NATURAL_EXACT_SEARCH_PROBE_NO_DEMAND = 11
PAGE_TITLE_OR_SOURCE_PHRASE = 33
AMBIGUOUS_QUERY_FORM = 5
TOTAL = 82
```

Observed dispositions:

```text
EXISTING_CURRENT_SEARCH_ANCHOR = 22
WAVE1_SEARCH_CANDIDATE = 25
DEFER_SEARCH_CANDIDATE = 19
PERSISTENT_HOLD_NO_EXACT_QUERY_PROBE = 33
QUERY_FORM_AMBIGUOUS_HOLD = 5
TOTAL = 104
```

## 6. Wave-1 release-candidate checks

Main Chat independently checked all 25 Wave-1 rows.

```text
WAVE1_QUERY_COUNT = 25
WAVE1_DUPLICATE_SEMANTIC_ID = 0
WAVE1_DUPLICATE_QUERY_TEXT = 0
WAVE1_REPHRASED_QUERY = 0
WAVE1_EXISTING_SEARCH_DUPLICATE = 0
WAVE1_PROVIDER_LIMIT_VIOLATION = 0
PAGE_TITLE_OR_SOURCE_PHRASE_RELEASED = 0
AMBIGUOUS_QUERY_FORM_RELEASED = 0
```

Every selected `exact_query_text` equals the frozen M8 `canonical_display_text` exactly.
Unicode codepoint and whitespace-delimited word counts were independently recomputed.
All 25 rows pass the 400-character / 40-word provider precheck.

The deterministic ordering was independently rebuilt across all 44 releasable exact candidates using the frozen rule:
1. supported-merge blocker first;
2. material anchor-HOLD degree descending;
3. material HOLD degree descending;
4. one-current-SERP HOLD degree descending;
5. demand/tested exact before natural no-demand;
6. semantic identity ID ascending.

```text
WAVE1_DETERMINISTIC_ORDER = PASS
WAVE1_TOP25_MATCH = 25/25
```

## 7. Provider release plan

Provider-plan rows = 25/25 and join 1:1 to the Wave-1 manifest.

All 25 freeze:
- Yandex Search API;
- DEFERRED_ASYNC via Yandex Marketing Bridge after a separate Main Chat release;
- SEARCH_TYPE_RU;
- region 225;
- page 0;
- depth 100;
- GROUP_MODE_FLAT;
- docsInGroup 1;
- FAMILY_MODE_MODERATE;
- FIX_TYPO_MODE_OFF;
- relevance descending sort;
- maximum one submit request per exact query after explicit release;
- no blind automatic resubmit.

```text
PROVIDER_PLAN_JOIN = PASS
PROVIDER_PLAN_CONTEXT = PASS
NO_BLIND_RETRY_RULE = PASS
```

## 8. Work execution boundary

Return manifest and QA state:

```text
PROVIDER_CALLS = 0
BRIDGE_COMMANDS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES_BY_WORK = 0
ALICE_INPUT_ROWS = 0
M10A_PAGE_OWNERSHIP_DECISIONS = 0
OPEN_CRITICAL_DEFECTS = 0
```

## 9. Acceptance verdict

```text
MAIN_CHAT_RETURN_QA = PASS
VERDICT = PASS_PREACQ_ACCEPTED
M9_R2_BOUNDED_AUTHORITY = PRESERVED
M10A = BLOCKED
```

This acceptance authorizes the Wave-1 candidate plan only. It does **not** authorize a Bridge lifecycle command or a paid provider call.

## 10. Mandatory next gate

Before any `start`, `submitN`, or other Bridge lifecycle command:

1. recheck the current installed Yandex Marketing Bridge package/capability;
2. freshly verify official Yandex Search API deferred-search contract and current tariff;
3. freeze the exact per-query/provider release and cost cap;
4. persist the release artifact;
5. remote-readback that artifact;
6. only then issue the first Bridge lifecycle command.

After future terminal Search evidence is persisted and read back, rebuild the Search-anchor map and rerun the complete 5,356-pair M9 universe and clusters. No partial pair patch. M10A remains blocked until that rerun is accepted or a separately accepted persistent-HOLD architecture rule exists.
