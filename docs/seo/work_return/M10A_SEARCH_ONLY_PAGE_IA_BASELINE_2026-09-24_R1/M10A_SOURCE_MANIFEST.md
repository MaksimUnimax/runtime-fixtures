# M10A source manifest

WORK_ID = OCTOPORT_SEO_M10A_SEARCH_ONLY_PAGE_IA_BASELINE_2026-09-24_R1
START_HEAD = e3b4ee1174fe2e7017b20af3235685cae5d1bd01
START_SITE_MAIN_HEAD = f079c2e7199250397259ea9ede10a4f72694f5c1
END_OBSERVED_HEAD = e3b4ee1174fe2e7017b20af3235685cae5d1bd01
END_SITE_MAIN_HEAD = f079c2e7199250397259ea9ede10a4f72694f5c1
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED

## Frozen identities and input classes

- Prompt: `docs/seo/M10A_WORK_PROMPT_2026-09-24_R1.md` blob `87219a59a9bc5d1f8eed7881aba5e6d9c95f0bbf`; execution rule only.
- Input manifest: `docs/seo/M10A_SEARCH_ONLY_PAGE_IA_INPUT_MANIFEST_2026-09-24_R1.json` blob `4ab96efc02cf81198599caaf81dcd5f601d8ba0d`; binding input catalog.
- Pre-handoff: `docs/seo/M10A_PRE_HANDOFF_2026-09-24_R1.md` blob `beed81e788fb642d2fa3c7dd7a8006fbd9fe1496`; handoff context.
- Method: `docs/seo/LEVEL2/M5_M10_SEARCH_ONLY_AND_ALICE_SEQUENCE_RULES.md` blob `2c63e4228f9cc6f2d26555fcb02d445baafb1000`.
- Method: `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md` blob `2f87943fbe9037c58276d2dd3a805d070bd070a4`.
- Method: `docs/seo/WORK_HANDOFF_RULE.md` blob `71a031e74b921dade5998beb842fb3afcc4478e7`.
- Method: `docs/seo/M10A_STEP_PREPARATION_2026-09-24_R1.md` blob `ea07a677d59150f6519a8893c135eb0f81d496a7`.
- M9_TERMINAL_ACCEPTANCE: `docs/seo/M9_TERMINAL_HOLD_RECONCILIATION_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md` blob `f35e5132d64ade78ce6c8fb8a2aea2292f41c02a`.
- M10A_EXPLICIT_HOLD_CARRY: `docs/seo/work_return/M9_TERMINAL_HOLD_RECONCILIATION_2026-09-24_R1/M9H_M10A_CARRY_FORWARD.tsv` blob `8fbc7b9669b19838a58efa7a6d8213dbc073b707`; rows `104`.
- M10A_CANNIBALIZATION_BOUNDARY_AUTHORITY: `docs/seo/work_return/M9_TERMINAL_HOLD_RECONCILIATION_2026-09-24_R1/M9H_MATERIAL_HOLD_DISPOSITION.tsv` blob `6aba4c4716d57605af9f2ae3b11b77db701d8ba1`; rows `1399`.
- M9_CLUSTER_MASTER: `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/M9_CLUSTER_MASTER.tsv` blob `5d9d86bf87a3c6306db496a577b954ea0cfe4efc`; rows `104`.
- M9_CLUSTER_MEMBERSHIP: `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/M9_CLUSTER_MEMBERSHIP.tsv` blob `7df5d573e823c3eea49f0010ad13b78d0a396215`; rows `104`.
- PRODUCT_TRUTH: `docs/seo/PRODUCT_TRUTH.md` blob `6a469d5743142d3e476afa5d2cda653fd411ecb8`.
- ACCEPTED_PRELAUNCH_SITE_BASELINE: `docs/seo/technical/M1_LIVE_MEASUREMENT_BASELINE_2026-09-23_R1.md` blob `f13d34fe7c29746a4ee275935432a29689dcf1df`.
- CURRENT_SITE_SOURCE_OVERLAY: `docs/seo/M10A_CURRENT_SITE_SOURCE_OVERLAY_2026-09-24_R1.md` blob `b5f41ff4d0db562cc2346b672e412880585188ef`.

- Frozen site source: `main@f079c2e7199250397259ea9ede10a4f72694f5c1`; no public crawl or deployment claim.
- Site source: `apps/site/public/index.html` blob `3123a714e2092fb156eebe498ef97bb5969567f6`.
- Site source: `apps/site/public/install.html` blob `99bc456742375219779ae9c611580e389b81c7a1`.
- Site source: `apps/site/public/privacy.html` blob `bb975f29e3fbe8e1cfeb1fa19f397f9e5dc1f101`.
- Site source: `apps/site/public/support.html` blob `2ebb8fdab73c50d98a3af70198f98813cbab942b`.
- Site source: `apps/site/public/robots.txt` blob `446df898e31b99b230e8a49a7c94a45e4df96228`.
- Site source: `apps/site/public/sitemap.xml` blob `fdceb2ff477941104373850846c33bac2a5d3ced`.

## Mutable progress snapshot reconciliation

- Prompt preparation requires `M10A_PROGRESS_BLOB = 1c0e467e8a9b1bac7b391795172486d4c6b5b77e`. This exact historical blob is present at prompt-preparation parent `8ee79eb21d6c9b16950da9aebe76261418f876f6`.
- Live handoff HEAD has `M10A_PROGRESS.md` blob `23cbb2f536c13d04b5bd623339661e0a3f9b0c10`. The only changes are status HANDOFF PREPARED -> WORK HANDOFF READY and addition of the canonical prompt path/blob plus seven-file stop instruction. No frozen analytical input, site source, product truth, method, step preparation, pre-handoff, or manifest changed. The historical progress blob is a preparation snapshot, not a competing semantic input.

## Joins and limitations

- Direct primary M9H carry: 104 physical TSV data lines. M9H material pairs: 1,399 physical TSV data lines. M9 R2 cluster master/membership: 104/104 physical TSV data lines. Keyed joins use exact cluster/semantic/pair IDs, and boundary degrees are independently recounted from both endpoints.
- Source text fields are copied as data with literal tab/newline/carriage return escaped in output TSV physical records; no classification or page assignment is inferred from display wording.
- Accepted M1 prelaunch baseline and frozen current site source determine only physical source facts. Home/install/privacy/support canonical and sitemap states are source facts, not live deployment/indexing or Search ownership.
- No audit fallback reads. No M5 register, Alice evidence or AI provider rows read. No external method research performed by Work: current preparation owns that research.
- Provider calls = 0; Bridge commands = 0; Web acquisition = 0; GitHub writes = 0; Site mutations = 0.

## Publication boundary

- Local ZIP is an unaccepted Work return. Main Chat audits, publishes through the owner path, reads back and decides acceptance. M10B remains blocked until explicit acceptance.
