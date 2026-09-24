# M9 terminal Search-only HOLD source manifest
WORK_ID = OCTOPORT_SEO_M9_TERMINAL_HOLD_RECONCILIATION_2026-09-24_R1
START_HEAD = c20e333c04b42019589311c91095bb48911f35b5
END_OBSERVED_HEAD = c20e333c04b42019589311c91095bb48911f35b5
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED
Repository: `MaksimUnimax/runtime-fixtures`; branch: `seo/wordstat-batch-01-2026-09-16`.

## Required identity

Prompt Git blob `c9bdf5ee618e20d4985b5be0a178a7face75254a`; input manifest Git blob `535919cb6140f70fe6a8f4e326eb00a919ca8bd5`; pre-handoff Git blob `ccaef05269cb3784dcbcc3452c0ba7edcc93051c`. All accepted R2 frozen file blobs below match the binding manifest.

## Direct row sources

| Path | Role | Git blob | Bytes |
|---|---|---|---:|
| `docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_MAIN_CHAT_ACCEPTANCE_2026-09-24_R2.md` | ACCEPTED_R2_ACCEPTANCE | `2b5f6c0a29397de23abe21f3f36eb0ab6d9035b2` | 5267 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/M9_PAIRWISE_CLUSTER_EVIDENCE.tsv` | ACCEPTED_R2_PAIRWISE | `a63c0db1ff57bdc922147057542c0a936a70b0b6` | 4907618 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/M9_HOLD_BOUNDARY_LEDGER.tsv` | ACCEPTED_R2_HOLD | `09e73bb2b89c03b77a1e4fc88aba801e90c01c60` | 1448615 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/M9_IDENTITY_ELIGIBILITY_LEDGER.tsv` | ACCEPTED_R2_ELIGIBILITY | `dd4d9b5f4870fa71560109e77598cfacf9eb6e17` | 4594562 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/M9_CLUSTER_MASTER.tsv` | ACCEPTED_R2_CLUSTER_MASTER | `5d9d86bf87a3c6306db496a577b954ea0cfe4efc` | 110256 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_FULL_RERUN_2026-09-24_R2/M9_CLUSTER_MEMBERSHIP.tsv` | ACCEPTED_R2_MEMBERSHIP | `7df5d573e823c3eea49f0010ad13b78d0a396215` | 43286 |
| `docs/seo/work_return/M9_BOUNDARY_RESOLUTION_PREACQ_2026-09-24_R1/M9BR_IDENTITY_DISPOSITION.tsv` | ORIGINAL_QUERY_FORM_AND_PREACQ_DISPOSITION | `8a46d21e01bd732c1c982edda287f78d52c5e2ee` | 63307 |
| `docs/seo/M9_BOUNDARY_RESOLUTION_WAVE2_QUERY_MANIFEST_2026-09-24_R1.tsv` | WAVE2_EXECUTED_EXACT_QUERY_SET | `d0dacd0068d92ff5a68644e5fb203e5e988a8fcf` | 3741 |
| `docs/seo/M9_BOUNDARY_RESOLUTION_SEARCH_ANCHOR_MAP_2026-09-24_R2.tsv` | CURRENT_65_ANCHOR_MAP | `32b6ec36c1707808519d7f885f511f4258f117e1` | 45847 |
| `docs/seo/M9_PROGRESS.md` | CURRENT_CURSOR | `06572804daa21b205986c8f194f98d41addfd02f` | 24490 |

The manifest lists `M9_PROGRESS.md` as supporting mutable cursor with earlier blob `57209073890db7f577cbbd33992b86950ee0c8a5`. At START_HEAD its blob is `06572804daa21b205986c8f194f98d41addfd02f`; the byte diff adds this Work handoff/prompt and updates the owner-relay sentence. The prior Search data and frozen rules remain identical. The previous blob was checked against the current prefix, and current state was read. Authority drift of frozen inputs = none.

## Universal process, step method and history read

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
| `docs/seo/M9_BOUNDARY_RESOLUTION_RERUN_MAIN_CHAT_ACCEPTANCE_2026-09-24_R2.md` | `2b5f6c0a29397de23abe21f3f36eb0ab6d9035b2` |
| `docs/seo/M9_TERMINAL_HOLD_RECONCILIATION_INPUT_MANIFEST_2026-09-24_R1.json` | `535919cb6140f70fe6a8f4e326eb00a919ca8bd5` |
| `docs/seo/M9_TERMINAL_HOLD_RECONCILIATION_PRE_HANDOFF_2026-09-24_R1.md` | `ccaef05269cb3784dcbcc3452c0ba7edcc93051c` |
| `docs/seo/M9_TERMINAL_HOLD_RECONCILIATION_WORK_PROMPT_2026-09-24_R1.md` | `c9bdf5ee618e20d4985b5be0a178a7face75254a` |
| `docs/seo/M9_PROGRESS.md` | `06572804daa21b205986c8f194f98d41addfd02f` |
| `docs/seo/FAILURE_LEDGER.md` | `2527cb7adb10a57795f0b80f16660b4475f6e825` |

## Parsing and evidence boundaries

All eight authorized tabular source files were parsed from complete physical lines with literal TAB separator and CSV quote semantics disabled; every data line matched header width. Accepted 5,356-pair, 1,399-material-HOLD, 7,913-eligibility, 104-cluster, 104-membership, 104-preacquisition and 65-anchor inputs were joined on exact frozen IDs. The Wave2 exact query list (18 rows) was read only as executed-query history. No sampled/first-N analysis, audit fallback, outside web evidence or new query wording was used.
The output copies no mutable M9 pair or cluster authority. Query-form decisions trace to accepted preacquisition classifications. The only accepted unanchored exact query (`M8SID_aeb8b283519ced02`) has M2R/tested-seed lineage but zero current material-HOLD degree; this is not positive demand or a page decision.
Provider calls = 0; Bridge commands = 0; web acquisition = 0; GitHub writes = 0; Alice rows = 0; M10A page ownership/URL/H1/Title/IA decisions = 0.
