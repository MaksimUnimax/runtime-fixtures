# Octoport SEO — M13 external-method correction — STEP PREPARATION — 2026-09-25 R2

Status: **PREPARED / EXECUTION BLOCKED UNTIL REMOTE READBACK**
WORK_ID: OCTOPORT_SEO_M13_EXTERNAL_METHOD_CORRECTION_2026-09-25_R2

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
LIVE_SEO_HEAD: `85f8e20fb455748564dedc91ab2084466601d4a9`
CURRENT_MAIN_HEAD: `651e756fb0038a2895bf870855de21e990ca2b46`

## 1. Purpose

Perform a bounded provider-free correction of the accepted M13 technical SEO specification after an independent fresh external-method audit.

This is NOT:
- M14 implementation;
- site/nginx/main mutation;
- a new page-owner/cluster decision;
- provider acquisition;
- a rewrite of accepted redirects/canonical/mobile/CWV/rendering mechanics.

M14 preparation remains blocked until this correction is accepted.

## 2. Mandatory two-level authority read

LEVEL 1 read:
- `docs/seo/LEVEL1/README.md` blob `4c3a30644ac736b926ec82bba6b1a6e33434ac06`
- `docs/seo/EXECUTION_RULES.md` blob `4e999af4826d6f72fd15f481a698f674c8ed2d5c`
- current Product Truth read.

LEVEL 2 read:
- `docs/seo/LEVEL2/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M13_M18_IMPLEMENTATION_LAUNCH_MEASUREMENT_RULES.md`

Failure history:
- `docs/seo/FAILURE_LEDGER.md`

Current M13 authority:
- `docs/seo/M13_QA.md` blob `3d3c392c9a56b2e4e04402067a2f47973d8bb5b2`
- `docs/seo/M13_PROGRESS.md` blob `95691a2c1d2840d1accd14f776deb3ef34319c58`
- R1 technical matrices and implementation map.

## 3. Fresh external sources checked

Official Google:
- https://developers.google.com/search/docs/crawling-indexing/block-indexing
- https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- https://developers.google.com/search/docs/appearance/favicon-in-search
- https://developers.google.com/search/docs/appearance/site-names
- https://developers.google.com/search/docs/appearance/structured-data/organization
- https://developers.google.com/search/docs/appearance/structured-data/software-app

Official Yandex:
- https://yandex.com/support/webmaster/en/controlling-robot/metatags
- https://yandex.com/support/webmaster/en/search-results/favicon
- https://yandex.com/support/webmaster/en/robot-workings/vision

## 4. Fresh method findings

### A. Noindex semantics

Google states that `noindex` drops a crawled page entirely from Google Search results. Yandex states that `noindex` prohibits indexing and the page will not be included in search results.

Therefore:
`NO M11 COMMERCIAL SEARCH OWNER != AUTOMATIC NOINDEX`.

Project-specific correction:
- `/privacy` = INDEXABLE_UTILITY;
- `/support` = INDEXABLE_UTILITY;
- `/install` = NOINDEX_FOLLOW while it is only a not-yet-available installation status page.

This is an analyst/project architecture decision based on the public utility/navigation role of privacy/support and current install-state truth; it is not claimed as a search-engine mandate.

Reopen `/install` indexability when an official installation/catalog destination is actually available.

### B. Sitemap semantics

Because privacy/support are now deliberately indexable canonical public URLs, the sitemap target becomes all accepted indexable canonical pages, not only commercial SEO-owner pages:
- HOME;
- seller-analytics;
- privacy;
- support.

### C. Favicon

Google: one favicon per host, stable crawlable URL, square 1:1, >48x48 recommended, supported PNG.
Yandex: favicon is shown in search, root placement recommended, 120x120 or SVG recommended; PNG supported; direct 200/no redirect and crawlability required.

Cross-engine contract:
- canonical asset `https://octoport.ru/favicon.png`;
- PNG;
- exactly 120x120 px;
- 1:1;
- stable URL;
- direct 200, no redirect;
- not blocked by robots;
- HOME contains `<link rel="icon" href="/favicon.png" type="image/png">`;
- asset must use an approved Octoport brand mark, not an invented substitute.

### D. WebSite structured data / site name

Google states that `WebSite` structured data on HOME is the most important signal for a preferred site name and requires `name` + `url`.

Product Truth supports:
- public Cyrillic name: `Октопорт`;
- Latin brand/domain form: `Octoport`, `octoport.ru`.

R2 contract:
- HOME `WebSite` JSON-LD required;
- `name = "Octoport"`;
- `alternateName = ["Октопорт", "octoport.ru"]`;
- `url = "https://octoport.ru/"`.

### E. Organization structured data

