# Octoport SEO — M4B2 context/baseline public-surface acquisition gate

Date: 2026-09-22
Status: **PREPARED / REMOTE READBACK REQUIRED / WORK NOT YET AUTHORIZED**
WORK_ID: `OCTOPORT_SEO_M4B2_CONTEXT_BASELINE_2026-09-22_R1`
Stage: M4 — Search competitor + landing corpus
Substep: M4B2 — editorial/native/context baseline public-surface expansion
Preparation base HEAD: `b76780f21db16493696cdcb179cc28c72af64459`

## 1. Entry state

Accepted upstream authority:

- M4A R3 = ACCEPTED;
- M4B1 PRODUCT/VENDOR page surface = ACCEPTED;
- M4B1 final terminal universe = 9,965;
- M4Q remains separate and required before M4C.

M4B2 is the second deterministic M4B execution unit. It is not sampling.

Accepted M4A unit:

- `EDITORIAL_OR_PUBLISHER`: 12 entities / 32 accepted page-candidate anchors;
- `NATIVE_MARKETPLACE_BASELINE`: 2 entities / 8 accepted page-candidate anchors;
- `AGGREGATOR_DIRECTORY`: 1 entity / 3 accepted page-candidate anchors.

Expected:

```text
M4B2_REGISTRY_ENTITIES = 15
M4B2_ACCEPTED_PAGE_CANDIDATE_ANCHORS = 43
```

## 2. Zero-anchor registry correction

Independent preparation QA found two accepted M4A registry entities with zero rows in `M4A_PAGE_CANDIDATES.tsv`:

- REG032 Reg;
- REG033 Rutube.

They remain accepted registry entities and must not disappear silently.

Their accepted M4A registry rows point to four accepted Search occurrence URLs:

- REG032: R07-12, R12-18;
- REG033: R03-19, R07-20.

Therefore the job freezes:

```text
PAGE_CANDIDATE_ANCHORS = 43
ZERO_ANCHOR_REGISTRY_BOOTSTRAP_URLS = 4
TOTAL_EXECUTION_SEED_ROWS = 47
```

The four bootstrap rows do **not** retroactively change M4A's accepted page-candidate count. They are a job-level anti-loss seed mechanism derived from the already accepted M4A occurrence ledger.

Frozen manifest:

`docs/seo/serp/competitors/M4B2_AUTHORITY_MANIFEST_2026-09-22_R1.tsv`

Blob:

`11da16864f67aa4daeabdffef7c8eaaa178bb2ff`

## 3. Two-level preparation gate

Main Chat read from the live branch:

LEVEL 1:
- `docs/seo/LEVEL1/README.md`;
- universal persistence / Work / quality rules through Level1 authority.

