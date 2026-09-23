# Octoport SEO — M4Q R2 targeted M4C recheck Main Chat acceptance R1

Date: 2026-09-23
Status: **ACCEPTED WITH TERMINAL ACCESS HOLDS / ADDITIVE M4C OVERLAY**
WORK_ID: `OCTOPORT_SEO_M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1`

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

Work START_HEAD / END_OBSERVED_HEAD:
`bac03ea0c1fcbf517f6eee548750c62e9257d3ad`

## 1. Upload and scope QA

Owner upload delta relative to Work END_OBSERVED_HEAD contained exactly the seven required return paths under:

`docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/`

```text
RETURN_FILES = 7/7
UNEXPECTED_UPLOAD_PATHS = 0
UPSTREAM_AUTHORITY_CHANGED_IN_UPLOAD = 0
```

Frozen target authority:

`docs/seo/serp/competitors/M4Q_R2_TARGETED_M4C_RECHECK_URLS_2026-09-23_R1.tsv`

```text
FROZEN_TARGET_GIT_BLOB = c567aeef24441e2c0e3e05a153dd6bdf33384201
TARGET_ROWS = 59/59
UNIQUE_TARGET_URLS = 59/59
TARGET_REGISTRY_ENTITIES = 12/12
FROZEN_TARGET_SET_EQUAL_TO_RETURN_LEDGER = true
```

## 2. Byte identity QA

Main Chat independently fetched exact uploaded Git blob content and recomputed UTF-8 bytes and SHA-256.

```text
NON_SELF_FILE_BYTES_MATCH = 6/6
NON_SELF_FILE_SHA256_MATCH = 6/6
RETURN_MANIFEST_SELF_HASH_POLICY = VALID
```

Verified:

- SOURCE_MANIFEST:
  `57fc38b17682fceb16e70269cd7ccf87074c81bbb437898297cb0fef2965b367`
- URL_RECHECK_LEDGER:
  `3211eef3405a82a7aa6634042858e60b79a92dbcaaf311f1eb36d94a4d19e285`
- PAGE_EVIDENCE:
  `96d930d02060141a6eb9242c8079121a85359a256ff2fd39e0c4995577b05486`
- CANDIDATE_DELTA:
  `7be0b515c6821188294e2bcb94f16a71b0af050911d33c5f62a48b1b1c797acf`
- M4C_M6_RECONCILIATION:
  `cb10a7aa797a5d9031bd5029327424cb70d5316d312edb0ffbb365aca9d04acf`
- TARGETED_RECHECK_QA:
  `5c326d6cb4214b461984ef1da3e35d383262a08b2e0e01cafe741374570383e4`

## 3. Full-volume terminal accounting

Independent Main Chat parse:

```text
URL_RECHECK_LEDGER_ROWS = 59
UNIQUE_TARGET_IDS = 59
UNIQUE_SOURCE_URLS = 59
UNIQUE_REGISTRY_ENTITIES = 12

INSPECTED = 47
TIMEOUT = 6
ROBOTS_OR_ACCESS_BLOCKED = 6
TERMINAL_ACCOUNTING = 59/59

CONTENT_AVAILABLE_TRUE = 47
CONTENT_AVAILABLE_FALSE = 12

SILENT_TARGET_LOSS = 0
UNAUTHORIZED_URL_EXPANSION = 0
BROAD_FRONTIER_EXPANSION = 0
```

The 12 inaccessible targets remain explicit terminal states. They do not erase accepted durable M4C history.

Browser limitations are accepted as explicitly declared:

```text
RELIABLE_HTTP_STATUS_NOT_EXPOSED = true
INTERMEDIATE_REDIRECT_HOPS_NOT_EXPOSED = true
```

No fabricated 403/404/redirect chain is accepted.

## 4. Page-evidence and candidate QA

```text
PAGE_EVIDENCE_ROWS = 47
PAGE_TARGET_IDS_UNIQUE = 47
PAGE_ROWS_WITH_NON_INSPECTED_TARGET = 0

CANDIDATE_DELTA_ROWS = 133
CANDIDATE_TARGET_IDS_SUBSET_OF_PAGE_EVIDENCE = true

ALREADY_PRESENT = 14
NEW_CANDIDATE = 64
POSSIBLE_VARIANT = 19
OUT_OF_SCOPE = 24
AMBIGUOUS = 12
CANDIDATE_STATUS_ACCOUNTING = 133/133
```

Main Chat independently checked each candidate's `raw_candidate_text` against the corresponding current page title/H1/headings:

