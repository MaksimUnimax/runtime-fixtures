# M4Q R2 — complete local QA and return boundary

WORK_ID: `OCTOPORT_SEO_M4Q_R2_QUERY_MANIFEST_2026-09-23_R1`  
START_HEAD: `c5b001e389640f67c495ed3b631a551eb3309131`  
END_OBSERVED_HEAD: `c5b001e389640f67c495ed3b631a551eb3309131`  
AUTHORITY_DRIFT_STATUS: `NONE`  
VERDICT: `PASS_QUERY_MANIFEST_WITH_TERMINAL_HOLDS`

## Reconciliation

| Preparation status | Source rows |
|---|---:|
| `SEARCH_REQUIRED` | 372 |
| `SEARCH_REQUIRED_CONTROL_REFRESH` | 15 |
| `ALREADY_COVERED_CURRENT_NO_REQUERY` | 0 |
| `NO_INCREMENTAL_SEARCH_INFORMATION_GAIN` | 5,417 |
| `NOT_A_PLAUSIBLE_SEARCH_QUERY` | 716 |
| `OUT_OF_PRODUCT_SCOPE` | 4,556 |
| `PROVIDER_LIMIT_INVALID` | 0 |
| `HOLD_AMBIGUOUS` | 4,034 |
| `EXACT_DUPLICATE_OF_EXECUTION_QUERY` | 432 |
| **TOTAL** | **15,542** |

`SEARCH_REQUIRED_ROWS = 372`; `SEARCH_REQUIRED_CONTROL_REFRESH_ROWS = 15`. Exactly 387 unique exact-safe queries occupy one complete deterministic batch of 387 (< 500). The 15 M3 controls sort before ordinary queries solely for stable planning order.

| QA assertion | Result |
|---|---|
| LIVE_BRANCH_FETCHED | true (start and end, same `c5b001e389640f67c495ed3b631a551eb3309131`) |
| FROZEN_AUTHORITY_BLOBS_MATCH | 18/18 |
| UNLISTED_INPUT_FILES_USED | 0 |
| PROVIDER_CALLS / WEB_ACQUISITION_BY_WORK / YANDEX_SEARCH_EXECUTION / WORDSTAT_EXECUTION / ALICE_EXECUTION | 0 / 0 / 0 / 0 / 0 |
| M2R_LINEAGE_ROWS_ACCOUNTED | 1123/1123 |
| M3_QUERY_ROWS_ACCOUNTED | 15/15 |
| M4C_CANDIDATE_OCCURRENCES_ACCOUNTED | 8431/8431 |
| M4C_M6_GROUPS_ACCOUNTED | 5973/5973 |
| AUTHORIZED_COMPETITORS | 60; M4A/M4C registry/coverage ID sets match |
| SOURCE_UNIVERSE_ROWS / UNIQUE_EXACT_SAFE_QUERY_KEYS | 15542 / 7787 |
| SILENT_SOURCE_LOSS / EXECUTION_QUERY_EXACT_DUPLICATES / SYNTHETIC_QUERIES_CREATED | 0 / 0 / 0 |
| PROVIDER_LIMIT_VIOLATIONS_IN_EXECUTION_MANIFEST | 0 (max 129 characters, 17 words) |
| EVERY_EXECUTION_QUERY_HAS_INFORMATION_GAIN / HAS_PROVENANCE / IN_EXACTLY_ONE_BATCH | true / true / true |
| BATCH_QUERY_COUNT_MAX / ALL_UNIVERSE_ROWS_TERMINAL / DISPOSITION_COUNTS_RECONCILE | 387 / true / true |
| FINAL_CLUSTER_DECISIONS / FINAL_PAGE_OWNERSHIP_DECISIONS / FINAL_URL_H1_TITLE_DECISIONS | 0 / 0 / 0 |
| COMPETITOR_TOPIC_AS_PROVEN_DEMAND / OPEN_CRITICAL_DEFECTS | 0 / 0 |
| GITHUB_WRITES | 0 |

## Independent full-volume checks

A second verifier read the completed TSVs and all four original source universes independently of the producer's in-memory tables. It confirmed each original M3 phrase, all 1,123 M2R phrases and locators, every M4C occurrence ID/text, every M6 group ID plus its contributing IDs and chosen literal occurrence, 18 source hashes, 60 competitor identities, all universe keys/statuses/reasons, all execution-to-source links (including formerly rejected rows with an identical text), all provider limits and exact query provenance, ordered IDs, and exact batch partition. Full physical-line width and parser consistency were checked. There were no missing group references or orphan execution rows.

## Semantic adversarial correction

The first complete classification surfaced false-positive news headlines, unrelated third-party integrations, human-profession phrases, automated advertising/pricing actions and extraction fragments. The selection mechanism was narrowed and rerun over all 15,542 rows. A second inspection of randomly selected execution rows and targeted news/write/external-intelligence/brand strata identified more overinclusive cases; rules were corrected globally and rerun, not patched per row. Unproven external niche/competitor intelligence and seller operation tasks remain HOLD for capability/intent evidence. These 4,034 terminal HOLD rows are not commands and preserve their source text for Main Chat review. A HOLD does not imply zero demand or zero visibility.

`PROVIDER_LIMIT_INVALID = 0` for the representative exact source phrases: five M6 *raw_examples* aggregates exceed the hard limit but were never used as commands; their exact supporting occurrences were assessed individually. No truncation or paraphrase was used.

The one planned batch is not a provider command. Before release, Main Chat must independently QA this archive after upload, inspect the terminal HOLD/routing decisions and verify current Bridge surface, price, lifecycle and raw evidence persistence. The second visibility-matrix Work pass follows **only** accepted provider evidence.
