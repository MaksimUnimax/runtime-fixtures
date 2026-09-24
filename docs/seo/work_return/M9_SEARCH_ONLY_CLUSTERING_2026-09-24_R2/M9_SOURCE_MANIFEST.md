# M9 Search-only clustering R2 — source manifest

WORK_ID = OCTOPORT_SEO_M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2  
START_HEAD = 50dbbc8edd9c466b7a441b524b545c146201e931  
END_OBSERVED_HEAD = 50dbbc8edd9c466b7a441b524b545c146201e931  
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED

## Execution authority

R2 step preparation: `docs/seo/M9_STEP_PREPARATION_2026-09-24_R2.md` / blob `7ad9740eecf8433f678860c122971bd9c6a73de1`.  
R2 pre-handoff: `docs/seo/M9_SEARCH_ONLY_CLUSTERING_PRE_HANDOFF_2026-09-24_R2.md` / blob `9a7ac34435e2e834e7153fe6ba368531f81e17da`.  
R2 direct manifest: `docs/seo/M9_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-24_R2.json` / blob `424f2e61c54388c90fb5cc91495f7f5c8f81898b`.  
R2 Search-anchor map: `docs/seo/M9_SEARCH_ANCHOR_MAP_2026-09-24_R2.tsv` / blob `61a6d6c5befbc20f75fadddfd035b7affc6fe14c`.

Mandatory LEVEL 1 and exact M9 LEVEL 2 were read. `docs/seo/M8_PROGRESS.md` and `docs/seo/FAILURE_LEDGER.md` supplied roadmap/failure context and were not additional semantic or Search evidence. M9 R1 materials were not execution authorities. The accepted M8 final acceptance inside the 19-file manifest is PASS.

## Actual direct/context input reads

All 19 direct paths below were read locally and checked against the exact frozen Git blob and bytes. Tabular files were parsed using literal tabs, physical newlines and literal quote characters with exact header-width/row validation; context files were read as text. No audit fallback semantic files were opened.