Google has no required Organization properties, but recommends using applicable real organization details.
Current SEO/Product Truth does not yet freeze a public legal-organization identity/address/telephone/logo authority for this stage.

Decision:
`Organization = DEFERRED / NOT REQUIRED FOR M14`.
Do not invent organization facts.

### F. SoftwareApplication remains closed

The R1 decision remains:
- no fake public price;
- no fake rating/review;
- no `SoftwareApplication` rich-result markup at M14 launch.

## 5. Work trigger

`WORK_TRIGGER = false`.

Reason:
bounded correction of small deterministic matrices. Main Chat can process the complete affected universe without sampling.

## 6. Exact inputs

Frozen current inputs:
- Product Truth;
- M11/M12 current R2 authority;
- M13 R1 source manifest;
- M13 R1 technical requirements;
- M13 R1 route/canonical matrix;
- M13 R1 robots/sitemap/indexing spec;
- M13 R1 metadata/structured-data spec;
- M13 R1 performance/mobile spec;
- M13 R1 implementation file map;
- M13 R1 adversarial diagnostic;
- M13 R1 QA/progress;
- current main source identity remains a separate M14 recheck requirement.

## 7. Exact correction outputs

Create new R2 authority; do not rewrite R1 history:

1. `M13_CORRECTION_INPUT_MANIFEST_2026-09-25_R2.json`
2. `M13_TECHNICAL_REQUIREMENTS_2026-09-25_R2.tsv`
3. `M13_ROUTE_HTTP_CANONICAL_MATRIX_2026-09-25_R2.tsv`
4. `M13_ROBOTS_SITEMAP_INDEXING_SPEC_2026-09-25_R2.tsv`
5. `M13_METADATA_STRUCTURED_DATA_SPEC_2026-09-25_R2.tsv`
6. `M13_PERFORMANCE_MOBILE_SPEC_2026-09-25_R2.tsv`
7. `M13_IMPLEMENTATION_FILE_MAP_2026-09-25_R2.tsv`
8. `M13_ADVERSARIAL_DIAGNOSTIC_2026-09-25_R2.tsv`
9. `M13_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md`
10. update `M13_PROGRESS.md` only after R2 acceptance.

Unchanged R1 source manifest/live baseline remains factual historical evidence and is referenced rather than regenerated.

## 8. Schema / lineage rules

- R2 matrices are full replacements for their named R1 analytical/specification matrices, not sparse patches.
- Preserve existing R1 row IDs where the same requirement/case survives.
- Add new IDs only for genuinely new favicon/site-name/organization controls.
- R1 files remain immutable history.
- M13 current authority after acceptance becomes: R1 factual baseline + R2 correction matrices + R2 acceptance.
- No silent removal of redirect/canonical/mobile/CWV safeguards.

## 9. Hard gates

Required R2 state:
- COMMERCIAL_SEO_OWNER_URLS = 2;
- INDEXABLE_CANONICAL_URLS = 4;
- INDEXABLE_UTILITY_URLS = 2;
- NOINDEX_UTILITY_URLS = 1;
- SITEMAP_CANONICAL_TARGETS = 4;
- PRIVACY_INDEXABLE = true;
- SUPPORT_INDEXABLE = true;
- INSTALL_NOINDEX = true;
- FAVICON_CONTRACT = PASS;
- WEBSITE_SITE_NAME_CONTRACT = PASS;
- ORGANIZATION_FAKE_FACTS = 0;
- SOFTWAREAPPLICATION_FAKE_FACTS = 0;
- EXECUTABLE_JS_REQUIRED = 0;
- JSON_LD_WEBSITE_ALLOWED_NON_EXECUTABLE = true;
- M14_SITE_MUTATIONS = 0;
- MAIN_BRANCH_MUTATIONS = 0;
- OPEN_CRITICAL_CORRECTION_DEFECTS = 0.

## 10. Stop/HOLD/reopen

Stop correction if:
- SEO branch authority drifts before publication;
- M11/M12 current authority changes;
- Product Truth brand identity changes;
- current main public-site/ingress files change materially before downstream M14 preparation.

HOLD:
- if no approved brand mark can be supplied at M14, favicon implementation is `ASSET_REQUIRED`; do not invent one.
- Organization structured data stays deferred until real public organization identity properties are accepted.

## 11. Publication path

SEO correction writes only:
`docs/seo/**`.

No public-site, nginx, CI, deploy, server, extension, portal or main-branch mutation occurs in M13 R2.

## 12. Downstream

After:
`R2 outputs -> GitHub -> remote readback -> independent QA -> acceptance`

then:
`M14_PREPARATION_ALLOWED = true`.

M14 implementation still requires its own two-level preparation and current-main reconciliation.
