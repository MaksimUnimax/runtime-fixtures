# M4Q R2 Pass A2 — corrected query-authority source manifest

WORK_ID: `OCTOPORT_SEO_M4Q_R2_QUERY_MANIFEST_2026-09-23_R2`  
START_HEAD: `ea97ad52b8119794a1f93b3a74b5c31bec0fcd64`  
END_OBSERVED_HEAD: `ea97ad52b8119794a1f93b3a74b5c31bec0fcd64`  
AUTHORITY_DRIFT_STATUS: `NONE`  
VERDICT: `PASS_QUERY_AUTHORITY_CORRECTION`

## Frozen source identity

The live branch was fetched at start and again before return. All 24 required blobs match the correction authority. Exactly the listed upstream and R1-return files supplied data. Current `M4_PROGRESS.md`, the R1 Main Chat QA and correction gate supplied governing state. The six R1 Work files were read in full: R1 is a lossless row/provenance baseline, **not** a valid semantic admission baseline. No provider/web/Wordstat/Alice calls or GitHub writes occurred.

| # | group | frozen source | verified Git blob SHA-1 |
|---:|---|---|---|
| 1 | `UPSTREAM` | `docs/seo/LEVEL1/README.md` | `4c3a30644ac736b926ec82bba6b1a6e33434ac06` |
| 2 | `UPSTREAM` | `docs/seo/EXECUTION_RULES.md` | `4e999af4826d6f72fd15f481a698f674c8ed2d5c` |
| 3 | `UPSTREAM` | `docs/seo/WORK_HANDOFF_RULE.md` | `71a031e74b921dade5998beb842fb3afcc4478e7` |
| 4 | `UPSTREAM` | `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md` | `9917a52b837bcb8ae50eb63cc53e7becd1671b39` |
| 5 | `UPSTREAM` | `docs/seo/PRODUCT_TRUTH.md` | `6a469d5743142d3e476afa5d2cda653fd411ecb8` |
| 6 | `UPSTREAM` | `docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md` | `3ef9e456dd724500f1b4068236a80211d1fb69be` |
| 7 | `UPSTREAM` | `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md` | `598a248c459b705ac9b7a0e53a86870733d6f379` |
| 8 | `UPSTREAM` | `docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv` | `9343048ed82f129b3f7433c46899e6f255a420a8` |
| 9 | `UPSTREAM` | `docs/seo/work/M2R_FULL_VOLUME_RECONCILIATION_2026-09-17.md` | `f850699a095ba480451b117b9ff0ba357d9e7488` |
| 10 | `UPSTREAM` | `docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md` | `0d43a40a8d5c865f2078a4f6f2a01815cd9b415f` |
| 11 | `UPSTREAM` | `docs/seo/serp/competitors/M4Q_R1_SOURCE_LIMITATION_ACCEPTANCE_2026-09-22.md` | `c51cdabdaee86b87b9fb7ee023d5bf9221607fc8` |
| 12 | `UPSTREAM` | `docs/seo/serp/competitors/M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md` | `8b8f075052f03511e6d0b831a3688e65da488f7d` |
| 13 | `UPSTREAM` | `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_COMPETITOR_REGISTRY.tsv` | `822155d7cebcbcf5cf8cdaef0f92782d5f84cd59` |
| 14 | `UPSTREAM` | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_HARDENED_COMPETITOR_REGISTRY.tsv` | `43ce2150686b1b1df33ddb947b8a6920ebb2f112` |
| 15 | `UPSTREAM` | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COVERAGE_LEDGER.tsv` | `e308aac9ade959c3a4faebb7c391ea3d25c7c7f4` |
| 16 | `UPSTREAM` | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COMPETITOR_CANDIDATE_REGISTER.tsv` | `93debb9c20c2f6df6d146e018e9b5afa96350124` |
| 17 | `UPSTREAM` | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_M6_DEMAND_GAP_CANDIDATES.tsv` | `345b1aa7c1aac4f283b3d36361aa33cad369e267` |
| 18 | `UPSTREAM` | `docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_RETURN_MANIFEST.json` | `5b4ff58d82a08bc5846f6291f41acedaf19037e1` |
| 19 | `R1_RETURN` | `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R1/M4Q_R2_SOURCE_MANIFEST.md` | `e93e58f5231205b28d4f086f4335b64264854a5e` |
| 20 | `R1_RETURN` | `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R1/M4Q_R2_QUERY_UNIVERSE_LEDGER.tsv` | `6f1824500ea6ba6d0457f062b11e6031480a8e83` |
| 21 | `R1_RETURN` | `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R1/M4Q_R2_SEARCH_EXECUTION_MANIFEST.tsv` | `6fcd6273e16e5ca6a6d03669f5efb31b60fa4bbc` |
| 22 | `R1_RETURN` | `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R1/M4Q_R2_BATCH_PLAN.tsv` | `05a2a46f57619cd16a9689853626797eb3cf8813` |
| 23 | `R1_RETURN` | `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R1/M4Q_R2_QA.md` | `ae5b6ad3cb1d27f2865260ec22e7625570c0e2ef` |
| 24 | `R1_RETURN` | `docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R1/M4Q_R2_RETURN_MANIFEST.json` | `4622af62d4908cc09e977edefbc6680d40d8b718` |

