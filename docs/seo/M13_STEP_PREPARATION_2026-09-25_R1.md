# Octoport SEO — M13 technical SEO specification — STEP PREPARATION — 2026-09-25 R1

Status: **PREPARATION COMPLETE / MAIN CHAT EXECUTION READY AFTER REMOTE READBACK / NO SITE MUTATION**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation parent SEO HEAD: `07ac195167e8e0fe4adfb6a110116e604031b6c2`
Preparation current main HEAD: `7945d62854e135421c3db003c603187b9f37866b`

## 1. Cursor

```text
M0..M12 = ACCEPTED
M11/M12 CURRENT AUTHORITY = R2 PROVIDER-FREE CORRECTION
M13 = CURRENT PREPARATION
M14+ = BLOCKED
```

M13 purpose:
freeze a current-source-backed, testable technical SEO contract before any public-site code mutation.

M13 does not implement the site.

## 2. Mandatory authority

LEVEL 1:
- `docs/seo/LEVEL1/README.md` blob `4c3a30644ac736b926ec82bba6b1a6e33434ac06`
- `docs/seo/EXECUTION_RULES.md` blob `4e999af4826d6f72fd15f481a698f674c8ed2d5c`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md` blob `9917a52b837bcb8ae50eb63cc53e7becd1671b39`
- `docs/seo/WORK_HANDOFF_RULE.md` blob `71a031e74b921dade5998beb842fb3afcc4478e7`
- `docs/seo/METHODOLOGY.md` blob `6a85c53ec7994e3f68636dccc49c71d5be95d5ae`
- `docs/seo/PRODUCT_TRUTH.md` blob `6a469d5743142d3e476afa5d2cda653fd411ecb8`

Applicable LEVEL 2:
- `docs/seo/LEVEL2/M13_M18_IMPLEMENTATION_LAUNCH_MEASUREMENT_RULES.md`
  blob `fe11b327eefff20f6c807581ae947a78c6bcc6e8`

Current page architecture/spec authority:
- `docs/seo/M11_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md`
  blob `0fd15af86ba93a6eaae73b43f4507522576f0df3`
- `docs/seo/M11_CLUSTER_FINAL_OWNERSHIP_CURRENT_2026-09-25_R2.tsv`
  blob `d8b3b90e5c8624663daf732ca445512ce0d77950`
- `docs/seo/M11_PAGE_OWNER_REGISTRY_CURRENT_2026-09-25_R2.tsv`
  blob `0ee117f499fd129e7c11d8856c853e811e99ec15`
- `docs/seo/M11_EXISTING_SURFACE_DECISION_CURRENT_2026-09-25_R2.tsv`
  blob `d3c1149c5f6beae255cd64a2ae522da7102f98e3`
- `docs/seo/M12_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md`
  blob `782f182026172009a220e80a37b9c48e4017be11`
- `docs/seo/M12_PAGE_SPEC_REGISTRY_2026-09-25_R2.tsv`
  blob `53fd8d3217df7b00dbc644a4d396fcd258e497d8`
- `docs/seo/M12_CONTENT_BLOCK_CONTRACT_2026-09-25_R2.tsv`
  blob `b32e4b0c0f8255ef28035a2cf7ce1c804ef9fc10`
- `docs/seo/M12_INTERNAL_LINK_CONTRACT_2026-09-25_R1.tsv`
  blob `f35ca60c318efe0c74b2d6219bcb680943560c14`
- `docs/seo/M12_PROOF_TRUST_REQUIREMENTS_2026-09-25_R1.tsv`
  blob `7b5e5a523a877dad3a08343c681ed7a379ec2631`
- `docs/seo/M12_QA_2026-09-25_R2.md`
  blob `44992c67159ae6b6e0d8055cb597a8165d598f56`

Failure history:
- `docs/seo/FAILURE_LEDGER.md`
  blob `2527cb7adb10a57795f0b80f16660b4475f6e825`

## 3. Work trigger

`WORK_TRIGGER_DECISION = MAIN_CHAT_SAFE / WORK_NOT_REQUIRED`.

Reason:
the current technical universe is bounded and small:
- 2 indexable M12 SEO-target pages;
- 3 current supporting/service pages;
- one robots.txt;
- one sitemap.xml;
- one static CSS bundle;
- one public-site nginx ingress;
- one CI workflow;
- one deploy script;
- one live verifier;
- one site deployment regression test module.

No large joins or corpus transformation are required.
Main Chat can inspect 100% of the source surface and freeze the complete technical matrix without sampling.

## 4. Fresh official technical research — 2026-09-25

Official Yandex and Google sources were refreshed before this preparation.

### 4.1 Canonical / duplicate URLs

Yandex:
- https://www.yandex.ru/support/webmaster/ru/robot-workings/canonical
- https://yandex.com/support/webmaster/en/robot-workings/canonical

Supported fact:
`rel=canonical` is a recommendation and may be ignored; duplicate URLs should not be left to canonical markup alone when a clean redirect is available.

Google:
- https://developers.google.com/search/docs/crawling-indexing/canonicalization

Supported fact:
redirects, sitemap inclusion and rel=canonical are canonicalization signals; duplicate URL variants should converge on a consistent canonical target.

Project application:
known duplicate/alias public paths get permanent redirects to their one canonical URL.

### 4.2 robots / noindex

Yandex:
- https://yandex.com/support/webmaster/en/controlling-robot/robots-txt
- https://yandex.com/support/webmaster/en/controlling-robot/metatags
- https://www.yandex.com/support/webmaster/en/robot-workings/unhelpful

Supported fact:
robots.txt controls crawling; a URL blocked in robots.txt can still participate in search. To remove a crawlable page from search, use a robots meta/X-Robots noindex. If robots.txt blocks the page, the bot may not see the page-level noindex.

Project application:
service pages that should not be search targets remain crawlable and use `noindex, follow`; do not Disallow them in public robots.txt.

### 4.3 Sitemap

Yandex:
- https://www.yandex.ru/support/webmaster/en/controlling-robot/sitemap

Supported fact:
Sitemap should list canonical same-domain URLs and return 200.

Project application:
public sitemap contains only canonical indexable SEO target URLs.

### 4.4 Yandex AI eligibility

Yandex:
- https://yandex.com/support/webmaster/en/yandex-ai
- https://yandex.com/support/webmaster/en/robot-workings/check-yandex-robots

Supported fact:
Yandex AI uses pages already indexed by Yandex. Site owners can opt content out of AI answers using robots directives for `YandexAdditional` / `YandexAdditionalBot`.

Project application:
Octoport does NOT opt out.
Public robots.txt must not contain a Disallow rule for YandexAdditional/YandexAdditionalBot on the accepted indexable targets.

### 4.5 Content/rendering

Yandex:
- https://www.yandex.com/support/webmaster/en/robot-workings/vision

Supported fact:
logical HTML content, semantic heading hierarchy, accessible important content and lean rendering improve bot/user understanding; JS rendering can introduce indexing uncertainty.

Project application:
keep critical public SEO content in initial static HTML.
Do not introduce JS dependency for M14 SEO content.

### 4.6 Mobile

Yandex:
- current Webmaster mobile/site presentation guidance

Google:
- current Search / responsive web guidance

Project application:
same canonical URLs on mobile and desktop; keep viewport; no horizontal overflow at 320 CSS px; readable/clickable content; no mobile-only content loss.

### 4.7 Core Web Vitals

Google/web.dev current definitions:
- LCP good: <= 2.5 s
- INP good: <= 200 ms
- CLS good: <= 0.1
at the 75th percentile where field data exists.

Project application:
M15 checks field CWV where available.
For predeploy lab QA, INP is not fabricated from a lab run; TBT may be used only as a diagnostic proxy.
CWV is not treated as a universal ranking score or a replacement for content relevance.

### 4.8 Structured data

Yandex:
- current Schema.org support guidance

Google:
- https://developers.google.com/search/docs/appearance/structured-data/software-app

Google SoftwareApplication rich-result eligibility requires, among other required fields, `offers.price` and a rating or review.

Project application:
do NOT publish `SoftwareApplication` in M14 launch implementation.
Current Product Truth has no approved public pricing and no accepted public rating/review authority.
Do not invent price=0, reviews or ratings simply to satisfy markup.
Analytics page has no structured-data rich-result need.
Reopen structured data later if truthful complete data becomes available.

## 5. Current main technical baseline

Current main:
`7945d62854e135421c3db003c603187b9f37866b`.

Public source:
- `apps/site/public/index.html` blob `3123a714e2092fb156eebe498ef97bb5969567f6`
- `install.html` blob `99bc456742375219779ae9c611580e389b81c7a1`
- `privacy.html` blob `bb975f29e3fbe8e1cfeb1fa19f397f9e5dc1f101`
- `support.html` blob `2ebb8fdab73c50d98a3af70198f98813cbab942b`
- `robots.txt` blob `446df898e31b99b230e8a49a7c94a45e4df96228`
- `sitemap.xml` blob `fdceb2ff477941104373850846c33bac2a5d3ced`
- `styles.css` blob `cda70d351cb72332c70d7a32e5b31d3182e0a374`
- `apps/site/README.md` blob `28442c9c361e64e2fa161281db768a3dc6ca8ecc`

Ingress/deployment:
- `infra/production/nginx/octoport-site.conf`
  blob `4efcf08a2c118986496298789bac2565b1067994`
- `infra/production/nginx/octoport-apps.conf`
  blob `adbea6c2d6af15c0ed7bb05af1a7a7e05029d49f`
- `infra/production/scripts/deploy-octoport-site.sh`
  blob `f35a27b084ddce4cb9342852e5e35579ef0bc6b6`
- `infra/production/scripts/verify-octoport-site.sh`
  blob `753782280daa59bd0def52232b23465937f1a880`
- `.github/workflows/site-ci.yml`
  blob `9c6320dff4f45bf50cc86c1afcdf4893613e374f`
- `tests/regression/site/test_site_deployment.py`
  blob `79d5dca16f5fbb26c70450d6b121d59d281ecc69`

## 6. Current source observations

### Positive baseline

- static HTML/CSS; no executable JS in public pages;
- `lang=ru`;
- viewport present on all current pages;
- current pages have one H1;
- current pages have self-canonical URLs;
- HOME has unique description and Open Graph;
- nginx already uses HTTPS and permanent 308 redirects;
- HTTPS www redirects to canonical apex;
- app/api ingress is separate and already has `X-Robots-Tag: noindex, nofollow, noarchive`;
- unknown apex paths fall through to 404;
- source has responsive CSS;
- Site CI / deploy / verifier / regression machinery already exists.

### Current technical debt M13 must specify

1. planned `/seller-analytics` route/file does not exist;
2. public sitemap lists only HOME;
3. HOME does not link to analytics because the page is not implemented;
4. `/index.html` currently serves HOME content instead of redirecting to `/`;
5. raw `.html` page variants can be exposed by the generic static fallback;
6. trailing-slash service/target variants are not explicitly normalized;
7. HTTP `www` currently has an avoidable two-hop scheme+host redirect:
   `http://www -> https://www -> https://octoport.ru`;
