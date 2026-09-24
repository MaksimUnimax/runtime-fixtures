# M8 R3 source manifest

WORK_ID = OCTOPORT_SEO_M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-24_R3  
START_HEAD = cc9c667844dd6de5fc7cdb46c9abfd9cf05d3001  
END_OBSERVED_HEAD = cc9c667844dd6de5fc7cdb46c9abfd9cf05d3001  
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED

Effective M7: base freeze ID `OCTOPORT_SEO_M7_SEARCH_SIDE_COLLECTION_FREEZE_2026-09-23_R1`; input HEAD `3b71060bf529c67c7f3578ca6bfb268407e72b0b`; base manifest blob `3cc09a62aa4ac4bed0af44939a9be63820657219`; transport correction blob `ed1bad03d793ed0b0315c94b3b1bf46771736fd8`. All 162 base catalog byte lengths and Git blobs were checked; semantics remain frozen.

R3 preparation `docs/seo/M8_STEP_PREPARATION_2026-09-24_R3.md` blob `4ee2374170cd3a0765af5f59d191215cfaf54889`; pre-handoff `docs/seo/M8_SEARCH_ONLY_SEMANTIC_MASTER_PRE_HANDOFF_2026-09-24_R3.md` blob `0301d97c26de56276deefccd76f9a8b2f8ebc2fc`; direct-input manifest `docs/seo/M8_CANONICAL_DIRECT_INPUT_MANIFEST_2026-09-24_R3.json` blob `d6ddafd812baacd60e737a3141971b76f81da485`; R2 hold return blob `2dc9520bcedc7a4808167d91a55a7586b8ca134e`.

## Exact input inventory

All 46 paths below were read for bytes/blob validation. Primary and overlay tabular rows were parsed where relevant; context-only files bound interpretation. No audit fallback files were read as semantic evidence. The base M7 manifest and R3 correction are authority metadata, not extra occurrence universes.