## Universe and exact identity

| Source class | Rows | Query-evidence status |
|---|---:|---|
| M3 exact accepted Search matrix | 15 | Tier A: accepted Search authority |
| M2R original Wordstat lineage | 1,123 | Tier B: observed phrase/seed; independent fit, contamination and information-gain checks required |
| M4C candidate occurrences | 8,431 | Tier C: competitor page/content evidence only |
| M4C M6 grouped candidates | 5,973 | Tier C: group is not a provider query |
| **Total** | **15,542** | **7,787** exact-safe comparison keys |

R1 M4C parsing remains literal TAB / physical newline / `QUOTE_NONE`; quote characters are literal data. M6 groups retain their full occurrence IDs and raw examples. The R1 ledger's original phrase, locator, source, provenance and exact-safe key remain byte-value identical after parsing. The corrected ledger adds all original M2R CSV fields as `m2r_original_row_json` for each M2R row, plus explicit R1/R2 status and execution-ID columns.

Exact-safe key uses NFC, trim, internal-whitespace collapse and case-fold only. It is a comparison identity; executable text is the **unaltered** source phrase from M3 or M2R. No group label, competitor heading, paraphrase, spelling correction, ё/е replacement or generated phrase becomes a query.

## Admission policy

M3's 15 accepted exact queries are refreshed for current top-100 visibility among the current 60 authorized competitors. M2R phrases are admitted only when their original evidence type, fit, contamination, capability and a distinct Search-versus-M3 decision warrant a call. A tested seed with totalCount only has no direct-result array evidence. The one exact-empty seed admitted as a language control is labelled `NO_POSITIVE_DEMAND` throughout.

The 30 additional M2R phrases represent separately stated mechanisms or boundaries: agent versus assistant, generic versus marketplace-specific ChatGPT, internal seller data, service versus extension, seller reporting versus statutory reports, finance metric, ad DRR, search-report versus buyer navigation, cabinet-help qualifier, and card analysis versus creative generation. Their per-query comparator, downstream decision, insufficiency of M3/M2R and stop interpretation are in the execution manifest. They were selected after full original-field review; observed frequency alone was never a reason to execute.

Every pure M4C candidate lacks independent Search-query authority. Potentially useful competitor wording routes to `DEFER_TO_M6_DEMAND_VALIDATION` (715 occurrence/group rows), while fragments, irrelevant pages, unsupported scopes and ambiguous tasks retain concrete nonexecution statuses. If a candidate text matches an admitted M3/M2R key, it links as an exact duplicate to that **source-authorized** query. Neither a candidate topic nor a later Search response proves Wordstat demand.

Planned evidence settings: `SEARCH_TYPE_RU`, region `225`, page `0`, desired top-100, `GROUP_MODE_FLAT`, `docsInGroup=1`, `FAMILY_MODE_MODERATE`, `FIX_TYPO_MODE_OFF`, relevance descending. These are planning fields, not executable Bridge commands or proof of live Bridge capability, device control or current price. Main Chat verifies all those boundaries after accepting the owner-uploaded return.

`KNOWN_QUERY_YANDEX_VISIBILITY = TARGET_OF_R2`  
`UNKNOWN_QUERY_REVERSE_INDEX_RECALL = SOURCE_UNAVAILABLE_DECLARED_LIMITATION`

No ranking evidence was acquired and no visibility matrix, cluster, page ownership, URL, H1 or Title decision was made.
