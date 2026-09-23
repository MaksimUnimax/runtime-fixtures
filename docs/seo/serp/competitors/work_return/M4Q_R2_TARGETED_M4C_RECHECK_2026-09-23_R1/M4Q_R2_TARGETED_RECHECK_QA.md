# M4Q R2 targeted M4C recheck — independent QA

WORK_ID: `OCTOPORT_SEO_M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1`  
START_HEAD: `bac03ea0c1fcbf517f6eee548750c62e9257d3ad`  
END_OBSERVED_HEAD: `bac03ea0c1fcbf517f6eee548750c62e9257d3ad`  
AUTHORITY_DRIFT_STATUS: `NONE`  
VERDICT: `PASS_TARGETED_RECHECK_WITH_TERMINAL_ACCESS_HOLDS`

## Frozen-target and complete terminal accounting

```text
LIVE_BRANCH_FETCHED = true
FROZEN_TARGET_BLOB_MATCH = true
FROZEN_TARGET_GIT_BLOB = c567aeef24441e2c0e3e05a153dd6bdf33384201
TARGET_ROWS = 59/59
UNIQUE_TARGET_URLS = 59/59
TARGET_REGISTRY_ENTITIES = 12/12
TARGETS_TERMINAL_ACCOUNTED = 59/59
SILENT_TARGET_LOSS = 0
DUPLICATE_TARGET_IDS = 0
SOURCE_PASS_B_TOP20_OCCURRENCES = 87/87
SOURCE_URLS_EXACT_IN_ACCEPTED_M4C = 0/59
UNAUTHORIZED_URL_EXPANSION = 0
BROAD_FRONTIER_EXPANSION = 0
```

All 59 targets were directly attempted once. No source row disappeared because access failed. Zero arbitrary child links, no alternate host guesses, and no sibling-host identity changes.

## Access outcomes — statuses are observed, HTTP status is not inferred

```text
INSPECTED = 47
REDIRECT_TERMINAL = 0
NOT_FOUND = 0
HTTP_ERROR = 0
ROBOTS_OR_ACCESS_BLOCKED = 6
AUTH_REQUIRED = 0
CAPTCHA_OR_ANTIBOT = 0
TIMEOUT = 6
NON_HTML = 0
DYNAMIC_UNRESOLVED = 0
OTHER_TERMINAL = 0
ACCESS_ACCOUNTING = 59/59
HTTP_STATUS_NOT_EXPOSED_BY_BROWSER = 59/59
REDIRECT_INTERMEDIATE_HOPS_NOT_EXPOSED_BY_BROWSER = 59/59
```

The six `mpstats.io` blocked pages say only that access to the resource was blocked and provide a support ID; no unsupported anti-bot/CAPTCHA cause is asserted. Five `mpmgr.ru` and one `wildcrm.ru` exact navigations timed out. Their prior accepted M4C historical entity/page content is retained, never replaced by inaccessible current text.

## Fresh page and candidate evidence

```text
PAGE_EVIDENCE_ROWS = 47
CANDIDATE_DELTA_ROWS = 133
ALREADY_PRESENT = 14
NEW_CANDIDATE = 64
POSSIBLE_VARIANT = 19
OUT_OF_SCOPE = 24
AMBIGUOUS = 12
CANDIDATE_STATUS_RECONCILIATION = 133/133
EXACT_ACCEPTED_CANONICAL_EQUIVALENCES = 8
```

One page row exists for each of the 47 legitimately accessible targets. Every one of the 133 candidate phrases was independently checked against the captured exact target H1 or heading and its exact-safe key recomputed. The complete visible text is available in the page table so Main Chat can audit qualification, context and omissions. `NEW_CANDIDATE` counts new exact wording, not independent user demand, provider-ready queries, new target pages, or separate product capabilities.

## M4C/M6 target-level effects

```text
M4C_NO_MATERIAL_CHANGE = 2
M4C_ADD_CURRENT_URL_EVIDENCE = 0
M4C_ADD_CURRENT_PAGE_EVIDENCE = 6
M4C_ADD_CURRENT_URL_AND_PAGE_EVIDENCE = 36
M4C_TARGET_INACCESSIBLE_KEEP_DURABLE_HISTORY = 12
M4C_OUT_OF_SCOPE = 3
M4C_HOLD = 0
M4C_CHANGE_CLASS_ACCOUNTING = 59/59
M4C_CHANGED_TARGETS = 42
M4C_NO_MATERIAL_CHANGE_TARGETS = 2
M4C_HOLD_TARGETS = 12
M6_NEW_CANDIDATE_TARGETS = 31
```

Eight current rankings map through declared canonical URLs to old M4C pages; 2 title/H1 pairs match accepted evidence, 6 add current page detail. Three pages are out-of-scope content observations; no content relevance is promoted to Octoport capability. The 31 new-candidate targets are page-wording review inputs only, with later M6 validation routes and no immediate provider calls.

## Claim boundaries and execution

```text
SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_PAGE_TOPIC_AS_DEMAND = 0
COMPETITOR_CLAIM_AS_OCTOPORT_FACT = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
FINAL_URL_H1_TITLE_DECISIONS = 0
YANDEX_SEARCH_CALLS = 0
WORDSTAT_CALLS = 0
ALICE_CALLS = 0
GITHUB_WRITES = 0
```

An independent local verifier reread all 59 original target rows and the recorded page observations, proved 59 unique terminal rows and 47 current page rows, cross-checked all 133 candidate phrases against the original rendered H1/heading text, and recomputed status counts and per-target delta joins. `INDEPENDENT_TARGET_QA = PASS`. The final seven-file ZIP is separately checked for exact membership, tab widths, row counts and return-manifest hashes.
