# M10B source manifest

WORK_ID = OCTOPORT_SEO_M10B_FINAL_AI_DIAGNOSTIC_CASE_SELECTION_2026-09-24_R1
START_HEAD = e9d13991446f04a2f69ce4940afefd10096f4517
END_OBSERVED_HEAD = e9d13991446f04a2f69ce4940afefd10096f4517
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED

## Authority and file identities

- Canonical prompt `docs/seo/M10B_WORK_PROMPT_2026-09-24_R1.md` blob `5c370c16f98b27b71da5eb9842d970e20a09161f`.
- Binding manifest `docs/seo/M10B_FINAL_AI_CASE_SELECTION_INPUT_MANIFEST_2026-09-24_R1.json` blob `0c8a200e6733e21c56221d8d22d781cd54f3f01a`.
- Pre-handoff `docs/seo/M10B_PRE_HANDOFF_2026-09-24_R1.md` blob `4a8a9683f5a89107460153883de861ac110b9253`.
- METHOD: `docs/seo/LEVEL2/M5_M10_SEARCH_ONLY_AND_ALICE_SEQUENCE_RULES.md` blob `2c63e4228f9cc6f2d26555fcb02d445baafb1000`.
- METHOD: `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md` blob `2f87943fbe9037c58276d2dd3a805d070bd070a4`.
- METHOD: `docs/seo/WORK_HANDOFF_RULE.md` blob `71a031e74b921dade5998beb842fb3afcc4478e7`.
- METHOD: `docs/seo/M10B_STEP_PREPARATION_2026-09-24_R1.md` blob `8a06eff867d569bd96d42b6527886b4a6015ef84`.
- FROZEN_M10A_ACCEPTANCE: `docs/seo/M10A_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md` blob `a0cc44f9631067f4938044fe0a4c21e6ed4898cb`.
- FROZEN_M10A_CLUSTER_BASELINE: `docs/seo/work_return/M10A_SEARCH_ONLY_PAGE_IA_BASELINE_2026-09-24_R1/M10A_CLUSTER_PAGE_IA_BASELINE.tsv` blob `81a385400dffce94441525938ac4916d4db95cc2` rows `104`.
- FROZEN_M10A_BOUNDARY_BASELINE: `docs/seo/work_return/M10A_SEARCH_ONLY_PAGE_IA_BASELINE_2026-09-24_R1/M10A_CANNIBALIZATION_BOUNDARY.tsv` blob `aafa9698cc1cc83751699ac45048b53d5505f96b` rows `1399`.
- FROZEN_M10A_SITE_SURFACES: `docs/seo/work_return/M10A_SEARCH_ONLY_PAGE_IA_BASELINE_2026-09-24_R1/M10A_EXISTING_SITE_SURFACE.tsv` blob `b1805310f77263a8734260fafb00ef0c5025d44a` rows `4`.
- ACCEPTED_M5_AUTHORITY: `docs/seo/M5_MAIN_CHAT_ACCEPTANCE_2026-09-23_R1.md` blob `1ba7eda6e51fef110be3847b10819ddab344e5f9`.
- M5_HYPOTHESIS_REGISTER: `docs/seo/work_return/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER.tsv` blob `fea13f2d07c05952ac1adc68d062a9da43f4bb25` rows `65`.
- M5_HYPOTHESIS_SOURCE_LINEAGE: `docs/seo/work_return/M5_AI_DIAGNOSTIC_HYPOTHESIS_REGISTER_2026-09-23_R1/M5_INPUT_DISPOSITION_LEDGER.tsv` blob `9f0ec02927c16046ec0d836133a5e660b8d29dbd` rows `1000`.
- CURRENT_EXACT_QUERY_TEXT_AUTHORITY: `docs/seo/M9_BOUNDARY_RESOLUTION_SEARCH_ANCHOR_MAP_2026-09-24_R2.tsv` blob `32b6ec36c1707808519d7f885f511f4258f117e1` rows `65`.
- PRODUCT_BOUNDARY: `docs/seo/PRODUCT_TRUTH.md` blob `6a469d5743142d3e476afa5d2cda653fd411ecb8`.

## Method and full-volume accounting

- Frozen M10A cluster, Search owner, page-role and 1,399 boundary rows are read-only. M5 accepted 65 provisional hypotheses and 1,000-row input lineage are read-only; the current 65-query map controls exact prompt wording.
- Mechanical direct links are extracted by exact `M4QR2Q[0-9]+` tokens from all 65 M5 `source_evidence_refs`, deduplicated within each hypothesis and intersected with exact frozen M10A current query IDs: 43/22 hypotheses, 164 triples, 19 clusters, 363 unique touched material boundaries. The 164 triples are an audit crosswalk, not selected cases.
- Selection uses all 65 hypotheses and 1,399 accepted boundary pairs. Fifteen distinct task/page-role diagnostics survive causal review; each names an exact frozen Search query. Every selected case scans all 1,399 material pairs and links every incident pair with compatible task, marketplace and named M5 diagnostic dimension; two named pair examples per case serve only as regression fixtures, never as an XREF ceiling. Three equivalent M5 hypotheses are carried by selected cases only where same uncertainty, task/marketplace and exact prompt/primary cluster permit lossless coverage. No quota or first-N selection was used.
- Direct links with source-specific LLM, marketplace, statutory, creative, developer, or mutation differences are not automatically selected/covered. No non-direct case passed the required task/marketplace/product plus M5 Search-context proof for a useful exact diagnostic prompt; none is released from source-title wording.
- Case IDs use SHA-256 UTF-8 of `exact_ai_prompt + newline + primary_cluster_id + newline + sorted source hypothesis IDs joined by newline`, truncated to 16 lowercase hex after `M10BCASE_`. Output TSV uses physical newline/tab records with control characters escaped.
- M10A baseline is immutable. Prompt selection does not imply the AI feature returned a result, that an owner/page exists, that a boundary has been settled, or that demand was measured.
- No audit fallback reads, provider calls, Yandex AI execution, Alice execution, web acquisition, GitHub writes or site mutation. Main Chat alone audits and releases any future M10C.