| Input mode | M7 access | Actual file / frozen Git blob | Bytes |
|---|---|---|---:|
| DIRECT_PRODUCT_BOUNDARY | allowed | `docs/seo/PRODUCT_TRUTH.md` / `6a469d5743142d3e476afa5d2cda653fd411ecb8` | 14268 |
| CONTEXT_BOUNDARY | context_only | `docs/seo/evidence/M0_SCOPE_SOURCE_RETRO_CONSOLIDATION_2026-09-18.md` / `cd79ac5189631b7083694c5903f66eb18cd525de` | 9463 |
| CONTEXT_BOUNDARY | context_only | `docs/seo/technical/M1_OWNER_PRELAUNCH_SCOPE_CORRECTION_2026-09-23_R1.md` / `f970efff5efcba1abf485ff4d816c32d49c9b1d4` | 2520 |
| CONTEXT_BOUNDARY | context_only | `docs/seo/technical/M1_LIVE_MEASUREMENT_BASELINE_2026-09-23_R1.md` / `f13d34fe7c29746a4ee275935432a29689dcf1df` | 3532 |
| PRIMARY_OCCURRENCE | allowed | `docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv` / `9343048ed82f129b3f7433c46899e6f255a420a8` | 443233 |
| DIRECT_DEMAND_OVERLAY | allowed | `docs/seo/work/M2R_FAMILY_COVERAGE_MATRIX_2026-09-17.csv` / `076c0d95b1e08984e8d311d5547b24cb5cd74ed3` | 5996 |
| CONTEXT_BOUNDARY | context_only | `docs/seo/work/M2R_RECONCILIATION_MAIN_CHAT_RETURN_QA_2026-09-17.md` / `58af2c3c9c1c1dd9afa6ebf37692a553d5c0ee63` | 8541 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md` / `0d43a40a8d5c865f2078a4f6f2a01815cd9b415f` | 12356 |
| CONTEXT_BOUNDARY | context_only | `docs/seo/serp/M3_METHOD_RETROSPECTIVE_AND_CONTROL_DEBT_2026-09-18.md` / `60a1b6de5c660733a0d2ea4d25d7fc56d84c5b99` | 4243 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_SERP_OCCURRENCES_CLASSIFIED.tsv` / `0028a743c8617c569ba37dfa4b59e92b5f56e18d` | 366854 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_QUERY_PROFILES.tsv` / `69bd0f12165c15d43b336a8eee41fc58e3b1ac3c` | 9998 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_PAIRWISE_TOP10_SIMILARITY.tsv` / `66a7e080adecb0231bf9cc60834248e5c03a2c67` | 15803 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_COLLISION_UNCERTAINTY_LEDGER.tsv` / `12c52d209a67eee06c5ed9276a5dfbd15c043f07` | 81907 |
| DIRECT_COMPETITOR_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_DOMAIN_RECURRENCE.tsv` / `a131d27ceab7e5273ae0ab2ec7f4230841776654` | 33557 |
| DIRECT_COMPETITOR_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_COMPETITOR_REGISTRY.tsv` / `822155d7cebcbcf5cf8cdaef0f92782d5f84cd59` | 30421 |
| CONTEXT_BOUNDARY | allowed | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_ANALYSIS.md` / `0bd08fdd939925a99c64c9a9842461efe3288fe7` | 5916 |
| CONTEXT_BOUNDARY | context_only | `docs/seo/serp/competitors/M4A_R3_MAIN_CHAT_RETURN_QA_2026-09-18.md` / `97a802d24537a8829c773b10bc9ce26330e681ae` | 6849 |
| PRIMARY_OCCURRENCE | allowed | `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/M4Q_R2_QUERY_UNIVERSE_LEDGER_R2.tsv` / `23b1a272ddfae3bf03d2b4a57525a773ace7fdac` | 24292106 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/M4Q_R2_SEARCH_EXECUTION_MANIFEST_R2.tsv` / `d82fef9ec9bc3d757dc85b771f6c114b92c0cd1a` | 84995 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_SERP_RESULT_LEDGER.tsv` / `41041493677627bfaf30de8eb7ec88a52ceb0a91` | 5586149 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv` / `d8401597cb66a9c4181422af37453934113dfd57` | 88618 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_COMPETITOR_VISIBILITY_MATRIX.tsv` / `a693809a6907f5bde1a909e6dcb7656b87fcd3a4` | 3092939 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_COMPETITOR_VISIBILITY_SUMMARY.tsv` / `0b177bc8d7adc893cb12f9b4d9246315cb0771b0` | 91007 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_M4C_M6_RECONCILIATION.tsv` / `363536ac20c41e4b8b9c136f842ef12db0ce15c3` | 174077 |
| PRIMARY_OCCURRENCE | allowed | `docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv` / `dc9aa037a5da3101c72d4c6460109e4f69d5eea2` | 104248 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/recovery/M4Q_R2_TARGETED_PAGE_EVIDENCE_2026-09-24_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE_RECOVERED.tsv` / `b62d1c2cfb8ccb4dba84b8d3d691cb5d1c5fb77c` | 2602161 |
| DIRECT_SEARCH_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_M4C_M6_RECONCILIATION.tsv` / `a0123d35a62b4ec969b53cb4f6ac753de83a3633` | 55745 |
| PRIMARY_OCCURRENCE | allowed | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COMPETITOR_CANDIDATE_REGISTER.tsv` / `93debb9c20c2f6df6d146e018e9b5afa96350124` | 10414658 |
| DIRECT_COMPETITOR_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_HARDENED_COMPETITOR_REGISTRY.tsv` / `43ce2150686b1b1df33ddb947b8a6920ebb2f112` | 159425 |
| DIRECT_COMPETITOR_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COVERAGE_LEDGER.tsv` / `e308aac9ade959c3a4faebb7c391ea3d25c7c7f4` | 29326 |
| DIRECT_COMPETITOR_OVERLAY | allowed | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_M6_DEMAND_GAP_CANDIDATES.tsv` / `345b1aa7c1aac4f283b3d36361aa33cad369e267` | 6542735 |
| CONTEXT_BOUNDARY | allowed | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_SOURCE_MANIFEST.md` / `47f06a9f7bb27b4b3d3bd399834776f4754d4781` | 18396 |
| CONTEXT_BOUNDARY | allowed | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_QA.md` / `9499d407b12a61eb44d4f069584c949197d2e755` | 2853 |
| CONTEXT_BOUNDARY | context_only | `docs/seo/serp/competitors/M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md` / `8b8f075052f03511e6d0b831a3688e65da488f7d` | 7697 |
| DIRECT_M6_OVERLAY | allowed | `docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/M6_DEMAND_CANDIDATE_RECONCILIATION.tsv` / `7ffae2ce3140156226dcf9994d9b4f89ddb70a33` | 6040447 |
| DIRECT_M6_OVERLAY | allowed | `docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/M6_GAP_REGISTER.tsv` / `d0c850a73c5bc3b66ec0363a1f05641844751581` | 47076 |
| DIRECT_M6_OVERLAY | allowed | `docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/M6_M3_CONTROL_PLAN.tsv` / `2ccbe24eb3c552e066c0a542c8dad4df01d5c620` | 13591 |
| DIRECT_M6_OVERLAY | allowed | `docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/M6_PROVIDER_CANDIDATE_MANIFEST.tsv` / `620c98ac3a45023d885ce9df944ec10aa145115f` | 24193 |
| CONTEXT_BOUNDARY | allowed | `docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/M6_QA.md` / `d9be904fe53f5d3108729e53e04a964f3fa44705` | 3801 |
| DIRECT_M6_OVERLAY | allowed | `docs/seo/M6_WORDSTAT_PROVIDER_RECONCILIATION_2026-09-23_R1.md` / `268fe96068c1ac727e2772ac00e099ac27bef6b1` | 7128 |
| DIRECT_M6_OVERLAY | allowed | `docs/seo/M6_SEARCH_REGION_CONTROL_MAIN_CHAT_RECONCILIATION_2026-09-23_R1.md` / `8cae057b64f16b627a089c999227aab9fc5d5fea` | 10617 |
| DIRECT_M6_OVERLAY | allowed | `docs/seo/M6_OWNER_PRODUCT_FACT_MAIN_CHAT_RECONCILIATION_2026-09-23_R1.md` / `980d50e94d32b629303ff7a1775ec59ae2b4668c` | 5848 |
| DIRECT_M6_OVERLAY | allowed | `docs/seo/M6_HOLD_AND_BLOCKING_RECONCILIATION_2026-09-23_R1.md` / `57e6ad2ae7cee401bf66a0fd831ebeaccaadc345` | 7832 |
| CONTEXT_BOUNDARY | context_only | `docs/seo/M6_FINAL_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md` / `cac7c479e05ff9616160d415dd9218c8c97f018a` | 5239 |
| DIRECT_M6_OVERLAY | allowed | `docs/seo/work/M6_OWNER_PRODUCT_FACT_RECONCILIATION_2026-09-23_R1.tsv` / `309d0812fd874694f2cdaa748cbef6633c06576f` | 17501 |
| DIRECT_M6_OVERLAY | allowed | `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_CONTROL_ROWS_2026-09-23_R1.tsv` / `adb5929cfdbbfca897640629cbc9899ccea2c846` | 29332 |

