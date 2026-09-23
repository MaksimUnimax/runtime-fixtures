# M4Q R2 — frozen-source and derivation manifest

WORK_ID: `OCTOPORT_SEO_M4Q_R2_QUERY_MANIFEST_2026-09-23_R1`  
START_HEAD: `c5b001e389640f67c495ed3b631a551eb3309131`  
END_OBSERVED_HEAD: `c5b001e389640f67c495ed3b631a551eb3309131`  
AUTHORITY_DRIFT_STATUS: `NONE`  
VERDICT: `PASS_QUERY_MANIFEST_WITH_TERMINAL_HOLDS`  

Live branch was fetched at start and before return. All 18 required Git blobs match. Only the frozen files below were used as analytical inputs. `M4_PROGRESS.md` and the released reopen gate were read for current governing context; no unlisted file supplied a query or competitor entity. No provider/web/Wordstat/Alice acquisition occurred and no GitHub write occurred.

| # | class | source path | verified Git blob SHA-1 |
|---:|---|---|---|
| 1 | `RULE` | `docs/seo/LEVEL1/README.md` | `4c3a30644ac736b926ec82bba6b1a6e33434ac06` |
| 2 | `RULE` | `docs/seo/EXECUTION_RULES.md` | `4e999af4826d6f72fd15f481a698f674c8ed2d5c` |
| 3 | `RULE` | `docs/seo/WORK_HANDOFF_RULE.md` | `71a031e74b921dade5998beb842fb3afcc4478e7` |
| 4 | `RULE` | `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md` | `9917a52b837bcb8ae50eb63cc53e7becd1671b39` |
| 5 | `PRODUCT` | `docs/seo/PRODUCT_TRUTH.md` | `6a469d5743142d3e476afa5d2cda653fd411ecb8` |
| 6 | `RULE` | `docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md` | `3ef9e456dd724500f1b4068236a80211d1fb69be` |
| 7 | `RULE` | `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md` | `598a248c459b705ac9b7a0e53a86870733d6f379` |
| 8 | `DEMAND` | `docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv` | `9343048ed82f129b3f7433c46899e6f255a420a8` |
| 9 | `DEMAND` | `docs/seo/work/M2R_FULL_VOLUME_RECONCILIATION_2026-09-17.md` | `f850699a095ba480451b117b9ff0ba357d9e7488` |
| 10 | `SERP` | `docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md` | `0d43a40a8d5c865f2078a4f6f2a01815cd9b415f` |
| 11 | `AUTHORITY` | `docs/seo/serp/competitors/M4Q_R1_SOURCE_LIMITATION_ACCEPTANCE_2026-09-22.md` | `c51cdabdaee86b87b9fb7ee023d5bf9221607fc8` |
| 12 | `AUTHORITY` | `docs/seo/serp/competitors/M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md` | `8b8f075052f03511e6d0b831a3688e65da488f7d` |
| 13 | `COMPETITOR` | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_COMPETITOR_REGISTRY.tsv` | `822155d7cebcbcf5cf8cdaef0f92782d5f84cd59` |
| 14 | `COMPETITOR` | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_HARDENED_COMPETITOR_REGISTRY.tsv` | `43ce2150686b1b1df33ddb947b8a6920ebb2f112` |
| 15 | `COMPETITOR` | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COVERAGE_LEDGER.tsv` | `e308aac9ade959c3a4faebb7c391ea3d25c7c7f4` |
| 16 | `CANDIDATE` | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COMPETITOR_CANDIDATE_REGISTER.tsv` | `93debb9c20c2f6df6d146e018e9b5afa96350124` |
| 17 | `CANDIDATE` | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_M6_DEMAND_GAP_CANDIDATES.tsv` | `345b1aa7c1aac4f283b3d36361aa33cad369e267` |
| 18 | `MANIFEST` | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_RETURN_MANIFEST.json` | `5b4ff58d82a08bc5846f6291f41acedaf19037e1` |

## Source universe and exact wording

| Source | Physical data rows | Locator / exact phrase |
|---|---:|---|
| M3 accepted query matrix | 15 | `S01–S03`, `R01–R12` heading and backticked phrase |
| M2R lineage ledger | 1,123 | Original physical CSV data line, `raw_phrase`; BOM-aware CSV header |
| M4C competitor candidate register | 8,431 | `m4c_candidate_occurrence_id`, `raw_term_short` |
| M4C M6 demand-gap groups | 5,973 | `m6_candidate_id` and exact `raw_term_short` of a listed contributing occurrence |
| **Total** | **15,542** | One accounting row per source row; **7,787** distinct exact-safe keys |

The M4C TSVs were parsed by physical newline and literal TAB with quotes treated as ordinary field text (`QUOTE_NONE`). M6 groups join to all 7,200 contributing candidate references; nine groups include more than one distinct literal wording. Their ledger row uses an exact supporting occurrence phrase, while `source_raw_examples` and `supporting_candidate_occurrence_ids` retain every original wording/reference. Group labels, normalized group keys and page headings were never rewritten into executable queries.

Comparison-only key: Unicode NFC → trim outer whitespace → collapse internal whitespace → Unicode case-fold. The exact executable phrase remains verbatim from one original row. This key never implies semantic equivalence; ё and е remain distinct. When any key executes, **every** source row with that key is linked to the execution ID. The extra `underlying_row_fit_before_exact_dedupe` field preserves each duplicate row's own earlier semantic disposition.

## Disposition and question

M3 top-20 observations dated 2026-09-16/17 receive current top-100 control refresh. Other observed seller-owned data/report, supported own-LLM connection and bounded card-description/check tasks enter Search only if their exact wording can test whether a member of the frozen 60-competitor registry ranks, where, and by which URL. M2R observed frequency alone and M4C recurrence alone confer no Search or demand authority.

The seven nonexecution dispositions remain explicit: exact duplicate linked to an execution; current evidence with no requery (unused here); no incremental Search gain; implausible literal Search wording; outside product scope; invalid provider limit (unused here); unresolved ambiguous query/product fit. A HOLD row is not a synthetic query or a provider release. `terminal_reason` contains the row-level basis. M4C topic evidence remains unproven demand.

The planning fields target Russian Search, region 225, page 0, top-100 organic, flat grouping, one document per group, moderate family filter, typo correction off, relevance descending. This is **planning only**. Current Bridge command capability, pricing, persistence path and lifecycle need Main Chat verification before paid execution. No device-specific conclusion is made.

## Claim boundary

`KNOWN_QUERY_YANDEX_VISIBILITY = TARGET_OF_R2`  
`UNKNOWN_QUERY_REVERSE_INDEX_RECALL = SOURCE_UNAVAILABLE_DECLARED_LIMITATION`

There are no present-day ranking observations in this return. The manifest does not claim exhaustive competitor keyword recall, validated demand, a final visibility matrix, clustering, page ownership, or content/URL decisions. Main Chat independently checks this return after owner upload.