```text
CANDIDATE_SOURCE_TEXT_FOUND = 133/133
MISSING_CANDIDATE_SOURCE_TEXT = 0
```

Therefore the candidate delta is grounded in captured page evidence rather than generated wording.

`NEW_CANDIDATE` remains competitor wording only and is not demand authority.

## 5. Canonical/current page identity observations

```text
DECLARED_CANONICAL_EXACT_ACCEPTED_M4C_URL = 8
NO_ACCEPTED_FINAL_OR_CANONICAL_URL_MATCH = 39
NOT_ASSESSABLE_FROM_CURRENT_CONTENT = 12
```

Canonical equivalence is treated only as current page identity evidence, not as a new independent page when it resolves to an already accepted M4C identity.

## 6. M4C target-level effects

Independent reconciliation:

```text
ADD_CURRENT_URL_AND_PAGE_EVIDENCE = 36
ADD_CURRENT_PAGE_EVIDENCE = 6
NO_MATERIAL_CHANGE = 2
OUT_OF_SCOPE = 3
TARGET_INACCESSIBLE_KEEP_DURABLE_HISTORY = 12
TOTAL = 59

M4C_CHANGED_TARGETS = 42
M4C_NO_MATERIAL_CHANGE_TARGETS = 2
M4C_TERMINAL_ACCESS_HOLD_TARGETS = 12
M4C_OUT_OF_SCOPE_TARGETS = 3
M4C_FORCED_HOLD_CLASS = 0
```

The accepted original M4C corpus is not rewritten. This return becomes an additive current evidence overlay.

## 7. M6 routing boundary

Target-level M6 effects:

```text
ADD_NEW_CANDIDATE_FOR_LATER_VALIDATION = 29 targets
KEEP_EXISTING_VALIDATION_ROUTE = 11 targets
NO_CHANGE = 7 targets
HOLD = 12 inaccessible targets
```

Candidate-level new wording:

```text
NEW_CANDIDATE_ROWS = 64
POSSIBLE_VARIANT_ROWS = 19
```

No Wordstat/Search/Alice provider call is authorized by this acceptance.

```text
SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_PAGE_TOPIC_AS_DEMAND = 0
COMPETITOR_CLAIM_AS_OCTOPORT_FACT = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0
```

## 8. M4 current authority after R2 enrichment

```text
M4A = ACCEPTED
M4B1 = ACCEPTED
M4B2 = ACCEPTED

M4Q_R2_PASS_B = ACCEPTED_WITH_EXPLICIT_IDENTITY_HOLDS
M4Q_KNOWN_QUERY_TOP100_ENRICHMENT = COMPLETE_FOR_45_FROZEN_QUERIES
M4Q_ARBITRARY_DOMAIN_TO_UNKNOWN_QUERY_RECALL = LIMITATION_ACTIVE

M4C_R1 = ACCEPTED
M4Q_R2_TARGETED_M4C_RECHECK = ACCEPTED_WITH_TERMINAL_ACCESS_HOLDS

CURRENT_M4_AUTHORITY =
  ACCEPTED_M4C_R1
  + ACCEPTED_M4Q_R2_VISIBILITY_OVERLAY
  + ACCEPTED_59_URL_TARGETED_M4C_OVERLAY

OPEN_CRITICAL_DEFECTS = 0
```

The 74 Pass B sibling-host identity holds remain explicit and unresolved; they do not become forced registry matches.

## 9. Roadmap decision

Current M5 authority states:

```text
M5 = AI DIAGNOSTIC HYPOTHESIS REGISTER ONLY
INPUT = ACCEPTED M3/M4 EVIDENCE
AI_PROVIDER_CALLS = 0
FINAL_AI_CASE_SELECTION = LATER, AFTER M10A SEARCH-ONLY BASELINE
```

The 12 terminal access holds are not a reason to block provisional M5 hypotheses because:
- all 59 targets are terminally accounted;
- accepted durable M4C history is preserved;
- M5 creates hypotheses only and does not acquire AI evidence or make page/cluster decisions.

Therefore:

```text
M4 = CURRENT / ACCEPTED WITH EXPLICIT BOUNDED HOLDS
M5 = RELEASED FOR PREPARATION / NO PROVIDER
M6 = BLOCKED UNTIL M5 HYPOTHESIS REGISTER IS ACCEPTED
M7 = BLOCKED
```

NEXT:
build the current full-volume M5 AI diagnostic hypothesis register from accepted M3/M4 authority, including the accepted R2 overlays.
