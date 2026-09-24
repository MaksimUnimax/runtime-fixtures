# M9 Wave2 full-rerun source manifest
WORK_ID = OCTOPORT_SEO_M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2
START_HEAD = 776f703a4e4658e6e67d4e7addb12d8a501e1ae5
END_OBSERVED_HEAD = 776f703a4e4658e6e67d4e7addb12d8a501e1ae5
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED
Repository: `MaksimUnimax/runtime-fixtures`; branch: `seo/wordstat-batch-01-2026-09-16`.

## Frozen authority

Canonical R2 prompt blob `04ce0efd3550b8d905245ac0d454141768442517`; input manifest blob `fb010d0fd96750a3cec3f3d2efa2ae504e5b88d6`; pre-handoff blob `721c78fc5b98ff94010924f04f483847d6758dae`.
Accepted R1 pairwise blob `e1c3e6adcc2763296d87a9863620154d8fed0963`; 65-anchor map blob `32b6ec36c1707808519d7f885f511f4258f117e1`; Wave2 projection blob `427185ac67687352f318f2a7f73b81fce3acd22b`.
Wave1 decoded SHA-256 `b01d9c0ccbbfb2c7cfcb5af33762c7d9a74c686c2102e5d1419e1bf97491bb95` (500 rows). Wave2 decoded in memory: 32,421 UTF-8 bytes, 360 rows (18 indices × ranks 1–20), SHA-256 `d4ff38e0cdb4869bd6968314facd6f5bdeffd45fac5d37a8b43845f2a45f4c2b`. The separately accepted complete 18/18 Top100 export is 6,868,189 bytes, SHA-256 `25d645bab08daa8532a96b28b3c77af3415d30d59a6be878e1e15a3d7af20c16`; its attachment was not reopened or added to the ZIP.

## Direct inputs actually parsed

| Path | Role | Git blob | Bytes | Data rows |
|---|---|---|---:|---:|
| `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_EXPORT_ACCEPTANCE_2026-09-24_R1.md` | WAVE2_FULL_EXPORT_ACCEPTANCE | `705c788b7da7da95b14b728aff58b1b0b2478782` | 1984 | — |
| `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_OVERLAP_PROJECTION_ACCEPTANCE_2026-09-24_R1.md` | WAVE2_TOP20_PROJECTION_ACCEPTANCE | `4b572ecc568e504b7a845d1142f6511d26678af3` | 934 | — |
| `docs/seo/serp/raw/M9_BOUNDARY_RESOLUTION_WAVE2_2026-09-24_R1/M9BR_WAVE2_TOP20_URL_DOMAIN.tsv.gz.b64` | EXACT_CURRENT_OVERLAP | `427185ac67687352f318f2a7f73b81fce3acd22b` | 10136 | — |
| `docs/seo/M9_BOUNDARY_RESOLUTION_SEARCH_ANCHOR_MAP_2026-09-24_R2.tsv` | CURRENT_65_SEARCH_ANCHOR_MAP | `32b6ec36c1707808519d7f885f511f4258f117e1` | 45847 | 65 |
| `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_SERP_RESULT_LEDGER.tsv` | EXACT_CURRENT_OVERLAP | `41041493677627bfaf30de8eb7ec88a52ceb0a91` | 5586149 | 4500 |
| `docs/seo/serp/raw/M9_BOUNDARY_RESOLUTION_WAVE1_2026-09-24_R1/M9BR_WAVE1_TOP20_URL_DOMAIN.tsv.gz.b64` | EXACT_CURRENT_OVERLAP | `cb2d10581aff2810549fc1a9841b51edb652d428` | 10996 | — |
| `docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md` | ACCEPTED_R1_ACCEPTANCE | `530a8679140220ee11c5e8489d6a4c99b82a579c` | 1198 | — |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_PAIRWISE_CLUSTER_EVIDENCE.tsv` | ACCEPTED_R1_PAIRWISE | `e1c3e6adcc2763296d87a9863620154d8fed0963` | 4869239 | 5356 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_IDENTITY_ELIGIBILITY_LEDGER.tsv` | ACCEPTED_R1_ELIGIBILITY | `abb0db0891a54a6c27bfe8e314c8ad2541ea6ba9` | 4562430 | 7913 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_CLUSTER_MASTER.tsv` | ACCEPTED_R1_CLUSTER_MASTER | `9d86156fb11e40cf6913764d9f372f5e111a5bf9` | 109572 | 104 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_CLUSTER_MEMBERSHIP.tsv` | ACCEPTED_R1_CLUSTER_MEMBERSHIP | `6d7e30c5763eb80278ef16c45896e396da68228d` | 42854 | 104 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_HOLD_BOUNDARY_LEDGER.tsv` | ACCEPTED_R1_HOLD_LEDGER | `8287ec72c53ed6447c67d7b7b05dc69b834675e3` | 1439424 | 1406 |
| `docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3/M8_SEMANTIC_IDENTITY_MASTER.tsv` | JOIN_OR_ANCHOR_CONTEXT | `2faaca90c49d5e2ca9c5121c1ef187b3a3f6844f` | 11405030 | 7913 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/M9BR_WAVE1_QUERY_MANIFEST.tsv` | JOIN_OR_ANCHOR_CONTEXT | `3222b6b96ea7e7c558d08be34e74482ce4f81a4e` | 48049 | 25 |
| `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_QUERY_MANIFEST_2026-09-24_R1.tsv` | JOIN_OR_ANCHOR_CONTEXT | `d0dacd0068d92ff5a68644e5fb203e5e988a8fcf` | 3741 | 18 |
| `docs/seo/M9_BOUNDARY_RESOLUTION_SEARCH_ANCHOR_MAP_2026-09-24_R1.tsv` | JOIN_OR_ANCHOR_CONTEXT | `5c9aa993f9d17c1434deb0da059e316a98da54f1` | 31895 | 47 |

