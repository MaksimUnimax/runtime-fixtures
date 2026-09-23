# M4Q R2 Pass B — source and identity manifest

WORK_ID: `OCTOPORT_SEO_M4Q_R2_VISIBILITY_RECONCILIATION_2026-09-23_R1`  
START_HEAD: `9e3b38b70d13d3fe28462acb059112880d1c2553`  
END_OBSERVED_HEAD: `9e3b38b70d13d3fe28462acb059112880d1c2553`  
AUTHORITY_DRIFT_STATUS: `NONE`  
VERDICT: `PASS_BOUNDED_VISIBILITY_WITH_EXPLICIT_IDENTITY_HOLDS`

## Live preflight and frozen authority

Live branch `seo/wordstat-batch-01-2026-09-16` was fetched at start and immediately before return; it remained at the same HEAD. The 17 literal blob identities listed by the accepted Pass B pre-handoff manifest match 17/17. Its two additional critical Pass A2 blob identities also match 2/2: execution manifest `d82fef9ec9bc3d757dc85b771f6c114b92c0cd1a` and batch plan `9bafe36cea686e3f791ae56bde505b3282080284`. Five non-self Pass A2 files and eight existing, stored non-self M4C files also match their accepted return manifests byte-for-byte. The six accepted A2 files and all mandatory accepted M4C input tables were read. The 15 accepted M3 queries, all 1,123 original M2R source rows, all 15,542 accepted A2 universe rows, 8,431 M4C candidate occurrences, 5,973 M6 candidates and 15,469 M4C URLs were processed/read at full volume. Current M4 progress, Level 1, applicable Level 2, product truth, methodology, both accepted provider/export statements, and M4C final acceptance governed interpretation.

| Frozen pre-handoff source | Git blob SHA-1 | Verification |
|---|---|---|
| docs/seo/WORK_HANDOFF_RULE.md | `71a031e74b921dade5998beb842fb3afcc4478e7` | MATCH |
| docs/seo/QUALITY_FIRST_RESOURCE_RULE.md | `9917a52b837bcb8ae50eb63cc53e7becd1671b39` | MATCH |
| docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md | `3ef9e456dd724500f1b4068236a80211d1fb69be` | MATCH |
| docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md | `598a248c459b705ac9b7a0e53a86870733d6f379` | MATCH |
| docs/seo/serp/competitors/M4Q_R2_KNOWN_QUERY_VISIBILITY_REOPEN_GATE_2026-09-23_R1.md | `e4807b9e74eda9fa9467b2a77364eb2af7288e71` | MATCH |
| docs/seo/serp/competitors/M4Q_R2_PASS_A2_MAIN_CHAT_ACCEPTANCE_2026-09-23.md | `aae61da9b272d16e9d2098c088638f7cebc0e930` | MATCH |
| docs/seo/serp/competitors/M4Q_R2_COMPLETE_EXPORT_ACCEPTANCE_2026-09-23_R1.md | `d7464ebc2b8634af4829281d8c695ef17e20df48` | MATCH |
| docs/seo/serp/competitors/raw/M4Q_R2_13_EXPORT_PAGE1_MANIFEST_2026-09-23.md | `f552681d41ff05c9adbd08480bb84ca6f02de561` | MATCH |
| docs/seo/serp/competitors/raw/M4Q_R2_14_EXPORT_PAGE2_MANIFEST_2026-09-23.md | `d5cb96357e39515e83a0d161dd26f9799857c465` | MATCH |
| docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md | `0d43a40a8d5c865f2078a4f6f2a01815cd9b415f` | MATCH |
| docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv | `9343048ed82f129b3f7433c46899e6f255a420a8` | MATCH |
| docs/seo/serp/competitors/M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md | `8b8f075052f03511e6d0b831a3688e65da488f7d` | MATCH |
| docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_HARDENED_COMPETITOR_REGISTRY.tsv | `43ce2150686b1b1df33ddb947b8a6920ebb2f112` | MATCH |
| docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COVERAGE_LEDGER.tsv | `e308aac9ade959c3a4faebb7c391ea3d25c7c7f4` | MATCH |
| docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_URL_LEDGER.tsv | `72b5f18cef0d018d9af970e64b6590ec4eab2e51` | MATCH |
| docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_COMPETITOR_CANDIDATE_REGISTER.tsv | `93debb9c20c2f6df6d146e018e9b5afa96350124` | MATCH |
| docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_M6_DEMAND_GAP_CANDIDATES.tsv | `345b1aa7c1aac4f283b3d36361aa33cad369e267` | MATCH |

