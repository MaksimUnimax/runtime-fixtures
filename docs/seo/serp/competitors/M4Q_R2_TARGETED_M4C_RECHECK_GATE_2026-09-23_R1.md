# Octoport SEO — M4Q R2 targeted M4C recheck gate R1

Date: 2026-09-23
Status: **PREPARED / EXACT 59-URL TARGET SET FROZEN / WORK REQUIRED**
WORK_ID: `OCTOPORT_SEO_M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1`

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation base HEAD: `94140eab7fa23b634d48cfacff1f68b90f8e08cd`

## 1. Why this recheck exists

M4Q R2 Pass B is accepted with explicit identity holds.

Main Chat independently confirmed:

```text
CURRENT_TOP20_VENDOR_URL_OCCURRENCES_OUTSIDE_ACCEPTED_M4C = 87
UNIQUE_CURRENT_TOP20_VENDOR_URLS_OUTSIDE_ACCEPTED_M4C = 59
AUTHORIZED_ENTITIES_AFFECTED = 12
TARGET_URLS_ALREADY_PRESENT_IN_M4C_URL_LEDGER = 0
TARGET_URLS_ABSENT_CONFIRMED = 59/59
```

These URLs are current Yandex top-20 ranking pages for already-authorized M4C entities and therefore contain incremental page-level evidence that may enrich accepted M4C context.

They do not prove demand.

This is a targeted dependency recheck, not a new broad competitor crawl.

## 2. Frozen target authority

Exact target file:

`docs/seo/serp/competitors/M4Q_R2_TARGETED_M4C_RECHECK_URLS_2026-09-23_R1.tsv`

Git blob:

`c567aeef24441e2c0e3e05a153dd6bdf33384201`

Required:

```text
TARGET_ROWS = 59
UNIQUE_TARGET_URLS = 59
TARGET_REGISTRY_ENTITIES = 12
```

No additional URL may be added by Work except a direct redirect/final/canonical target belonging to one of these 59 fetches.

## 3. Governing authority

Read current:

- docs/seo/LEVEL1/README.md
- docs/seo/EXECUTION_RULES.md
- docs/seo/WORK_HANDOFF_RULE.md
- docs/seo/QUALITY_FIRST_RESOURCE_RULE.md
- docs/seo/PRODUCT_TRUTH.md
- docs/seo/METHODOLOGY.md
- docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md
- docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md
- docs/seo/serp/competitors/M4Q_R2_PASS_B_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md
- docs/seo/serp/competitors/M4Q_R2_TARGETED_M4C_RECHECK_URLS_2026-09-23_R1.tsv
- docs/seo/serp/competitors/M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md
- accepted M4C return files required for URL/candidate reconciliation
- accepted Pass B return files

## 4. Exact scope

For each of the 59 frozen URLs:

1. fetch the exact public URL;
2. follow legitimate redirects;
3. record terminal status;
4. record final URL and declared canonical where available;
5. inspect current public page content if accessible;
6. classify page role/content relevance under current M4 method;
7. compare page/current URL to accepted M4C URL/page evidence;
8. extract only evidence-supported candidate terms/use cases from this exact page;
9. reconcile candidate terms to accepted M4C candidate register;
10. determine whether the page materially changes M4C/M6 context.

Do not recursively crawl child links.

Ordinary body links, recommendations, sitewide navigation and unrelated pages are not new frontier authority for this task.

## 5. Explicitly out of scope

```text
NEW YANDEX SEARCH CALLS = FORBIDDEN
WORDSTAT = FORBIDDEN
ALICE = FORBIDDEN
DOMAIN->UNKNOWN-QUERY DISCOVERY = FORBIDDEN
BROAD M4B FRONTIER REOPEN = FORBIDDEN
SIBLING-HOST IDENTITY HOLD RESOLUTION = NOT PART OF THIS TASK
FINAL CLUSTERING = FORBIDDEN
FINAL PAGE OWNERSHIP = FORBIDDEN
FINAL URL/H1/TITLE/IA = FORBIDDEN
```

The 74 accepted sibling-host identity HOLD rows remain unchanged by this recheck.

## 6. Public-access rules

Use only legitimately accessible public surfaces.