8. support/privacy/install currently have no page-level noindex even though M11 assigned them no SEO owner;
9. current sitemap/CI/deploy/verifier are hard-coded to the pre-M12 page set;
10. current HOME Title/H1 are historical and must consume M12 R2 targets;
11. analytics metadata/OG/canonical/content route are absent;
12. support/privacy/install lack meta descriptions and may remain service-only pages;
13. no accepted structured data currently exists;
14. current site CI assumes sitemap contains exactly HOME and must be updated rather than bypassed.

## 7. Canonical origin and host policy

Canonical public origin:
`https://octoport.ru`.

Host/scheme requirements:

```text
http://octoport.ru/<path>?<query>
-> 308 https://octoport.ru/<path>?<query>

http://www.octoport.ru/<path>?<query>
-> 308 https://octoport.ru/<path>?<query>
(single host+scheme hop for ordinary canonical paths)

https://www.octoport.ru/<path>?<query>
-> 308 https://octoport.ru/<path>?<query>
```

For known path aliases combined with noncanonical scheme/host, canonical target should be reached in no more than two redirects and must never loop.

Do not redirect unknown/nonexistent public paths to HOME.
Unknown paths must remain 404 to avoid soft-404 behavior.

Do not change app/api/mail routing as part of M14 SEO implementation except where an exact public-site ingress change mechanically requires preservation tests.