## TSV transport preflight

Literal tab field separator, physical newline records, double quotes treated as literal text, header width enforced. M2R uses standard BOM-aware CSV.

| Direct TSV | Physical data lines | Columns | Malformed lines | Native IDs |
|---|---:|---:|---:|---:|
| `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_SERP_OCCURRENCES_CLASSIFIED.tsv` | 300 | 24 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_QUERY_PROFILES.tsv` | 15 | 15 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_PAIRWISE_TOP10_SIMILARITY.tsv` | 105 | 13 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_COLLISION_UNCERTAINTY_LEDGER.tsv` | 92 | 10 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_DOMAIN_RECURRENCE.tsv` | 127 | 15 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_COMPETITOR_REGISTRY.tsv` | 60 | 18 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/M4Q_R2_QUERY_UNIVERSE_LEDGER_R2.tsv` | 15542 | 33 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/M4Q_R2_SEARCH_EXECUTION_MANIFEST_R2.tsv` | 45 | 28 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_SERP_RESULT_LEDGER.tsv` | 4500 | 28 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv` | 45 | 28 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_COMPETITOR_VISIBILITY_MATRIX.tsv` | 1850 | 22 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_COMPETITOR_VISIBILITY_SUMMARY.tsv` | 60 | 16 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/M4Q_R2_M4C_M6_RECONCILIATION.tsv` | 45 | 22 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_CANDIDATE_DELTA.tsv` | 133 | 13 | 0 | N/A |
| `docs/seo/serp/competitors/recovery/M4Q_R2_TARGETED_PAGE_EVIDENCE_2026-09-24_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE_RECOVERED.tsv` | 47 | 21 | 0 | 47 |
| `docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_M4C_M6_RECONCILIATION.tsv` | 59 | 19 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COMPETITOR_CANDIDATE_REGISTER.tsv` | 8431 | 30 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_HARDENED_COMPETITOR_REGISTRY.tsv` | 60 | 34 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COVERAGE_LEDGER.tsv` | 60 | 29 | 0 | N/A |
| `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_M6_DEMAND_GAP_CANDIDATES.tsv` | 5973 | 18 | 0 | N/A |
| `docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/M6_DEMAND_CANDIDATE_RECONCILIATION.tsv` | 6106 | 23 | 0 | N/A |
| `docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/M6_GAP_REGISTER.tsv` | 19 | 19 | 0 | N/A |
| `docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/M6_M3_CONTROL_PLAN.tsv` | 15 | 15 | 0 | N/A |
| `docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/M6_PROVIDER_CANDIDATE_MANIFEST.tsv` | 15 | 24 | 0 | N/A |
| `docs/seo/work/M6_OWNER_PRODUCT_FACT_RECONCILIATION_2026-09-23_R1.tsv` | 30 | 8 | 0 | N/A |
| `docs/seo/work/M6_PENDING_PROVIDER_RAW/M6_SEARCH_REGION_CONTROL_ROWS_2026-09-23_R1.tsv` | 40 | 14 | 0 | N/A |

