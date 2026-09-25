# Octoport SEO — M11 final page ownership + IA — STEP PREPARATION — 2026-09-25 R1

Status: **PREPARATION COMPLETE / WORK REQUIRED / NO SITE IMPLEMENTATION**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation parent HEAD: `b75a298cfff712a5e9e5250ad700dbd4a2ed5c1d`

## 1. Cursor

```text
M0..M9 = ACCEPTED
M10A = ACCEPTED / FROZEN SEARCH-ONLY BASELINE
M10B = ACCEPTED
M10C = ACCEPTED
M10D = ACCEPTED
M11 = CURRENT PREPARATION
M12+ = BLOCKED
```

M11 purpose:
materialize final governed cluster→page ownership and information architecture by applying only causally supported M10D constraints to the frozen M10A Search baseline, while respecting accepted M8/M9 Search evidence and product truth.

M11 is the first stage allowed to assign final page-owner roles and IA.
M11 does not implement site files and does not write final H1/Title/content specs.

## 2. Governing method

Read and obey:
- `docs/seo/LEVEL1/README.md`
- `docs/seo/EXECUTION_RULES.md`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md`
- `docs/seo/WORK_HANDOFF_RULE.md`
- `docs/seo/METHODOLOGY.md`
- `docs/seo/PRODUCT_TRUTH.md`
- `docs/seo/LEVEL2/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md`
- `docs/seo/LEVEL2/M5_M10_SEARCH_ONLY_AND_ALICE_SEQUENCE_RULES.md`
- `docs/seo/FAILURE_LEDGER.md`

## 3. Fresh current method check — 2026-09-25

Official Yandex sources checked:
- Site structure: https://www.yandex.com/support/webmaster/en/recommendations/site-structure
- Internal links: https://yandex.com/support/webmaster/en/site-indexing/links-to-website
- Canonical URLs: https://yandex.com/support/webmaster/en/robot-workings/canonical
- Duplicate pages: https://www.yandex.com/support/webmaster/en/robot-workings/double

Current project application:
- every indexable owner page must belong to a clear link hierarchy and be crawlable through ordinary HTML links;
- orphan planned targets are forbidden;
- duplicate/similar page purpose is a material cannibalization/indexing risk;
- one canonical owner should serve one coherent page job;
- deeper IA requires justification; do not manufacture nested pages without distinct tasks;
- canonical/indexing implementation is specified later, but M11 must avoid architecture that inherently creates duplicate-purpose pages.

## 4. Current physical site continuity

M10A site-source head:
`f079c2e7199250397259ea9ede10a4f72694f5c1`.

Current `main` head checked 2026-09-25:
`7945d62854e135421c3db003c603187b9f37866b`.

The 33 commits since M10A changed server/extension/monitoring/contracts/coordination paths, not public site-page files.

Current main blobs match M10A byte-for-byte:
```text
apps/site/public/index.html   = 3123a714e2092fb156eebe498ef97bb5969567f6
apps/site/public/install.html = 99bc456742375219779ae9c611580e389b81c7a1
apps/site/public/privacy.html = bb975f29e3fbe8e1cfeb1fa19f397f9e5dc1f101
apps/site/public/support.html = 2ebb8fdab73c50d98a3af70198f98813cbab942b
```

Therefore M10A physical site surface is current for M11.
If any of these four blobs changes before Work execution/delivery, Work must report site-surface authority drift and revalidate affected owner decisions.

## 5. Accepted decision chain

M8 accepted Search semantic authority:
- acceptance blob `9624decd46ae12c9a6c8faf139bec9ebf545adae`
- semantic identity master blob `2faaca90c49d5e2ca9c5121c1ef187b3a3f6844f`
- 7,913 identities; M11 joins only identities present in accepted M9 membership.

M9 accepted Search-only clustering/boundary authority:
- terminal acceptance blob `f35e5132d64ade78ce6c8fb8a2aea2292f41c02a`
- R2 cluster master blob `5d9d86bf87a3c6306db496a577b954ea0cfe4efc`, 104 rows
- R2 membership blob `7df5d573e823c3eea49f0010ad13b78d0a396215`, 104 rows
- R2 pairwise evidence blob `a63c0db1ff57bdc922147057542c0a936a70b0b6`, 5,356 rows
- R2 HOLD ledger blob `09e73bb2b89c03b77a1e4fc88aba801e90c01c60`, 1,399 rows

Accepted M9 pairwise state:
```text
PAIR_ROWS = 5356
MERGE_SUPPORTED = 28
SPLIT_SUPPORTED = 3835
HOLD_BOUNDARY = 1493
MATERIAL_HOLD = 1399
```

M10A accepted Search-only page/IA baseline:
- acceptance blob `a0cc44f9631067f4938044fe0a4c21e6ed4898cb`
- cluster baseline blob `81a385400dffce94441525938ac4916d4db95cc2`, 104 rows
- boundary baseline blob `aafa9698cc1cc83751699ac45048b53d5505f96b`, 1,399 rows
- existing site surface blob `b1805310f77263a8734260fafb00ef0c5025d44a`, 4 rows

M10D accepted causal reconciliation:
- acceptance blob `afa6aeca62d59c41fa41cef997e5eee810693812`
- case reconciliation blob `07741bfca8f95e726998cdc14920e78c17d4519a`, 15 rows
- cluster delta XREF blob `78a756a88c5c123ad59449df918671ec3871c2ef`, 184 rows
- boundary delta XREF blob `1f3925005710de7c739303e0fc8db9d09930b17d`, 166 rows
- cross-case reconciliation blob `d9db28eed89f00f9cf6bf0373890f8c4667ae4ea`, 74 rows
- case evidence summary blob `db35b725fe74d41bc8945a63b515678a698871c2`, 15 rows

Accepted M10D outcomes:
```text
CHANGE = 0
DE_RISK = 4
ENRICH = 6
NO_CHANGE = 0
HOLD = 5
```

## 6. M11 evidence hierarchy

```text
PRODUCT_TRUTH
+ ACCEPTED M8 SEARCH SEMANTICS / DEMAND PRIORITY
+ ACCEPTED M9 SEARCH TASK + PAIRWISE CLUSTER EVIDENCE
+ FROZEN M10A SEARCH-ONLY OWNER/IA HOLD BASELINE
+ ACCEPTED M10D TARGET-SPECIFIC CAUSAL CONSTRAINTS
-> M11 FINAL OWNERSHIP / IA
```

M10D does not replace Search evidence.
M10D ENRICH does not resolve a HOLD automatically.
M10D DE_RISK narrows only named targets/dimensions and is not automatic CREATE authority.
M10D HOLD remains unresolved.
M10D CHANGE would permit reconsidering contradictory Search interpretation, but accepted M10D has `CHANGE=0`.

## 7. Hard pairwise rules

Because accepted M10D has no CHANGE:
- M9 `SPLIT_SUPPORTED` must never be collapsed into one page owner.
- M9 `MERGE_SUPPORTED` is positive same-owner evidence but does not override an unresolved material HOLD elsewhere in the proposed page-job group.
- M9 material HOLD remains unresolved unless M10D provides a target-specific effect that, together with Search/task/product evidence, safely resolves that exact owner boundary in M11.
- an `ENRICH_ONLY` M10D effect cannot by itself convert a material HOLD to same-owner or separate-owner authorization.
- a target-level M10D HOLD cannot be silently resolved from another case.
- no lexical similarity-only grouping.

## 8. Page routing / physical action

Closed route vocabulary:
```text
HOME
MARKETPLACE_PAGE
FEATURE_OR_USE_CASE
LLM_INTEGRATION_PAGE
SUPPORT_OR_DOCS
ARTICLE_GUIDE
NO_INDEX_TARGET
HOLD
```

Closed physical-action vocabulary:
```text
KEEP
OPTIMIZE
CREATE
ROUTE_INTERNAL_LINK
RECHECK_HOLD
```

Rules:
- `KEEP` or `OPTIMIZE` requires a current physical page whose real purpose can truthfully own the page job.
- `CREATE` requires a distinct Search-supported user job, product-fit PASS, pairwise compatibility, no unresolved material owner boundary inside the proposed page group, and no duplicate page purpose.
- `ROUTE_INTERNAL_LINK` means no standalone target is needed; the cluster is secondary coverage of another governed owner and must have a valid owner + link route.
- `RECHECK_HOLD` means no safe owner/action is authorized.
- Privacy/support/install physical pages do not become SEO owners merely because they exist.
- no owner may promise unsupported write-back/autonomous capability.

## 9. Page owner identity

Existing physical page owner IDs are fixed if selected:
```text
M11PAGE_EXISTING_HOME
M11PAGE_EXISTING_INSTALL
M11PAGE_EXISTING_PRIVACY
M11PAGE_EXISTING_SUPPORT
```

Planned page owner ID:
`M11PAGE_<first16 lowercase SHA256(page_job_signature)>`.

`page_job_signature` must be recorded and constructed as:
```text
route_class
marketplace_scope
primary_user_job
sorted member_cluster_ids joined by newline
```
with exact newline separators and no hidden fields.

The ID is an analytical page-job identity, not a final URL.

## 10. Full-volume accounting / Work trigger

`WORK_TRIGGER_DECISION = WORK_REQUIRED`.

Required full-volume joins:
```text
M11_CLUSTER_DECISIONS = 104
M9_PAIRWISE_ROWS_ACCOUNTED = 5356/5356
M10A_MATERIAL_HOLD_ROWS_ACCOUNTED = 1399/1399
M10D_CLUSTER_DELTA_ROWS_ACCOUNTED = 184/184
M10D_BOUNDARY_DELTA_ROWS_ACCOUNTED = 166/166
M10D_CROSS_CASE_ROWS_ACCOUNTED = 74/74
M10A_EXISTING_SITE_SURFACES = 4/4
```

No sampling.

## 11. Required outputs — exactly 11

1. `M11_SOURCE_MANIFEST.md`
2. `M11_CLUSTER_FINAL_OWNERSHIP.tsv`
3. `M11_PAGE_OWNER_REGISTRY.tsv`
4. `M11_PAIRWISE_OWNER_COMPATIBILITY.tsv`
5. `M11_MATERIAL_HOLD_RESOLUTION.tsv`
6. `M11_EXISTING_SURFACE_DECISION.tsv`
7. `M11_IA_EDGE_REGISTRY.tsv`
8. `M11_CANNIBALIZATION_GUARD.tsv`
9. `M11_ADVERSARIAL_DIAGNOSTIC.tsv`
10. `M11_QA.md`
11. `M11_RETURN_MANIFEST.json`

## 12. Mandatory cluster decision fields

`M11_CLUSTER_FINAL_OWNERSHIP.tsv` exactly 104 rows.

Required columns:
```text
cluster_id
semantic_identity_id
canonical_cluster_label
primary_user_job
intent_primary
marketplace_scope
priority_tier
m10a_owner_state
m10a_page_role_state
m10d_target_effect_summary
final_owner_state
primary_page_owner_id
route_class
physical_action
owner_role_summary
secondary_coverage_state
parent_page_owner_id
internal_link_responsibility
material_boundary_state
decision_rationale
search_evidence_refs
m10d_evidence_refs
product_truth_refs
claim_boundary
```

Closed `final_owner_state`:
`OWNER_ASSIGNED | HOLD_NO_FINAL_OWNER`.

Every row must have exactly one assigned owner or explicit HOLD.

## 13. Page owner registry

One row per distinct assigned page owner.

Required columns:
```text
page_owner_id
page_job_signature
owner_origin
existing_surface_ref
route_class
marketplace_scope
primary_user_job
member_cluster_ids
primary_cluster_id
secondary_cluster_ids
physical_action
page_role_summary
parent_page_owner_id
child_page_owner_ids
required_internal_link_in_owner_ids
required_internal_link_out_owner_ids
indexability_intent
duplicate_purpose_guard
product_promise_boundary
priority_summary
evidence_refs
claim_boundary
```

`owner_origin = EXISTING_SURFACE | PLANNED_PAGE_JOB`.

Closed `indexability_intent`:
`INDEXABLE | NO_INDEX_SUPPORTING_SURFACE | HOLD`.

No final URL for planned page jobs.

## 14. Pairwise owner compatibility

`M11_PAIRWISE_OWNER_COMPATIBILITY.tsv` exactly 5,356 rows.

Preserve all 30 M9 pairwise input columns positionally, append:
```text
m10d_effect_summary
m11_owner_compatibility
owner_id_a
owner_id_b
m11_pair_disposition
m11_rationale
evidence_refs
```

Closed `m11_owner_compatibility`:
`SAME_OWNER_ALLOWED | SEPARATE_OWNER_REQUIRED | UNRESOLVED_HOLD | NOT_APPLICABLE_HOLD_OWNER`.

Closed `m11_pair_disposition`:
`SAME_OWNER | SEPARATE_OWNERS | HOLD | NON_OWNER_PAIR`.

Hard:
- every `SPLIT_SUPPORTED` pair among two assigned-owner clusters -> `SEPARATE_OWNER_REQUIRED`.
- same-owner assignment on a `SPLIT_SUPPORTED` pair = hard FAIL.
- same owner on material HOLD requires explicit target-specific M10D + Search/product rationale sufficient to resolve that exact pair; otherwise hard FAIL.

## 15. Material HOLD resolution

`M11_MATERIAL_HOLD_RESOLUTION.tsv` exactly 1,399 rows.

Preserve all 20 M10A boundary columns positionally, append:
```text
m10d_effect_summary
m11_hold_resolution
owner_id_a
owner_id_b
resolution_rationale
m11_evidence_refs
```

Closed `m11_hold_resolution`:
`RESOLVED_SAME_OWNER | RESOLVED_SEPARATE_OWNERS | REMAINS_HOLD | NON_OWNER_UNRESOLVED`.

Do not force resolution merely to increase architecture coverage.

## 16. Existing site surface decision

Exactly 4 rows, preserving current M10A physical surfaces.

Closed `surface_decision`:
`SEO_OWNER_KEEP | SEO_OWNER_OPTIMIZE | SUPPORTING_SURFACE_KEEP | NO_SEARCH_TARGET_KEEP | HOLD`.

No current physical page becomes an owner merely because it exists.

## 17. IA edge registry

One row per actual parent-child or required internal-link owner edge.

Required columns:
```text
edge_id
from_page_owner_id
to_page_owner_id
edge_type
direction_basis
anchor_role_guidance
required
evidence_refs
claim_boundary
```

Closed `edge_type`:
`PARENT_CHILD | CONTEXTUAL_INTERNAL_LINK | SUPPORT_LINK | NAVIGATION_LINK`.

No edge may point to a HOLD/nonexistent owner.
No assigned indexable owner may be orphaned.

## 18. Cannibalization guard

One row per assigned owner plus any explicit unresolved high-risk owner pair.

Required columns:
```text
guard_id
page_owner_id_a
page_owner_id_b
guard_state
overlap_scope
forbidden_primary_coverage
resolution_action
evidence_refs
claim_boundary
```

Closed `guard_state`:
`NO_MATERIAL_CONFLICT | DISTINCT_PAGE_JOBS | HOLD_POTENTIAL_CANNIBALIZATION`.

## 19. Hard prohibitions

```text
M8_MUTATIONS = 0
M9_MUTATIONS = 0
M10A_MUTATIONS = 0
M10D_MUTATIONS = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
SITE_MUTATIONS = 0
FINAL_PLANNED_URLS = 0
FINAL_H1_TITLE_DESCRIPTION = 0
M12_CONTENT_SPEC_EXECUTION = 0
FAKE_CREATE = 0
DUPLICATE_PAGE_PURPOSE = 0
PRODUCT_TRUTH_CONFLICT = 0
```

## 20. Stop / HOLD

Stop whole Work with HOLD if:
- binding input identity mismatch;
- current four site blobs drift;
- M8/M9/M10A/M10D accepted identities drift;
- 5,356 pairwise rows cannot be read;
- 1,399 M10A boundary rows cannot be read;
- exact 104 cluster set does not reconcile.

Row-level uncertainty -> `RECHECK_HOLD`, not invention.

## 21. Publication

Work writes no GitHub commits.

Staging path:
`docs/seo/work_return/M11_FINAL_PAGE_OWNERSHIP_IA_2026-09-25_R1/`

Main Chat independently QA's all returned artifacts before M12 can open.