## 8. Canonical route matrix

Canonical public routes:

```text
/                  -> 200 INDEXABLE
/seller-analytics  -> 200 INDEXABLE
/privacy           -> 200 NOINDEX_FOLLOW
/support           -> 200 NOINDEX_FOLLOW
/install           -> 200 NOINDEX_FOLLOW
/robots.txt        -> 200 text/plain
/sitemap.xml       -> 200 application/xml
/styles.css        -> 200 text/css
unknown public URL -> 404
```

Known duplicate aliases:

```text
/index.html             -> 308 /
/seller-analytics.html  -> 308 /seller-analytics
/privacy.html           -> 308 /privacy
/support.html           -> 308 /support
/install.html           -> 308 /install

/seller-analytics/      -> 308 /seller-analytics
/privacy/               -> 308 /privacy
/support/               -> 308 /support
/install/               -> 308 /install
```

Query strings must be preserved where semantically safe.
No canonical redirect chain on the HTTPS apex alias set.

## 9. Indexability policy

Only the two accepted M11 page owners are search targets:

```text
https://octoport.ru/
INDEXABLE
self canonical
robots meta may be omitted (default index/follow)

https://octoport.ru/seller-analytics
INDEXABLE
self canonical
robots meta may be omitted
```

Supporting/service surfaces:

```text
https://octoport.ru/privacy
NOINDEX_FOLLOW
self canonical

https://octoport.ru/support
NOINDEX_FOLLOW
self canonical

https://octoport.ru/install
NOINDEX_FOLLOW
self canonical
```

Reason:
M11 assigned no Search ownership to these three surfaces.
They remain valuable crawlable user/trust/support pages and may carry internal links, but M13 does not promote them into Search targets.

Do NOT block these pages in robots.txt, because crawlers must be able to read their noindex directive.

App/API current `X-Robots-Tag noindex,nofollow,noarchive` remains a do-not-change ingress boundary.

## 10. robots.txt specification

Required public robots policy:

```text
User-agent: *
Allow: /

Sitemap: https://octoport.ru/sitemap.xml
```

Hard:
- file at `/robots.txt`;
- UTF-8/text;
- HTTP 200;
- no Disallow for `/privacy`, `/support`, `/install`;
- no opt-out Disallow for `YandexAdditional` or `YandexAdditionalBot`;
- no block on CSS needed for rendering;
- no obsolete/staging hostname.

Yandex AI eligibility is intentionally preserved for indexable pages.

## 11. Sitemap specification

Sitemap contains exactly the accepted canonical indexable SEO targets:

```text
https://octoport.ru/
https://octoport.ru/seller-analytics
```

Exclude:
- privacy;
- support;
- install while noindex;
- all raw `.html` aliases;
- all trailing-slash aliases;
- www/http variants;
- app/api/admin routes;
- 404 URLs.

Use canonical absolute HTTPS apex URLs only.

For this tiny static site, use a simple `<loc>`-only sitemap.
Do not invent `lastmod`.
Current `changefreq` and `priority` are not required by the M13 contract and may be removed to keep one cross-engine source of truth.

Sitemap must be referenced in robots.txt and return 200.

## 12. Page metadata specification

### HOME

Consume current M12 R2:
```text
URL = https://octoport.ru/
ACTION = OPTIMIZE
H1 = Подключите ваш ИИ к Ozon и Wildberries
SUBHEADLINE = Ваш ИИ получает руки для работы с маркетплейсами.
TITLE = Подключите ваш ИИ к Ozon и Wildberries | Octoport
```

Description:
unique, truthful, concise explanation of selected user AI + Octoport browser bridge + permitted Ozon/WB data + read-only/closed-beta boundary.
Exact implementation wording may be finalized in M14 from M12 guidance without changing page intent.