Additional accepted historical rank/URL baseline: `docs/seo/serp/competitors/work_return/M4A_HARDENED_2026-09-18_R3/M4A_SERP_OCCURRENCES_CLASSIFIED.tsv`, blob `0028a743c8617c569ba37dfa4b59e92b5f56e18d`, 300 accepted top-20 rows across the 15 M3 exact query texts. Its historical authority ID `R04R1` maps to accepted M3 query `R04` by exact-safe query text; no synthetic query was made. This accepted M4A occurrence layer supplies exact historical URLs that the M3 matrix alone does not enumerate. It is historical comparison data, not current proof.

## Two owner-relayed provider exports

| Expected logical filename | Bytes | SHA-256 | Indices | Normalized rows |
|---|---:|---|---|---:|
| `search-octoport-m4q-r2-b001-20260923-r225-0-24.json` | 9,207,000 | `4e9890bfba1006e116523701d61d0edfc82f6305b68d412101eb5f4aaec4aeb7` | 0–24 | 2,500 |
| `search-octoport-m4q-r2-b001-20260923-r225-25-44.json` | 7,586,040 | `d185d8a11cfbe70beb10418da7341000481d3faa7856a8ed62a1237cfe73e254` | 25–44 | 2,000 |

The local attachment transport appended `(1)` to each filename. Identity is verified by exact bytes, SHA-256, JSON schema, job/revision, terminal summary, page continuation, operation IDs, all 45 query texts/order and 100 normalized results per query. Both have schema `YMB_SEARCH_ASYNC_EXPORT_PAGE_V1`, job `octoport-m4q-r2-b001-20260923`, revision 225, 45 succeeded, zero unresolved, `all_successful=true`; the second page ends at index 44 with `has_more=false`. Every normalized result was taken directly from the accepted export, never reconstructed from XML. Provider `received_at` spans 2026-09-23 05:32:00.544–07:15:46.082 UTC. Device/user agent is unspecified.

## Reconciliation method

For a ranking row, URL comparison lowercases URL scheme and authority, drops only a fragment, preserves path and query spelling, and treats `/` and the empty root path as the same root. Raw URL, title, snippet, source item index, operation ID, exact query and provider time are preserved. A rank 1–3 is `TOP3`, 4–10 is `TOP10`, 11–20 is `11_20`, and 21–100 is `21_100`. TSV uses literal TAB/physical newline/quote-literal (`QUOTE_NONE`); any embedded control characters/backslashes are escaped reversibly as `\t`, `\r`, `\n`, `\\`. The attached JSON retains original unescaped strings.

Entity identity is the 60-row M4C hardened registry. A match requires exact registry root host, exact host present in accepted M4C URL ledger, exact accepted M4A historical ranking host for that same registry domain, or exact accepted M4C URL. There is no brand-title matching and no wildcard sibling-host mapping. Accepted URL/host collisions would be held. 1850 rows match the registry; 2576 rows have no accepted link. The 74 rows on unapproved sibling hosts are preserved as `AMBIGUOUS` without competitor ID (details in QA); these do not manufacture visibility. Native marketplace and editorial/context roles remain as recorded by the registry. Exact M4C URL matches: 826 rows.

Historical M3 comparison uses accepted 2026-09-16/17 M4A top-20 rank/URL rows, compares only current ranks 1–20 for the 15 exact M3 controls, and separately reports current ranks 21–100. Different dates and incomplete old depth forbid causal or demand-change claims; unresolved sibling hosts trigger `HOLD_COMPARABILITY` for affected exact control. M4C candidate-group linkage uses exact accepted M4C URL/candidate joins. M6 phrase linkage uses exact-safe source wording; URL-context-only candidate groups are labelled separately and never become proven demand.

`KNOWN_QUERY_TOP100_ENRICHMENT = COMPLETE_FOR_THE_45_FROZEN_QUERIES`  
`ARBITRARY_DOMAIN_TO_UNKNOWN_QUERY_REVERSE_INDEX_RECALL = NOT_PROVEN / LIMITATION_ACTIVE`

Search visibility is not Wordstat demand; competitor ranking/page topic is not an Octoport product fact; a missing authorized competitor is not zero demand or indexed pages. The one current snapshot does not prove all dates, devices or semantic recall. No final cluster, page ownership, URL, H1, Title or IA decision is made. Provider calls, web acquisition, Wordstat, Alice and GitHub writes by Work: zero.
