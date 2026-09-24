# M9 full-rerun source manifest
WORK_ID = OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1
START_HEAD = 6f6d22168ffd2e065264df5716fcb0ef6a7310ac
END_OBSERVED_HEAD = 6f6d22168ffd2e065264df5716fcb0ef6a7310ac
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED
Branch: `seo/wordstat-batch-01-2026-09-16`; repository: `MaksimUnimax/runtime-fixtures`.

## Binding identities and source separation

Rerun pre-handoff blob: `5d92c37ea4e15646397d87e9aec9017a0aa2b765`. Rerun input manifest blob: `028f632cc01e4cef27d9dbcbbe19db3b83fe94de`. Base R2 input manifest blob: `424f2e61c54388c90fb5cc91495f7f5c8f81898b`. Accepted R2 pairwise blob: `1ed11a2f135e7f7a8749c80be9efb971e267eda2`. Current 47-anchor map blob: `5c9aa993f9d17c1434deb0da059e316a98da54f1`. Wave1 accepted projection container blob: `cb2d10581aff2810549fc1a9841b51edb652d428`.
The Wave1 projection was decoded in memory: UTF-8 TSV 45666 bytes, SHA-256 `b01d9c0ccbbfb2c7cfcb5af33762c7d9a74c686c2102e5d1419e1bf97491bb95`, 500 rows (25 indices × 20 ranks). Full accepted Wave1 export: 8,768,838 bytes, SHA-256 `71a33e74c41bfeb73bdcae5d3676df052a9c20bc93a6593bc2aec6821650a841`, 25/25 successful, 2,500 normalized results. Its 8.7 MB copy was not needed, opened or added to the ZIP.
The old 22 URL/domain/rank sets come only from M4Q R2 `result_url_normalized`, `result_domain`, `result_rank`. The 25 new sets come only from Wave1 projection `url`, `domain`, `rank`. Literal stored strings and unique sets are used; no further canonicalization. Historical M4A and M6 region-213 inputs inform accepted frozen context and never enter current RU225 overlap sets. Page-type relation stays byte-identical to accepted R2 pair fields.

## Direct input files read and verified