Canonical:
`https://octoport.ru/`.

Open Graph:
- `og:type=website`
- `og:site_name=Octoport`
- `og:locale=ru_RU`
- unique aligned `og:title`
- unique aligned `og:description`
- `og:url=https://octoport.ru/`
- no fake `og:image` until an approved stable public asset exists.

### seller-analytics

Consume current M12 R2:
```text
URL = https://octoport.ru/seller-analytics
ACTION = CREATE
H1 = Анализируйте данные магазина на Ozon и Wildberries с вашим ИИ
TITLE = ИИ для аналитики маркетплейсов — данные вашего магазина | Octoport
```

Description:
unique, truthful seller-owned-data scope; selected user AI; no external intelligence or automatic mutation.

Canonical:
`https://octoport.ru/seller-analytics`.

Open Graph:
same required OG field set as HOME with analytics-specific title/description/url.
No fake `og:image`.

### privacy/support/install

Keep one current truthful H1/title each.
Add a unique non-empty meta description for user/browser/share clarity even though the page is noindex.
Add:
`<meta name="robots" content="noindex, follow">`.

Open Graph is optional and not an M14 blocking requirement for noindex utility pages.

## 13. Structured data

M14 launch target:

```text
HOME_STRUCTURED_DATA = NONE
ANALYTICS_STRUCTURED_DATA = NONE
SERVICE_PAGE_STRUCTURED_DATA = NONE
```

Do not add:
- SoftwareApplication;
- FAQPage;
- QAPage;
- Review/AggregateRating;
- Offer/price;
- BreadcrumbList
without a later specific accepted authority.

SoftwareApplication may be reopened only when all required public application facts are truthful and available, including accepted price state and real review/rating evidence where needed for the intended rich result.

## 14. Crawlable internal links / IA

Required ordinary HTML links:

```text
HOME -> /seller-analytics
relation = accepted M11 PARENT_CHILD
required = true

/seller-analytics -> /
relation = accepted M11 CONTEXTUAL_INTERNAL_LINK
required = true
```

Use regular `<a href="...">` links available in initial HTML.
Do not make the relationship JS-only.

Final anchor text may be implementation wording, but must truthfully describe:
- own-store analytics for HOME -> analytics;
- how Octoport connects the user's AI for analytics -> HOME.

No orphan indexable target.

Service-page links remain allowed but are not search-owner relationships.

## 15. Main content / rendering

Hard:
- important SEO content and accepted H1/title-page job must be represented in server/static HTML immediately;
- no JS requirement for primary text, internal links, canonical, meta robots or metadata;
- keep public site dependency-free static HTML/CSS unless M14 identifies a separately accepted concrete need;
- do not introduce client-render-only content as part of SEO implementation.

## 16. Mobile specification

For all public pages:
- one responsive URL per page;
- `<meta name="viewport" content="width=device-width, initial-scale=1">`;
- no separate m-dot/mobile canonical;
- no horizontal content overflow at 320 CSS px;
- H1/primary text/buttons/internal links usable without zoom;
- no hidden mobile variant that loses accepted content;
- CSS crawlable and served 200.

Current shared CSS may be extended for analytics but must retain the existing responsive foundation.

## 17. Performance / CWV specification

Preserve the current low-runtime architecture:
- no executable public JS unless separately justified;
- avoid unnecessary frameworks/dependencies;
- keep HTML/CSS/media reasonably small;
- no blocking third-party scripts in M14 SEO scope.

M15 lab QA:
- HOME mobile profile;
- seller-analytics mobile profile;
- no material performance regression against static baseline.

Field CWV acceptance when real data is available:
```text
LCP <= 2.5 s at p75
INP <= 200 ms at p75
CLS <= 0.1 at p75
```

If no field data exists at prelaunch, record `FIELD_DATA_NOT_AVAILABLE`; do not fail or fabricate it.

Lab tooling may use TBT diagnostically; TBT is not relabeled as INP.

No arbitrary Lighthouse performance score is used as a substitute for the actual technical checks above.

## 18. Open Graph vs Search metadata

