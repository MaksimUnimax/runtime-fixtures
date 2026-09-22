# M4B2 — canonical ChatGPT Work execution prompt

WORK_ID: OCTOPORT_SEO_M4B2_CONTEXT_BASELINE_2026-09-22_R1

CONTINUE THE EXISTING OCTOPORT SEO PROGRAM.

THIS IS AN EXECUTION TASK.

THIS IS NOT A NEW PROJECT.
THIS IS NOT M4B1.
THIS IS NOT M4Q.
THIS IS NOT M4C.
THIS IS NOT WORDSTAT.
THIS IS NOT ALICE.

Branch:

seo/wordstat-batch-01-2026-09-16

## Narrow startup preflight

Fetch the live branch and record HEAD.

Read:

- docs/seo/serp/competitors/M4B2_PRE_STEP_RESEARCH_AND_EXECUTION_GATE_2026-09-22_R1.md
- docs/seo/serp/competitors/M4B2_EXECUTION_RELEASE_2026-09-22_R1.md
- docs/seo/serp/competitors/M4B2_AUTHORITY_MANIFEST_2026-09-22_R1.tsv
- docs/seo/serp/competitors/M4B1_R5_A1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-22.md
- accepted M4A R3 registry/page-candidate/occurrence authority.

Reconcile exactly:

15 authorized registry entities.
43 accepted M4A page-candidate anchors.
2 accepted registry entities with zero page-candidate anchors.
4 exact accepted occurrence bootstrap URLs.
47 total execution seed rows.

Allowed candidate classes only:

EDITORIAL_OR_PUBLISHER
NATIVE_MARKETPLACE_BASELINE
AGGREGATOR_DIRECTORY

Material mismatch = HOLD.

Do not redo Main Chat methodology research.

## Execute complete M4B2

Process ALL 15 authorized entities and ALL 47 frozen seed rows.

NO sampling.
NO first-N.
NO remembered entity additions.
NO whole-domain crawl.

For every entity:

1. choose exactly one allowed Level2 scope policy:
   THEME_SCOPED_PUBLIC_TAXONOMY
   or
   EVIDENCE_ANCHORED_RELEVANT_SUBTREE;

2. seed from every authority-manifest row for that entity;

3. terminally account for the canonical bounded discovery channels:
   - anchors/bootstrap seeds;
   - primary public navigation/relevant taxonomy;
   - breadcrumb/local subtree where applicable;
   - scoped sitemap/sitemap index;
   - collection pagination/load-more where applicable;
   - redirects/canonicals from eligible URLs;

4. preserve discovered URL, source URL, normalized identity, redirect, canonical, final URL and terminal state separately;

5. terminalize every genuinely discovered eligible URL;

6. create structured page evidence for every INSPECTED identity;

7. create one current entity-synthesis row;

8. create one current frontier-reconciliation row;

9. extract provenance-backed candidate terms/tasks only where materially useful.

## Critical broad-site rule

COMPLETE_BOUNDED_FRONTIER != COMPLETE_INTERNAL_LINK_GRAPH.

Do NOT recursively expand:
- generic AI categories;
- generic marketing/business/news sections;
- recommendation widgets;
- unrelated article-body links;
- sitewide footer links;
- generic platform search results.

If a generic category cannot be deterministically scoped to the accepted marketplace/seller context, terminalize the channel as UNSCOPABLE_WITH_REASON instead of crawling it.

## Video-platform rule

For Rutube and YouTube:

- accepted/bootstrapped videos are valid seeds;
- inspect exact video surface and necessary uploader/canonical metadata;
- related/recommended videos are NOT frontier authority;
- no platform-wide crawl.

## Native-baseline rule

For Ozon and Wildberries:

- treat them as native marketplace baseline, not third-party competitors;
- stay inside accepted official seller/help/developer surfaces and directly relevant scoped descendants;
- do not crawl consumer marketplace catalogs/products;
- do not promote native features into Octoport capability claims.

## Yandex REG057 rule

The accepted Yandex entity includes distinct accepted surfaces such as partner.market.yandex.ru and practicum.yandex.ru.

Scope each accepted surface independently.

Do NOT expand to generic yandex.ru or unrelated Yandex products.

## Browser/environment rule

TOOL/BROWSER FAILURE != SITE UNAVAILABLE.

Do not convert:
- execution failure into HTTP_ERROR;
- CAPTCHA into NOT_FOUND;
- auth wall into OUT_OF_SCOPE.

Use the canonical evidence-backed terminal limitation state.

If a bounded channel genuinely cannot be terminalized, return PARTIAL with exact entity/channel state.

## Large-data rule

LARGE DATA != SAMPLE IT.

If sitemap or pagination exposes a large in-scope delta:

process the complete bounded delta in deterministic chunks.

Never truncate or substitute a representative subset.

## Exactly 9 outputs

1. M4B2_SOURCE_MANIFEST.md
2. M4B2_DISCOVERY_CHANNEL_COVERAGE.tsv
3. M4B2_URL_LEDGER.tsv
4. M4B2_PAGE_EVIDENCE.tsv
5. M4B2_CANDIDATE_TERMS.tsv
6. M4B2_ENTITY_SYNTHESIS_CURRENT.tsv
7. M4B2_FRONTIER_RECONCILIATION.tsv
8. M4B2_QA.md
9. M4B2_RETURN_MANIFEST.json

Follow exact schemas/gates in the M4B2 gate.

PASS requires:

- all 15 entities accounted;
- all 43 page-candidate anchors accounted;
- all 4 bootstrap URLs accounted;
- all 47 seed rows accounted;
- 15 discovery-channel rows;
- every applicable channel terminal;
- every discovered eligible URL terminal;
- open URL unresolved = 0;
- blocking channel HOLD = 0;
- silent URL loss = 0;
- 15 synthesis rows;
- 15 final reconciliation rows;
- no unauthorized entity;
- no arbitrary sampling;
- no whole-domain crawl;
- no competitor/editorial/native topic promoted to proven demand;
- no competitor/editorial/native claim promoted to Octoport fact;
- no final cluster/page/URL/H1/Title/IA decision;
- Search/Wordstat/Alice/M4Q calls = 0;
- GitHub writes = 0.

If a canonical channel or exact URL residual remains unresolved:

return PARTIAL / RECOVERY_REQUIRED with exact entity/channel/URL state.

Do not fake completion.

## Delivery

Create one ZIP containing exactly the 9 outputs.

Do not publish to GitHub.

Owner uploads all 9 unpacked files together to:

docs/seo/serp/competitors/work_return/M4B2_CONTEXT_BASELINE_2026-09-22_R1/

Main Chat performs final M4B2 acceptance QA.
