# M6 pre-acquisition source manifest

WORK_ID = OCTOPORT_SEO_M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1
START_HEAD = 409d2bde3f79432141400bd4258dfa23627bf99b
END_OBSERVED_HEAD = 409d2bde3f79432141400bd4258dfa23627bf99b

Scope: full 6106-source-row reconciliation and 15 independent M3 control dimensions. No provider, web, live crawl or GitHub write.

## Frozen input identities

| Role | Repository path | Git blob | Data rows | Verification |
|---|---|---|---:|---|
| M4C | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_M6_DEMAND_GAP_CANDIDATES.tsv` | `345b1aa7c1aac4f283b3d36361aa33cad369e267` | 5973 | byte-exact Git blob match |
| OVERLAY | `docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv` | `dc9aa037a5da3101c72d4c6460109e4f69d5eea2` | 133 | byte-exact Git blob match |
| M2R | `docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv` | `9343048ed82f129b3f7433c46899e6f255a420a8` | 1123 | byte-exact Git blob match |
| M4Q | `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/M4Q_R2_QUERY_UNIVERSE_LEDGER_R2.tsv` | `23b1a272ddfae3bf03d2b4a57525a773ace7fdac` | 15542 | byte-exact Git blob match |
| M5 | `docs/seo/work_return/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1/M5_INPUT_DISPOSITION_LEDGER.tsv` | `9f0ec02927c16046ec0d836133a5e660b8d29dbd` | 1000 | byte-exact Git blob match |
| M4A_PAIR | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_PAIRWISE_TOP10_SIMILARITY.tsv` | `66a7e080adecb0231bf9cc60834248e5c03a2c67` | 105 | byte-exact Git blob match |

## Governing authorities read in full

- `docs/seo/LEVEL1/README.md` (Git blob `4c3a30644ac736b926ec82bba6b1a6e33434ac06`)
- `docs/seo/EXECUTION_RULES.md` (Git blob `4e999af4826d6f72fd15f481a698f674c8ed2d5c`)
- `docs/seo/WORK_HANDOFF_RULE.md` (Git blob `71a031e74b921dade5998beb842fb3afcc4478e7`)
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md` (Git blob `9917a52b837bcb8ae50eb63cc53e7becd1671b39`)
- `docs/seo/PRODUCT_TRUTH.md` (Git blob `6a469d5743142d3e476afa5d2cda653fd411ecb8`)
- `docs/seo/METHODOLOGY.md` (Git blob `6a85c53ec7994e3f68636dccc49c71d5be95d5ae`)
- `docs/seo/SEO_MASTER_ROADMAP_2026-09-16.md` (Git blob `7a40cfbfc9b945b8c0d884189a90cd8d5a2e6f28`)
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md` (Git blob `2438ed88a5d129b41dca88d2f87a22bc4b3515cd`)
- `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md` (Git blob `598a248c459b705ac9b7a0e53a86870733d6f379`)
- `docs/seo/LEVEL2/M7_M8_SEARCH_FREEZE_AND_SEMANTIC_MASTER_RULES.md` (Git blob `1e29a2af8440084c5890e1b397167cc384154d85`)
- `docs/seo/M5_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md` (Git blob `1ba7eda6e51fef110be3847b10819ddab344e5f9`)
- `docs/seo/M6_PRE_ACQUISITION_RECONCILIATION_GATE_2026-09-23_R1.md` (Git blob `95d634446e2ad1fa04e38039714d4b3c7624cfaa`)
- `docs/seo/serp/M3_METHOD_RETROSPECTIVE_AND_CONTROL_DEBT_2026-09-18.md` (Git blob `60a1b6de5c660733a0d2ea4d25d7fc56d84c5b99`)
- `docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md` (Git blob `0d43a40a8d5c865f2078a4f6f2a01815cd9b415f`)
- `docs/seo/work/M2R_RECONCILIATION_MAIN_CHAT_RETURN_QA_2026-09-17.md` (Git blob `58af2c3c9c1c1dd9afa6ebf37692a553d5c0ee63`)
- `docs/seo/work/M2R_FULL_VOLUME_RECONCILIATION_2026-09-17.md` (Git blob `f850699a095ba480451b117b9ff0ba357d9e7488`)
- `docs/seo/wordstat/M2_WORDSTAT_RETRO_GATE_AUDIT_2026-09-16.md` (Git blob `14bea2f8101be36fde0e0b583de2875169bbd287`)
- `docs/seo/serp/competitors/M4Q_R2_PASS_B_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md` (Git blob `fee2919f871846144f2f14abe86e7c2eb7b2e035`)
- `docs/seo/serp/competitors/M4Q_R2_TARGETED_M4C_RECHECK_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md` (Git blob `a9738377589633c07396159ee02a688810debc57`)
- `docs/seo/technical/CURRENT_SITE_BASELINE_2026-09-16.md` (Git blob `92d0f94d91e49f8abfc296d34c530ebbd9e760ab`)
- `docs/seo/serp/competitors/M4_PROGRESS.md` (Git blob `75f26e9644545840de21b328349f2d8236d28209`)