Search Title/description and Open Graph are separate fields.

They should communicate the same truthful page job but are not required to be byte-identical.

Hard:
- OG must not introduce a capability absent from visible content;
- OG URL must equal canonical target;
- no public availability/pricing/write-back promise in OG;
- no image URL until a real approved public asset exists.

## 19. Current CI/deploy/verifier dependency map

M14 MUST update existing protections rather than bypass them.

### `.github/workflows/site-ci.yml`

Required updates:
- include `seller-analytics.html` in required site files;
- parse/validate its canonical/Title/H1/description/no unsupported claims;
- allow/verify HOME link to `/seller-analytics`;
- add `/seller-analytics` to approved local-link map;
- change sitemap expected canonical list from HOME-only to HOME + analytics;
- verify noindex on privacy/support/install;
- verify indexable target pages do not carry noindex;
- verify nginx seller-analytics route and alias redirects;
- preserve existing product-truth regression checks.

### `infra/production/scripts/deploy-octoport-site.sh`

Required updates:
- require `seller-analytics.html`;
- validate its self-canonical and key truth boundaries before install;
- preserve existing application-ingress safety and rollback boundaries.

### `infra/production/scripts/verify-octoport-site.sh`

Required updates:
- require deployed `seller-analytics.html`;
- live-check `https://octoport.ru/seller-analytics` returns 200;
- validate HOME/analytics Title/H1/canonical/content boundary;
- validate service noindex directives;
- validate sitemap URL set;
- validate alias redirects and host redirects;
- preserve portal/API/auth/TLS/old-docs safety checks.

### `tests/regression/site/test_site_deployment.py`

Extend tests for:
- seller-analytics presence;
- alias redirect contract;
- app ingress remains preserved;
- rollback still preserves application configuration;
- verifier failure still rolls back.

### `infra/production/nginx/octoport-site.conf`

Required updates:
- add canonical `/seller-analytics` route;
- add exact alias redirects;
- normalize raw `.html` and trailing slash aliases;
- direct HTTP www to HTTPS apex for ordinary paths;
- keep unknown paths 404;
- preserve security headers/cache behavior.

### `apps/site/README.md`

Update public file/route inventory and current technical indexability contract.

## 20. Do-not-change implementation boundary

M14 SEO implementation must not silently alter:
- `infra/production/nginx/octoport-apps.conf` application proxy behavior;
- portal/API auth/session behavior;
- server/extension code;
- DB/migrations;
- support/privacy substantive product truth beyond accepted M12/M13 needs;
- beta availability state;
- pricing;
- installed browser/provider support claims.

Any current-main drift in these boundaries must be reconciled, not overwritten.

## 21. M13 required outputs

M13 Main Chat execution produces exactly:

1. `M13_SOURCE_MANIFEST.md`
2. `M13_TECHNICAL_REQUIREMENTS.tsv`
3. `M13_ROUTE_HTTP_CANONICAL_MATRIX.tsv`
4. `M13_ROBOTS_SITEMAP_INDEXING_SPEC.tsv`
5. `M13_METADATA_STRUCTURED_DATA_SPEC.tsv`
6. `M13_PERFORMANCE_MOBILE_SPEC.tsv`
7. `M13_IMPLEMENTATION_FILE_MAP.tsv`
8. `M13_ADVERSARIAL_DIAGNOSTIC.tsv`
9. `M13_QA.md`

No Work ZIP because Work is not triggered.

## 22. Required output schemas

### M13_TECHNICAL_REQUIREMENTS.tsv

```text
requirement_id
topic
scope
current_state
required_state
source_basis
implementation_targets
acceptance_check
blocking
claim_boundary
```

### M13_ROUTE_HTTP_CANONICAL_MATRIX.tsv

One row per required canonical route/alias class.

```text
route_case_id
request_scheme
request_host
request_path
request_class
expected_status
expected_location
canonical_target
indexability
sitemap_state
acceptance_check
claim_boundary
```

### M13_ROBOTS_SITEMAP_INDEXING_SPEC.tsv

```text
surface_id
url
surface_role
robots_txt_crawl
robots_meta
canonical
sitemap
yandex_ai_eligibility
implementation_target
acceptance_check
claim_boundary
```