PRIMARY_OCCURRENCES = M2R 1123 + M4Q R2 query universe 15542 + M4C candidates 8431 + targeted delta 133 = 25229. All original source fields are serialized unchanged in raw ledger JSON; normalization is stored in a separate exact-safe key. Overlays do not expand that total.

M3/M4A overlay: 15 query authorities, 300 Search rows, 105 pairwise rows. M4Q overlay: 45 queries, 4500 result rows, 47 recovered targeted pages joined to candidate target IDs and 59 targeted reconciliation rows. M6: 6106 source reconciliation rows, 30 owner facts (29 held), region control read separately.

Historical malformed targeted page file `docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv` was never directly parsed. Recovered file blob `b62d1c2cfb8ccb4dba84b8d3d691cb5d1c5fb77c`, SHA-256 `a9ec3a14319edc0a4721e702378e910461490be1deba4136afcdf2276c2585d5`, 47 unique IDs, 47 physical rows, 21 columns each.

PROHIBITED_INPUT_USED = 0; ALICE_INPUT_ROWS = 0; M5_HYPOTHESIS_USED_AS_SEARCH_TRUTH = 0. R1/R2 prompts were not execution authority. PROVIDER_CALLS = 0; WEB_ACQUISITION = 0; GITHUB_WRITES = 0.