## Supporting joins read in full

- `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_SERP_OCCURRENCES_CLASSIFIED.tsv` (Git blob `0028a743c8617c569ba37dfa4b59e92b5f56e18d`, rows 300)
- `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_QUERY_PROFILES.tsv` (Git blob `69bd0f12165c15d43b336a8eee41fc58e3b1ac3c`, rows 15)
- `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv` (Git blob `d8401597cb66a9c4181422af37453934113dfd57`, rows 45)
- `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_M4C_M6_RECONCILIATION.tsv` (Git blob `363536ac20c41e4b8b9c136f842ef12db0ce15c3`, rows 45)
- `docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_M4C_M6_RECONCILIATION.tsv` (Git blob `a0123d35a62b4ec969b53cb4f6ac753de83a3633`, rows 59)

## Parser and identity

M4C, M4Q, M5 and accepted TSVs: literal TAB fields, physical newline records, quote character literal; no CSV quote semantics. M2R: accepted UTF-8-sig CSV with ordinary quoted fields. Exact-safe comparison: NFC, outer trim, collapse internal Unicode whitespace, case-fold; never stem, merge synonyms/marketplaces, correct spelling, or manufacture provider phrases. Seven mixed-wording groups remain held.

M4C raw_examples may contain multiple literal ` || ` examples. The first example is the row display phrase; `all_raw_examples` and full accepted source IDs preserve the complete grouping. Distinct alternatives in one group never authorize a single provider phrase. Targeted POSSIBLE_VARIANT retains independent status. M4Q and M5 are context/routing inputs, not extra primary rows. Empty M3/M1 gap `source_row_ids` is intentional because those gaps are not part of 6106 primary source rows.

## Current capability and claim boundary

Official Wordstat GetTop supports region, device and up to 2000 phrases; YMB0.1.9 supports GetTop, region, DEVICE_ALL/DESKTOP/PHONE/TABLET and batch <=500. Official Search supports region, FORMAT_XML/FORMAT_HTML and userAgent; YMB0.1.9 Search supports region, fixes FORMAT_XML and lacks userAgent. HTML/device rows are capability holds with execution_allowed=false. All 15 planned rows require separate Main Chat acceptance; no command is released.

Current M4Q 45-query top100 snapshot supplies later temporal evidence for all 15 M3 exact controls, but not arbitrary domain-to-unknown-query reverse recall, demand, product facts, all-device coverage, or site architecture. M4A all 105 accepted Top10 pairwise comparisons supply overlap. M1 remains source-audit-only and blocks M6 final closure/M7.

## Authority drift

START_HEAD = `409d2bde3f79432141400bd4258dfa23627bf99b`; END_OBSERVED_HEAD = `409d2bde3f79432141400bd4258dfa23627bf99b`. Frozen required blobs match 6/6. Any intervening path drift is classified in QA.
