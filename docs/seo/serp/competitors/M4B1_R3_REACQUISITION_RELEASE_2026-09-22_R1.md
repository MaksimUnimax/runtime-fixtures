# Octoport SEO — M4B1 R3 evidence reacquisition release

Date: 2026-09-22
Status: **AUTHORIZED / WORK MAY START AFTER RELEASE READBACK**
WORK_ID: `OCTOPORT_SEO_M4B1_R3_REACQUISITION_2026-09-22_R1`
Branch: `seo/wordstat-batch-01-2026-09-16`

Preparation gate:
`M4B1_R3_REACQUISITION_GATE_2026-09-22_R1.md`

Preparation commit:
`e90bdb0439dbb1bc7f5d742712f27b3628c1378e`

Preparation remote readback:
`PASS`

## Purpose

Reacquire only the lost M4B1 R3 bounded page-surface evidence from the frozen accepted R1+R2 authority.

This is not:
- M4A;
- M4B1 R1 restart;
- M4B1 R2 restart;
- M4B2;
- M4Q;
- M4C;
- historical byte reconstruction.

## Frozen execution unit

Exactly 45 accepted M4B1 entities.

Pre-R3 durable universe:

```text
R1 URL rows = 372
R1 page evidence = 249
R2 initial navigation delta = 835
R2 recursive new URL identities = 405
R2 page evidence = 579
PRE_R3_NORMALIZED_UNIVERSE = 1612
```

Work must verify frozen blob identities from the gate before acquisition.

## Method

Use the current M4 Level2 and bounded-frontier correction.

Close only:

```text
ANCHORS
PRIMARY_NAV_TAXONOMY
BREADCRUMB_OR_LOCAL_SUBTREE
SCOPED_SITEMAP
PAGINATION_OR_LOAD_MORE
NEW_ELIGIBLE_URL_DELTA
```

No arbitrary sampling.
No full internal-link graph.
No replay of the R2 416 diagnostic set.

## Historical comparator

Historical R3 aggregates carried by later accepted authority:

```text
R3_NEW_IN_SCOPE_NORMALIZED_IDENTITIES = 2888
R3_NEW_INSPECTED_IDENTITIES = 2845
R3_EXECUTION_ENVIRONMENT_FAILURE_TERMINALS = 43
POST_R3_MERGED_NORMALIZED_UNIVERSE = 4500
OPEN_URL_UNRESOLVED = 0
SILENT_URL_LOSS = 0
```

These are regression comparators only. Do not force the fresh result to match.

## External action

Current public browsing is authorized only inside the frozen 45-entity scope and bounded channels.

No:
- Search provider;
- Wordstat;
- Alice/GenSearch;
- M4Q reverse-index provider;
- login/CAPTCHA/paywall/private API bypass;
- new competitors;
- whole-domain crawl.

## Work / large data

`WORK_TRIGGER = MET`.

Process the complete bounded unit in ChatGPT Work.

## Outputs

Exactly 9:

1. `M4B1R3R1_SOURCE_MANIFEST.md`
2. `M4B1R3R1_DISCOVERY_CHANNEL_COVERAGE.tsv`
3. `M4B1R3R1_URL_OVERLAY.tsv`
4. `M4B1R3R1_PAGE_EVIDENCE_OVERLAY.tsv`
5. `M4B1R3R1_CANDIDATE_TERMS_OVERLAY.tsv`
6. `M4B1R3R1_ENTITY_SYNTHESIS_CURRENT.tsv`
7. `M4B1R3R1_FRONTIER_RECONCILIATION.tsv`
8. `M4B1R3R1_QA.md`
9. `M4B1R3R1_RETURN_MANIFEST.json`

## Return

Work writes nothing to GitHub.

Return one ZIP containing exactly the 9 outputs.

Owner staging:

`docs/seo/serp/competitors/work_return/M4B1_R3_REACQUISITION_2026-09-22_R1/`

Final Work response must include:
- verdict;
- START_HEAD;
- END_OBSERVED_HEAD;
- authority drift state;
- exact output count;
- ZIP SHA-256;
- one real direct/clickable downloadable ZIP artifact link.

Conversation URL != ZIP link.

After owner upload Main Chat performs remote readback and dependency reconciliation before M4C.