| Role | Exact direct/context file | Git blob | Bytes | Data rows |
|---|---|---|---:|---:|
| PRODUCT_BOUNDARY | `docs/seo/PRODUCT_TRUTH.md` | `6a469d5743142d3e476afa5d2cda653fd411ecb8` | 14268 | N/A |
| M8_ACCEPTANCE_CONTEXT | `docs/seo/M8_R3_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-24_R1.md` | `9624decd46ae12c9a6c8faf139bec9ebf545adae` | 9717 | N/A |
| M8_SEMANTIC_AUTHORITY | `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_SEMANTIC_IDENTITY_MASTER.tsv` | `2faaca90c49d5e2ca9c5121c1ef187b3a3f6844f` | 11405030 | 7913 |
| M8_LINEAGE_CONTEXT | `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_IDENTITY_SOURCE_XREF.tsv` | `1e4d17a2c355de72d9246e4432f0f691df0aaf4b` | 4227700 | 25229 |
| M8_HOLD_CONTEXT | `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_HOLD_REVIEW_LEDGER.tsv` | `0b76b515ebf3394be0813793898374f97fcddcdb` | 3477495 | 5168 |
| M8_REASON_CONTEXT | `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_REASON_CODE_DICTIONARY.md` | `8e7ce6a073fbee9fe6f832577c0b46b0f42e0162` | 29415 | N/A |
| M8_QA_CONTEXT | `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_QA.md` | `655207d340c2594180d683760f2262c4abf2d7e3` | 9876 | N/A |
| M3_QUERY_AUTHORITY | `docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md` | `0d43a40a8d5c865f2078a4f6f2a01815cd9b415f` | 12356 | N/A |
| SEARCH_BASELINE_OVERLAY | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_SERP_OCCURRENCES_CLASSIFIED.tsv` | `0028a743c8617c569ba37dfa4b59e92b5f56e18d` | 366854 | 300 |
| SEARCH_QUERY_PROFILE | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_QUERY_PROFILES.tsv` | `69bd0f12165c15d43b336a8eee41fc58e3b1ac3c` | 9998 | 15 |
| HISTORICAL_PAIRWISE_SERP | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_PAIRWISE_TOP10_SIMILARITY.tsv` | `66a7e080adecb0231bf9cc60834248e5c03a2c67` | 15803 | 105 |
| SEARCH_COLLISION_CONTEXT | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_COLLISION_UNCERTAINTY_LEDGER.tsv` | `12c52d209a67eee06c5ed9276a5dfbd15c043f07` | 81907 | 92 |
| CURRENT_SEARCH_EXECUTION | `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/M4Q_R2_SEARCH_EXECUTION_MANIFEST_R2.tsv` | `d82fef9ec9bc3d757dc85b771f6c114b92c0cd1a` | 84995 | 45 |
| CURRENT_SERP_AUTHORITY | `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_SERP_RESULT_LEDGER.tsv` | `41041493677627bfaf30de8eb7ec88a52ceb0a91` | 5586149 | 4500 |
| CURRENT_SERP_QUERY_SUMMARY | `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv` | `d8401597cb66a9c4181422af37453934113dfd57` | 88618 | 45 |
| PAGE_TYPE_CONTEXT | `docs/seo/serp/competitors/recovery/M4Q_R2_TARGETED_PAGE_EVIDENCE_2026-09-24_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE_RECOVERED.tsv` | `b62d1c2cfb8ccb4dba84b8d3d691cb5d1c5fb77c` | 2602161 | 47 |
| REGION_SENSITIVITY_CONTEXT | `docs/seo/M6_SEARCH_REGION_CONTROL_MAIN_CHAT_RECONCILIATION_2026-09-23_R1.md` | `8cae057b64f16b627a089c999227aab9fc5d5fea` | 10617 | N/A |
| REGION_SENSITIVITY_ROWS | `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_CONTROL_ROWS_2026-09-23_R1.tsv` | `adb5929cfdbbfca897640629cbc9899ccea2c846` | 29332 | 40 |
| M9_CURRENT_SEARCH_ANCHOR_MAP | `docs/seo/M9_SEARCH_ANCHOR_MAP_2026-09-24_R2.tsv` | `61a6d6c5befbc20f75fadddfd035b7affc6fe14c` | 8366 | 22 |

## Evidence separation and joins

M8 semantic master 7,913 identities controls eligibility: 104 WORKING, 5,064 REVIEW_HOLD, 2,737 EXCLUDED, 8 BRAND_DEFENSE. M8 xref and hold ledger are context, not extra clustering members; M8 raw ledger is not a direct M9 input.

Current exact Search anchors = 22 distinct M8 IDs mapped 1:1 to 22 distinct M4Q query IDs. M4Q RU225 Top100 provides `result_url_normalized` exact strings, `result_domain` exact strings, and integer `result_rank`; no URL re-normalization. Top10/Top20 sets deduplicate exact values; Jaccard = |intersection| / |union|, six decimals. M4A page types are admitted only for the seven mapped authority profiles; M4A organic URLs and M6 region-213 rows do not join the current RU225 overlap sets.

For 82 Working identities there is no current exact organic Search anchor. One/no current Search side has `NA_NOT_COMPARABLE` metrics, never observed zero. This is a missing evidence boundary, not evidence of a distinct page.

Pair relation and task signatures are bounded comparative judgments from exact M8 wording, user task, intent, product truth and marketplace scope. The three manually reviewed positive edges are recorded in the pair ledger. All other pairs still receive a full explicit split or HOLD judgment; no universal overlap threshold was used.

AUDIT_FALLBACK_READS = 0  
ALICE_INPUT_ROWS = 0  
M5_HYPOTHESIS_USED = 0  
PROVIDER_CALLS = 0  
WEB_ACQUISITION = 0  
GITHUB_WRITES = 0