LEVEL 2:
- `docs/seo/LEVEL2/README.md`;
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`;
- `docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md`.

Current accepted evidence:
- M4A R3 Main Chat return QA;
- accepted M4A registry/page candidates/occurrence ledger;
- M4B1 R5 A1 final acceptance;
- current `M4_PROGRESS.md`;
- M4B1 failure history, especially the correction `COMPLETE_BOUNDED_FRONTIER != COMPLETE_INTERNAL_LINK_GRAPH`.

## 4. Fresh external method check — 2026-09-22

Current Yandex Webmaster guidance was rechecked before this preparation.

### Search quality
https://yandex.com/support/webmaster/en/search-quality

Yandex states that page quality includes relevance to the query, likelihood of solving the user's objective, usefulness/uniqueness, credibility where material, and ease of consumption.

M4B2 application:
capture page role, user job, evidence/proof, freshness/authority cues and information presentation separately. Keyword presence alone is not treated as competitive value.

### Site structure
https://www.yandex.com/support/webmaster/en/recommendations/site-structure

Yandex recommends clear link structure and notes that crawler discovery depends on links and nesting.

M4B2 application:
public navigation/breadcrumb/taxonomy is a valid discovery channel, but generic site-wide navigation is not permission for whole-domain crawl.

### Sitemap
https://yandex.com/support/webmaster/en/controlling-robot/sitemap

Yandex describes Sitemap as a page-URL structure signal and specifically useful for large/deep sites.

M4B2 application:
sitemap is a canonical bounded discovery channel only when entries can be deterministically scoped to the frozen relevant subtree/surface.

### Pagination/indexing behavior
https://www.yandex.com/support/webmaster/en/yandex-indexing/site-indexing

Current Yandex documentation says `rel=prev/next` is ignored and paginated pages can be indexed.

M4B2 application:
do not infer collection closure from rel metadata alone; enumerate the public sequential pagination/load-more mechanism where applicable.

### Public accessibility / information presentation
https://yandex.com/support/webmaster/en/recommendations/presentation

Yandex notes that its robot cannot perform registration/code/query actions to expose hidden information.

M4B2 application:
only public legitimately accessible surfaces count; no login/CAPTCHA/paywall/private-API bypass.

## 5. Frozen upstream inputs

Accepted M4A R3 blobs:

- competitor registry: `822155d7cebcbcf5cf8cdaef0f92782d5f84cd59`;
- page candidates: `c388aba7b1deaded3b5bb46b9d39212cf3eb94db`;
- occurrence ledger: `0028a743c8617c569ba37dfa4b59e92b5f56e18d`.

Accepted M4B1 current acceptance:

`docs/seo/serp/competitors/M4B1_R5_A1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-22.md`

Work preflight must reconcile exactly:

```text
15 authorized entities
43 M4A page-candidate anchors
4 zero-anchor bootstrap URLs
47 total seed rows
```

Any material mismatch = HOLD.

## 6. Exact authorized entities

### Editorial / publisher — 12
- REG005 Api Master
- REG010 Habr
- REG017 Klerk
- REG032 Reg
- REG033 Rutube
- REG036 Sellego
- REG043 Skillbox
- REG047 Tbank
- REG048 Tochka
- REG052 VC.ru
- REG054 Wbstat
- REG059 YouTube

### Native marketplace baseline — 2
- REG030 Ozon
- REG055 Wildberries

### Aggregator/directory — 1
- REG057 Yandex

No other registry entity may enter M4B2.

## 7. Scope policy

Every entity receives exactly one of the existing Level2 policies:

- `THEME_SCOPED_PUBLIC_TAXONOMY`;
- `EVIDENCE_ANCHORED_RELEVANT_SUBTREE`.

### Broad editorial/publisher/platform sites

Default:
`EVIDENCE_ANCHORED_RELEVANT_SUBTREE`.

The following are **not** sufficient scope authority by themselves:
- generic AI category;
- generic marketing/business/news category;
- platform homepage;
- recommendation widget;
- unrelated footer/sitewide links;
- site search results.

For Habr, VC.ru, Skillbox, Tbank, Tochka, Klerk, Reg and similar broad sites, only anchor-local marketplace/seller/AI-for-marketplace subtrees or deterministically relevant public taxonomies may expand.

### Video platforms

Rutube and YouTube:
- exact accepted/bootstrapped videos are valid seeds;
- video metadata, uploader/channel context and directly necessary canonical/redirect evidence may be inspected;
- recommendation widgets / "related videos" do not become frontier authority;
- no platform-wide or generic channel crawl unless a narrowly relevant same-entity public collection is explicitly proven and scoped.

### Native marketplace baselines

Ozon and Wildberries are **native baseline**, not third-party product competitors.

Allowed:
- accepted official seller/help/developer anchors;
- same-official-surface navigation/breadcrumbs;
- directly relevant seller-help subtrees;
- scoped public sitemap/pagination when deterministically limited to the accepted seller/help surface.

Forbidden:
- marketplace catalog/product browsing;
- consumer storefront expansion;
- arbitrary corporate/news expansion;
- treating native product behavior as Octoport capability.

Accepted anchor subdomains are authoritative starting surfaces. Other sibling subdomains require explicit equivalence or redirect/canonical proof.

### REG057 Yandex aggregator/directory

The accepted registry entity spans distinct accepted surfaces including:
- `partner.market.yandex.ru`;
- `practicum.yandex.ru`.

Treat each accepted surface as a separate scoped host/subtree under REG057.
Do not expand to generic `yandex.ru` or unrelated Yandex products.

## 8. Bounded discovery-channel closure

For every one of the 15 entities account for:

1. accepted anchor/bootstrap seeds;
2. primary public navigation/relevant taxonomy;
3. breadcrumb/local subtree where applicable;
4. scoped public sitemap/sitemap index;
5. pagination/load-more for eligible collections;
6. redirects/canonicals from eligible URLs.

Hard invariant:

```text
COMPLETE_BOUNDED_FRONTIER != COMPLETE_INTERNAL_LINK_GRAPH
```

Ordinary article-body links, recommendation widgets, generic footer links and unrelated adjacent editorial content do not automatically expand the frontier.

If a generic category is too broad to be deterministically relevant, terminalize the channel with `UNSCOPABLE_WITH_REASON`; do not import the whole category.

## 9. URL and terminal-state contract

Preserve:
- seed/source URL;
- discovered URL;
- normalized comparison URL;
- redirect chain;
- final URL;
- declared canonical where observable;
- source channel;
- terminal state.

Canonical terminal states may include:
- INSPECTED;
- OUT_OF_SCOPE;
- DUPLICATE_CANONICAL;
- FACET_OR_SORT_VARIANT;
- NON_HTML;
- ROBOTS_OR_SITE_POLICY_BLOCKED;
- AUTH_REQUIRED;
- CAPTCHA_OR_ANTI_BOT;
- HTTP_ERROR;
- TIMEOUT;
- NOT_FOUND;
- REDIRECT_IN_SCOPE;
- REDIRECT_OUT_OF_SCOPE;
- DYNAMIC_UNRESOLVED;
- EXECUTION_ENVIRONMENT_FAILURE;
- ACCESS_BLOCKED;
- UNSCOPABLE_WITH_REASON;
- ERROR.

Tool/browser failure is not a site fact.

## 10. Page evidence

Every INSPECTED identity needs structured evidence.

Required fields:

`page_id, url_id, registry_id, entity_name, candidate_class, final_url, captured_at, page_role, title, meta_description, h1, heading_structure_summary, breadcrumb_summary, marketplace_scope, ai_llm_scope, user_jobs, data_scope, capability_claims, action_boundary_claims, integrations, pricing_availability, cta, proof_trust_cases, faq_subtopics, author_freshness, internal_link_pattern, structured_data_observed, evidence_locator, claim_confidence, octoport_overlap, octoport_difference, notes`.

No full-page text/HTML deliverables.

Native marketplace claims remain `NATIVE_BASELINE_EVIDENCE`.
Editorial statements remain `EDITORIAL_CONTEXT_EVIDENCE`.
Neither becomes Octoport product truth.

## 11. Candidate register

Every candidate term/task needs page provenance.

Minimum fields:

`candidate_id, registry_id, page_id, raw_term_short, evidence_locator, candidate_type, normalized_key, relation_to_existing_octoport_evidence, status, m6_validation_required, reason`.

Statuses:
- ALREADY_PRESENT;
- NEW_CANDIDATE;
- POSSIBLE_VARIANT;
- OUT_OF_SCOPE;
- AMBIGUOUS.

Competitor/editorial/native topic != proven demand.

## 12. Current-state outputs

Exactly 9 Work outputs:

1. `M4B2_SOURCE_MANIFEST.md`
2. `M4B2_DISCOVERY_CHANNEL_COVERAGE.tsv`
3. `M4B2_URL_LEDGER.tsv`
4. `M4B2_PAGE_EVIDENCE.tsv`
5. `M4B2_CANDIDATE_TERMS.tsv`
6. `M4B2_ENTITY_SYNTHESIS_CURRENT.tsv`
7. `M4B2_FRONTIER_RECONCILIATION.tsv`
8. `M4B2_QA.md`
9. `M4B2_RETURN_MANIFEST.json`

Coverage and reconciliation tables contain the complete current 15-entity state, not only residuals.

## 13. Hard QA

PASS-candidate requires:

```text
LIVE_BRANCH_FETCHED = true
M4B1_FINAL_ACCEPTANCE_CURRENT = true
M4B2_REGISTRY_ENTITIES = 15
M4B2_ACCEPTED_PAGE_CANDIDATE_ANCHORS = 43
ZERO_ANCHOR_REGISTRY_ENTITIES = 2
ZERO_ANCHOR_BOOTSTRAP_URLS = 4
TOTAL_EXECUTION_SEED_ROWS = 47
ALL_47_SEEDS_ACCOUNTED = true
UNAUTHORIZED_REGISTRY_ENTITIES = 0