| Path | Access role | Git blob | Bytes | Parsed data rows |
|---|---|---|---:|---:|
| `docs/seo/PRODUCT_TRUTH.md` | PRODUCT_BOUNDARY | `6a469d5743142d3e476afa5d2cda653fd411ecb8` | 14268 | — |
| `docs/seo/M8_R3_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-24_R1.md` | M8_ACCEPTANCE_CONTEXT | `9624decd46ae12c9a6c8faf139bec9ebf545adae` | 9717 | — |
| `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_SEMANTIC_IDENTITY_MASTER.tsv` | M8_SEMANTIC_AUTHORITY | `2faaca90c49d5e2ca9c5121c1ef187b3a3f6844f` | 11405030 | 7913 |
| `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_IDENTITY_SOURCE_XREF.tsv` | M8_LINEAGE_CONTEXT | `1e4d17a2c355de72d9246e4432f0f691df0aaf4b` | 4227700 | 25229 |
| `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_HOLD_REVIEW_LEDGER.tsv` | M8_HOLD_CONTEXT | `0b76b515ebf3394be0813793898374f97fcddcdb` | 3477495 | 5168 |
| `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_REASON_CODE_DICTIONARY.md` | M8_REASON_CONTEXT | `8e7ce6a073fbee9fe6f832577c0b46b0f42e0162` | 29415 | — |
| `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_QA.md` | M8_QA_CONTEXT | `655207d340c2594180d683760f2262c4abf2d7e3` | 9876 | — |
| `docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md` | M3_QUERY_AUTHORITY | `0d43a40a8d5c865f2078a4f6f2a01815cd9b415f` | 12356 | — |
| `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_SERP_OCCURRENCES_CLASSIFIED.tsv` | SEARCH_BASELINE_OVERLAY | `0028a743c8617c569ba37dfa4b59e92b5f56e18d` | 366854 | 300 |
| `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_QUERY_PROFILES.tsv` | SEARCH_QUERY_PROFILE | `69bd0f12165c15d43b336a8eee41fc58e3b1ac3c` | 9998 | 15 |
| `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_PAIRWISE_TOP10_SIMILARITY.tsv` | HISTORICAL_PAIRWISE_SERP | `66a7e080adecb0231bf9cc60834248e5c03a2c67` | 15803 | 105 |
| `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_COLLISION_UNCERTAINTY_LEDGER.tsv` | SEARCH_COLLISION_CONTEXT | `12c52d209a67eee06c5ed9276a5dfbd15c043f07` | 81907 | 92 |
| `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/M4Q_R2_SEARCH_EXECUTION_MANIFEST_R2.tsv` | CURRENT_SEARCH_EXECUTION | `d82fef9ec9bc3d757dc85b771f6c114b92c0cd1a` | 84995 | 45 |
| `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_SERP_RESULT_LEDGER.tsv` | CURRENT_SEARCH_OVERLAP_SOURCE | `41041493677627bfaf30de8eb7ec88a52ceb0a91` | 5586149 | 4500 |
| `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv` | CURRENT_SERP_QUERY_SUMMARY | `d8401597cb66a9c4181422af37453934113dfd57` | 88618 | 45 |
| `docs/seo/serp/competitors/recovery/M4Q_R2_TARGETED_PAGE_EVIDENCE_2026-09-24_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE_RECOVERED.tsv` | PAGE_TYPE_CONTEXT | `b62d1c2cfb8ccb4dba84b8d3d691cb5d1c5fb77c` | 2602161 | 47 |
| `docs/seo/M6_SEARCH_REGION_CONTROL_MAIN_CHAT_RECONCILIATION_2026-09-23_R1.md` | REGION_SENSITIVITY_CONTEXT | `8cae057b64f16b627a089c999227aab9fc5d5fea` | 10617 | — |
| `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_CONTROL_ROWS_2026-09-23_R1.tsv` | REGION_SENSITIVITY_ROWS | `adb5929cfdbbfca897640629cbc9899ccea2c846` | 29332 | 40 |
| `docs/seo/M9_SEARCH_ANCHOR_MAP_2026-09-24_R2.tsv` | M9_CURRENT_SEARCH_ANCHOR_MAP | `61a6d6c5befbc20f75fadddfd035b7affc6fe14c` | 8366 | 22 |
| `docs/seo/M9_R2_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-24_R1.md` | ACCEPTED_M9_R2_BASELINE | `7acc7f0e4bd70761c06e828bcea4da82a4cd2736` | 10173 | — |
| `docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2/M9_PAIRWISE_CLUSTER_EVIDENCE.tsv` | FROZEN_NON_SEARCH_PAIR_DIMENSIONS_AND_DIFF_BASELINE | `1ed11a2f135e7f7a8749c80be9efb971e267eda2` | 4724034 | 5356 |
| `docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2/M9_CLUSTER_MASTER.tsv` | CLUSTER_DIFF_BASELINE | `a44b15539ff6ff3e472add8045a05bdd63086d05` | 105796 | 104 |
| `docs/seo/work_return/M9_SEARCH_ONLY_CLUSTERING_2026-09-24_R2/M9_CLUSTER_MEMBERSHIP.tsv` | MEMBERSHIP_DIFF_BASELINE | `c757fd9738cfb06fc0db8184308490351dbce9a1` | 37637 | 104 |
| `docs/seo/M9_BOUNDARY_RESOLUTION_PREACQ_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md` | WAVE1_SELECTION_ACCEPTANCE | `1d82c1412d59061501ac4c49ce2427cc001cf13d` | 5701 | — |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/M9BR_WAVE1_QUERY_MANIFEST.tsv` | WAVE1_EXACT_QUERY_IDENTITY | `3222b6b96ea7e7c558d08be34e74482ce4f81a4e` | 48049 | 25 |
| `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_EXPORT_ACCEPTANCE_2026-09-24_R1.md` | WAVE1_FULL_EXPORT_ACCEPTANCE | `4f83d5d0432d8b0cfbbc79648f71d07fcbc5a80c` | 4000 | — |
| `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_OVERLAP_PROJECTION_ACCEPTANCE_2026-09-24_R1.md` | WAVE1_TOP20_PROJECTION_ACCEPTANCE | `3f5e02f7a424fdbbfaaf367108550f84f698dd2b` | 2258 | — |
| `docs/seo/serp/raw/M9_BOUNDARY_RESOLUTION_WAVE1_2026-09-24_R1/M9BR_WAVE1_TOP20_URL_DOMAIN.tsv.gz.b64` | WAVE1_CURRENT_OVERLAP_ROWS | `cb2d10581aff2810549fc1a9841b51edb652d428` | 10996 | — |
| `docs/seo/M9_BOUNDARY_RESOLUTION_SEARCH_ANCHOR_MAP_2026-09-24_R1.tsv` | CURRENT_47_SEARCH_ANCHOR_MAP | `5c9aa993f9d17c1434deb0da059e316a98da54f1` | 31895 | 47 |

Direct unique file count: 29 (19 unchanged R2 base inputs plus 10 rerun overlays; the old overlap source already belongs to the base list). Every named Git blob matched. Audit fallback file reads: 0.

## Governing method, progress and failure history read

| Path | Git blob |
|---|---|
| `docs/seo/LEVEL1/README.md` | `4c3a30644ac736b926ec82bba6b1a6e33434ac06` |
| `docs/seo/EXECUTION_RULES.md` | `4e999af4826d6f72fd15f481a698f674c8ed2d5c` |
| `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md` | `9917a52b837bcb8ae50eb63cc53e7becd1671b39` |
| `docs/seo/WORK_HANDOFF_RULE.md` | `71a031e74b921dade5998beb842fb3afcc4478e7` |
| `docs/seo/METHODOLOGY.md` | `6a85c53ec7994e3f68636dccc49c71d5be95d5ae` |
| `docs/seo/PRODUCT_TRUTH.md` | `6a469d5743142d3e476afa5d2cda653fd411ecb8` |
| `docs/seo/PROVIDER_QUERY_RELEASE_RULE.md` | `4d5de2446e04684c6b36ce19ab5f32fb05e9c9ce` |
| `docs/seo/LEVEL2/README.md` | `4c9427619d35dcc0bfa62385b48e9278cdaaff0a` |
| `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md` | `2438ed88a5d129b41dca88d2f87a22bc4b3515cd` |
| `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md` | `2f87943fbe9037c58276d2dd3a805d070bd070a4` |
| `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md` | `598a248c459b705ac9b7a0e53a86870733d6f379` |
| `docs/seo/M9_R2_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-24_R1.md` | `7acc7f0e4bd70761c06e828bcea4da82a4cd2736` |
| `docs/seo/M9_PROGRESS.md` | `eb04236a39edad7b1f586b1fec6aa933a1565e02` |
| `docs/seo/M9_STEP_PREPARATION_2026-09-24_R2.md` | `7ad9740eecf8433f678860c122971bd9c6a73de1` |
| `docs/seo/M9_SEARCH_ONLY_CLUSTERING_PRE_HANDOFF_2026-09-24_R2.md` | `9a7ac34435e2e834e7153fe6ba368531f81e17da` |
| `docs/seo/M9_SEARCH_ONLY_CLUSTERING_WORK_PROMPT_2026-09-24_R2.md` | `01a9eb08d12b635d2dd5f76f3da68313332364f9` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_PREACQ_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md` | `1d82c1412d59061501ac4c49ce2427cc001cf13d` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_EXPORT_ACCEPTANCE_2026-09-24_R1.md` | `4f83d5d0432d8b0cfbbc79648f71d07fcbc5a80c` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_OVERLAP_PROJECTION_ACCEPTANCE_2026-09-24_R1.md` | `3f5e02f7a424fdbbfaaf367108550f84f698dd2b` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_PRE_HANDOFF_2026-09-24_R1.md` | `5d92c37ea4e15646397d87e9aec9017a0aa2b765` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_INPUT_MANIFEST_2026-09-24_R1.json` | `028f632cc01e4cef27d9dbcbbe19db3b83fe94de` |
| `docs/seo/FAILURE_LEDGER.md` | `2527cb7adb10a57795f0b80f16660b4475f6e825` |

## Parser and accounting

TSV: physical newline records, literal TAB fields, quotes as literal text; every scanned physical data line has the header width. Base64 was decoded and then gzip decompressed in memory. Only accepted, indexed projection rows were used for Wave1 URL/domain overlap. SHA-256 and row/rank/index identities checked before use.
M8 identity rows: 7,913; Working eligible: 104; carried Review-Hold: 5,064; excluded: 2,737; brand defense: 8. Current anchors: old 22 plus new 25; missing: 57. Pairs: all C(104,2)=5,356.
Provider calls = 0; Bridge commands = 0; external web acquisition = 0; GitHub writes = 0; Alice/AI evidence rows = 0; audit fallback reads = 0. No final page ownership or IA decisions.