Unique directly parsed files: 16; frozen identities matched. Audit fallback reads: 0.

## Governing rules and accepted baseline read

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
| `docs/seo/M9_BOUNDARY_RESOLUTION_PREACQ_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md` | `1d82c1412d59061501ac4c49ce2427cc001cf13d` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md` | `530a8679140220ee11c5e8489d6a4c99b82a579c` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_EXPORT_ACCEPTANCE_2026-09-24_R1.md` | `705c788b7da7da95b14b728aff58b1b0b2478782` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_OVERLAP_PROJECTION_ACCEPTANCE_2026-09-24_R1.md` | `4b572ecc568e504b7a845d1142f6511d26678af3` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_WORK_PROMPT_2026-09-24_R2.md` | `04ce0efd3550b8d905245ac0d454141768442517` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_INPUT_MANIFEST_2026-09-24_R2.json` | `fb010d0fd96750a3cec3f3d2efa2ae504e5b88d6` |
| `docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_PRE_HANDOFF_2026-09-24_R2.md` | `721c78fc5b98ff94010924f04f483847d6758dae` |
| `docs/seo/M9_PROGRESS.md` | `9ed7cd05ce52156a35dc280ebe2938391f83759e` |
| `docs/seo/FAILURE_LEDGER.md` | `2527cb7adb10a57795f0b80f16660b4475f6e825` |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_SOURCE_MANIFEST.md` | `b53ae9f49e8491e84f87795b8a707a3c6eef088c` |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_IDENTITY_ELIGIBILITY_LEDGER.tsv` | `abb0db0891a54a6c27bfe8e314c8ad2541ea6ba9` |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_PAIRWISE_CLUSTER_EVIDENCE.tsv` | `e1c3e6adcc2763296d87a9863620154d8fed0963` |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_CLUSTER_MASTER.tsv` | `9d86156fb11e40cf6913764d9f372f5e111a5bf9` |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_CLUSTER_MEMBERSHIP.tsv` | `6d7e30c5763eb80278ef16c45896e396da68228d` |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_HOLD_BOUNDARY_LEDGER.tsv` | `8287ec72c53ed6447c67d7b7b05dc69b834675e3` |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_ADVERSARIAL_DIAGNOSTIC.tsv` | `37b67517d3209a4eb7370d7699b7ec8f61d4666f` |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_QA.md` | `36d3cbe7124efdfcbbec41801808f0f1d7a3bc93` |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R1/M9_RETURN_MANIFEST.json` | `bcbffca478bd0b31ea81fd06c3c96e9c50a49e86` |

## Parser, lineage and exclusion

TSV uses physical newline records and literal TAB fields with no CSV quotation semantics; every parsed line matched header width. Both accepted base64-gzip projections were decoded in memory, with index/rank uniqueness and Wave2 10/10 unique Top10 and 20/20 unique Top20 URLs. The known three duplicated Top100 URLs below Top20 never enter the overlap calculation.
Search source A: old 22 M4Q RU225 Top100 `result_url_normalized`, `result_domain`, `result_rank`. Source B: 25 Wave1 Top20 `url`, `domain`, `rank`. Source C: 18 Wave2 Top20 `url`, `domain`, `rank`. URL/domain strings are compared exactly as stored, using unique rank-window sets; no additional normalization. Historical M4A and region-213 rows are absent from current URL/domain sets. The 12 R1 non-Search pair columns, including page-type relation, are frozen verbatim.
Eligibility = 7,913 identities; 104 M8 Working; 5,064 Review-Hold; 2,737 Excluded; 8 Brand-Defense. Exact current anchors = 65; missing = 39. Pair universe = C(104,2) = 5,356. Input prompt is R2; R1 is an accepted data baseline only.
Provider calls = 0; Bridge commands = 0; web acquisition = 0; GitHub writes = 0; Alice input rows = 0; page ownership/URL/H1/Title/IA decisions = 0.