### M13_METADATA_STRUCTURED_DATA_SPEC.tsv

```text
surface_id
url
title_state
h1_state
description_state
canonical_state
og_state
structured_data_state
structured_data_reason
implementation_target
acceptance_check
claim_boundary
```

### M13_PERFORMANCE_MOBILE_SPEC.tsv

```text
check_id
scope
check_type
required_state
threshold_or_rule
measurement_stage
implementation_target
acceptance_check
claim_boundary
```

### M13_IMPLEMENTATION_FILE_MAP.tsv

```text
source_path
current_blob
change_class
required_change
do_not_change_boundary
test_or_verifier
m14_mutation_authorized
evidence_refs
claim_boundary
```

### M13_ADVERSARIAL_DIAGNOSTIC.tsv

```text
test_id
scenario
expected_guard
observed_preparation_state
verdict
evidence_refs
```

## 23. M13 hard gates

```text
CURRENT_M11_R2_AUTHORITY = PASS
CURRENT_M12_R2_AUTHORITY = PASS

CANONICAL_ORIGIN_DEFINED = true
INDEXABLE_TARGET_URLS = 2
SERVICE_NOINDEX_URLS = 3
UNKNOWN_ROUTE_404 = required

ROBOTS_POLICY_EXPLICIT = true
YandexAdditional_OPT_OUT = false
SITEMAP_CANONICAL_TARGETS = 2

HTML_ALIAS_REDIRECTS_SPECIFIED = true
TRAILING_SLASH_ALIAS_REDIRECTS_SPECIFIED = true
WWW_CANONICALIZATION_SPECIFIED = true
REDIRECT_LOOP_ALLOWED = false

CRAWLABLE_M11_LINKS = 2/2
ORPHAN_INDEXABLE_TARGETS_ALLOWED = 0

HOME_M12_R2_METADATA_MAPPED = true
ANALYTICS_M12_R2_METADATA_MAPPED = true
FAKE_STRUCTURED_DATA = 0

MOBILE_VIEWPORT_REQUIRED = true
FIELD_CWV_FABRICATION = 0

SITE_CI_UPDATE_REQUIRED = true
DEPLOY_SCRIPT_UPDATE_REQUIRED = true
LIVE_VERIFIER_UPDATE_REQUIRED = true
REGRESSION_TEST_UPDATE_REQUIRED = true

SITE_MUTATIONS = 0
MAIN_BRANCH_MUTATIONS = 0
M14_IMPLEMENTATION = 0
OPEN_CRITICAL_SPEC_DEFECTS = 0
```

## 24. First execution action after this preparation

Because failure OSEO-F02 forbids accepting pre-gate live checks, the FIRST M13 execution action after remote readback is a fresh read-only live technical baseline of:
- canonical apex;
- www/http redirects;
- HOME;
- privacy/support/install;
- robots.txt;
- sitemap.xml;
- representative duplicate aliases.

It must record actual HTTP status/location/header/body identity and must not mutate Webmaster, server or repository.

If live access is technically unavailable:
record `LIVE_BASELINE_UNAVAILABLE`.
Do not invent the live state.
M13 may still specify source-required behavior, but live-dependent current-state cells remain explicit UNKNOWN until M15/M16.

## 25. Stop / HOLD conditions

Stop M13 execution if:
- current M11 R2 or M12 R2 authority drifts;
- Product Truth changes materially;
- current main public-site files or ingress materially change after this preparation without reconciliation;
- site CI/deploy/verifier current blobs change before M13 execution;
- current app/api ingress safety boundary changes materially;
- a technical policy would require a new page/owner not accepted by M11/M12.

Do not fix source code in M13.

## 26. Publication / downstream boundary

M13 writes only `docs/seo/**`.

M14 is the first stage allowed to mutate public-site/ingress/CI implementation files after:
- M13 outputs complete;
- M13 QA PASS;
- Main Chat acceptance;
- current-main recheck;
- explicit bounded implementation handoff.

M14 must not treat this preparation file alone as implementation authorization.