DISCOVERY_CHANNEL_ROWS = 15
EVERY_APPLICABLE_CHANNEL_TERMINAL = true
EVERY_DISCOVERED_ELIGIBLE_URL_TERMINAL = true
OPEN_URL_UNRESOLVED = 0
BLOCKING_CHANNEL_HOLD = 0

ARBITRARY_SAMPLING = 0
WHOLE_DOMAIN_CRAWL = 0
GENERIC_CATEGORY_SCOPE_EXPANSION = 0
SILENT_URL_LOSS = 0
EXECUTION_ENV_FAILURES_SEPARATED_FROM_SITE_FAILURES = true

ALL_INSPECTED_PAGES_HAVE_EVIDENCE_ROWS = true
ENTITY_SYNTHESIS_ROWS = 15
FRONTIER_RECONCILIATION_ROWS = 15
CANDIDATE_TERMS_HAVE_PAGE_PROVENANCE = true

EDITORIAL_OR_NATIVE_TOPIC_TREATED_AS_PROVEN_DEMAND = 0
EDITORIAL_OR_NATIVE_CLAIM_TREATED_AS_OCTOPORT_FACT = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0

SEARCH_PROVIDER_CALLS = 0
WORDSTAT_CALLS = 0
ALICE_CALLS = 0
M4Q_CALLS = 0
GITHUB_WRITES_BY_WORK = 0
OPEN_CRITICAL_DEFECTS = 0
```

If browser/environment or scope closure cannot be completed, return `PARTIAL / RECOVERY_REQUIRED` with exact entity/channel/URL residuals.

No fake PASS.

## 14. Work trigger

`WORK_TRIGGER = MET`.

Reason:
15 authorized entities + 43 accepted anchors + 4 bootstrap seeds + live public page-surface discovery can generate large bounded collections. Full-volume Work avoids representative sampling and skipped joins.

Main Chat does governance/research/release once.
Work performs released execution plus narrow live-authority drift preflight.

## 15. Publication path

Work performs no GitHub write.

Owner uploads all 9 unpacked output files together to:

`docs/seo/serp/competitors/work_return/M4B2_CONTEXT_BASELINE_2026-09-22_R1/`

Main Chat performs remote readback and independent acceptance QA.