Never bypass:
- login;
- CAPTCHA;
- robots/access controls;
- anti-bot controls;
- paywalls;
- private APIs.

Allowed terminal states include:

```text
INSPECTED
REDIRECT_IN_SCOPE
REDIRECT_OUT_OF_SCOPE
NOT_FOUND
HTTP_ERROR
ROBOTS_OR_ACCESS_BLOCKED
AUTH_REQUIRED
CAPTCHA_OR_ANTIBOT
TIMEOUT
NON_HTML
DYNAMIC_UNRESOLVED
OTHER_EXPLICIT_TERMINAL
```

Every one of 59 targets must reach exactly one terminal accounting state.

## 7. Fresh-current versus durable-history rule

A current access failure does not erase durable accepted M4C history.

If current target fetch fails but accepted durable content/evidence exists elsewhere for the entity:

```text
CURRENT_FAILURE != HISTORICAL_CONTENT_DELETION
```

This targeted recheck is additive.

## 8. Candidate/demand boundary

Any extracted candidate wording remains competitor-page evidence only.

```text
CURRENT_RANKING_PAGE_TOPIC != WORDSTAT_DEMAND
CURRENT_RANKING_PAGE_TOPIC != OCTOPORT_PRODUCT_FACT
NORMALIZED_KEY_MATCH != SEMANTIC_IDENTITY_PROOF
```

Candidate statuses must include explicit conservative states such as:

`ALREADY_PRESENT | NEW_CANDIDATE | POSSIBLE_VARIANT | OUT_OF_SCOPE | AMBIGUOUS`.

Only genuinely new eligible candidate rows may be proposed for M6 validation routing; they are not demand-validated.

## 9. Work trigger

```text
WORK_TRIGGER = MET
```

Reason:
59 live public pages plus current M4C URL/page/candidate joins and full candidate reconciliation create a multi-file full-volume task. Sampling or ordinary-chat first-N processing is forbidden.

## 10. Required outputs — exactly 7

1. `M4Q_R2_TARGETED_M4C_SOURCE_MANIFEST.md`
2. `M4Q_R2_TARGETED_URL_RECHECK_LEDGER.tsv`
3. `M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv`
4. `M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv`
5. `M4Q_R2_TARGETED_M4C_M6_RECONCILIATION.tsv`
6. `M4Q_R2_TARGETED_RECHECK_QA.md`
7. `M4Q_R2_TARGETED_RECHECK_RETURN_MANIFEST.json`

## 11. Mandatory QA

At minimum:

```text
FROZEN_TARGET_BLOB_MATCH = true
TARGET_ROWS = 59/59
UNIQUE_TARGET_URLS = 59/59
TARGETS_TERMINAL_ACCOUNTED = 59/59
SILENT_TARGET_LOSS = 0
UNAUTHORIZED_URL_EXPANSION = 0
BROAD_FRONTIER_EXPANSION = 0

INSPECTED_OR_CONTENT_AVAILABLE =
INACCESSIBLE_OR_OTHER_TERMINAL =

CANDIDATE_ROWS =
NEW_CANDIDATE_ROWS =
ALREADY_PRESENT_ROWS =
POSSIBLE_VARIANT_ROWS =
OUT_OF_SCOPE_ROWS =
AMBIGUOUS_ROWS =

SEARCH_VISIBILITY_AS_DEMAND = 0
COMPETITOR_PAGE_TOPIC_AS_DEMAND = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0

YANDEX_SEARCH_CALLS = 0
WORDSTAT_CALLS = 0
ALICE_CALLS = 0
GITHUB_WRITES = 0
```

## 12. Publication

Work must not write to GitHub.

Return one downloadable ZIP containing exactly the seven required outputs.

Owner uploads all seven unpacked files together to:

`docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/`

Main Chat then performs independent remote readback / QA.

## 13. Cursor

```text
M4Q_R2_PASS_B = ACCEPTED_WITH_EXPLICIT_IDENTITY_HOLDS
M4C = ACCEPTED_BUT_TARGETED_R2_RECHECK_REQUIRED
M5 = PAUSED
M6 = NOT_STARTED
M7 = BLOCKED

NEXT = WORK TARGETED RECHECK OF EXACTLY 59 FROZEN CURRENT TOP20 VENDOR URLS
```
