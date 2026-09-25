# Octoport SEO — M13 external-method correction — Main Chat acceptance — 2026-09-25 R2

WORK_ID: `OCTOPORT_SEO_M13_EXTERNAL_METHOD_CORRECTION_2026-09-25_R2`
Status: **PASS / ACCEPTED / CURRENT M13 CORRECTION AUTHORITY**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

## 1. Why R2 exists

An independent external-method audit of accepted M13 R1 found three bounded defects/gaps:

1. R1 treated `NO COMMERCIAL SEO OWNER` as sufficient reason to noindex all public utility pages.
2. R1 omitted a search-appearance favicon contract.
3. R1 used a blanket `STRUCTURED DATA = NONE` policy and therefore omitted valid Google `WebSite` site-name markup.

R2 corrects only those dependencies plus the necessary CI/runtime distinction between executable JavaScript and non-executable JSON-LD.

R1 redirects/canonical/404/mobile/CWV/rendering/app-ingress isolation remain accepted and are carried forward.

## 2. Two-level preparation gate

Preparation:
`docs/seo/M13_CORRECTION_STEP_PREPARATION_2026-09-25_R2.md`
blob `531e17b209fb5bb5a20b49113a1b020e4969ed1e`.

Input manifest:
`docs/seo/M13_CORRECTION_INPUT_MANIFEST_2026-09-25_R2.json`
blob `4a805a8b984dcca523ad3e9e9e794f3549468fa6`.

Preparation parent SEO HEAD:
`85f8e20fb455748564dedc91ab2084466601d4a9`.

Current main observed for correction:
`651e756fb0038a2895bf870855de21e990ca2b46`.

Before R2 matrix publication:
- SEO branch had no unexpected drift;
- main remained at the frozen R2 observation;
- no M11/M12 authority drift was observed.

## 3. Fresh official method support

Google:
- noindex removes an accessible crawled page from Google Search results;
- noindex can only be observed when the crawler can access the page;
- favicon eligibility uses a HOME `rel=icon`, crawlable stable square asset, with >48x48 recommended;
- `WebSite` structured data on HOME is the most important explicit site-name preference signal and requires `name` + `url`;
- Organization has no required properties and should contain only applicable truthful organization facts;
- SoftwareApplication rich-result markup remains separate and must not be fabricated.

Yandex:
- `noindex` prohibits page text indexing/search inclusion;
- favicon is a search-result element; PNG is supported; 120x120 is recommended; direct 200/no redirect/crawlability are required for reliable processing;
- static accessible HTML remains preferred for important content.

## 4. Accepted R2 architecture decisions

### Commercial SEO ownership remains unchanged

Exactly two commercial SEO-owner pages:

- `https://octoport.ru/`
- `https://octoport.ru/seller-analytics`

No new M11 cluster/page owner is created.

### Utility indexability is corrected

`https://octoport.ru/privacy`
= `INDEXABLE_UTILITY`

`https://octoport.ru/support`
= `INDEXABLE_UTILITY`

`https://octoport.ru/install`
= `NOINDEX_FOLLOW` while it remains a not-yet-available installation/status page.

Install indexability reopens when official installation/catalog availability becomes true.

### Sitemap

Current M14 target sitemap canonical set becomes exactly four URLs:

1. HOME
2. seller-analytics
3. privacy
4. support

This is deliberately separate from commercial page ownership.

### Favicon

M14 technical contract now requires:

- `https://octoport.ru/favicon.png`
- approved Octoport brand mark only;
- PNG;
- exactly 120x120;
- square 1:1;
- stable URL;
- direct 200;
- no redirect;
- crawlable;
- `Content-Type: image/png`;
- HOME `<link rel="icon" href="/favicon.png" type="image/png">`.

If an approved brand asset is unavailable:
`M14_ASSET_REQUIRED / HOLD`.
Do not invent a logo.

### WebSite site-name structured data

HOME must contain one static JSON-LD `WebSite` node:

- `name = Octoport`
- `alternateName = [Октопорт, octoport.ru]`
- `url = https://octoport.ru/`

This is a site-name preference signal only.

### Organization structured data

`Organization = DEFERRED / NOT REQUIRED FOR M14`.

Do not invent legal organization identity, address, telephone, logo or other organization facts.

### SoftwareApplication / FAQ / reviews

Still closed for M14:
- SoftwareApplication = NONE;
- FAQ = NONE unless separately reopened by evidence;
- fake reviews/ratings/pricing = 0.

### JavaScript boundary

M14 remains:
`EXECUTABLE_PUBLIC_JS = 0` by default.

Static:
`<script type="application/ld+json">`
is explicitly allowed and must not be counted as executable application JavaScript.

## 5. Current R2 artifact identities

- `M13_TECHNICAL_REQUIREMENTS_2026-09-25_R2.tsv`
  blob `ce9debeb7a658d4baf192f6bef274ca2600ea575`
- `M13_ROUTE_HTTP_CANONICAL_MATRIX_2026-09-25_R2.tsv`
  blob `2312fb97dd38093c85b9c9bb9577312dcf4146f1`
- `M13_ROBOTS_SITEMAP_INDEXING_SPEC_2026-09-25_R2.tsv`
  blob `b25456f41b949ef17301ca2e4efb697738d588b0`
- `M13_METADATA_STRUCTURED_DATA_SPEC_2026-09-25_R2.tsv`
  blob `d523708a1346f5c04c4ee4573f8995ec1b8bde06`
- `M13_PERFORMANCE_MOBILE_SPEC_2026-09-25_R2.tsv`
  blob `924b61c84a381b95fe797bfe1cb522426497ec81`
- `M13_IMPLEMENTATION_FILE_MAP_2026-09-25_R2.tsv`
  blob `c3e2b7f279ef2d7e5b122543ae2dc029c421a4a8`
- `M13_ADVERSARIAL_DIAGNOSTIC_2026-09-25_R2.tsv`
  blob `cc5536019c0504385162124a2319e574528b7c79`

Remote readback matched all locally generated Git blob identities exactly.

## 6. Independent R2 QA

Full-matrix accounting:

- technical requirements = 31 / unique 31
- route cases = 22 / unique 22
- indexing/search-appearance surfaces = 10 / unique 10
- metadata surfaces = 5 / unique 5
- performance/mobile checks = 13 / unique 13
- implementation file-map rows = 16 / unique 16
- adversarial scenarios = 21 / unique 21

R2 invariants:

```text
COMMERCIAL_SEO_OWNER_URLS = 2
INDEXABLE_CANONICAL_URLS = 4
INDEXABLE_UTILITY_URLS = 2
NOINDEX_UTILITY_URLS = 1
SITEMAP_CANONICAL_TARGETS = 4

PRIVACY_INDEXABLE = true
SUPPORT_INDEXABLE = true
INSTALL_NOINDEX = true

FAVICON_CONTRACT = PASS
WEBSITE_SITE_NAME_CONTRACT = PASS

ORGANIZATION_FAKE_FACTS = 0
SOFTWAREAPPLICATION_FAKE_FACTS = 0

EXECUTABLE_JS_REQUIRED = 0
JSON_LD_WEBSITE_ALLOWED_NON_EXECUTABLE = true

M14_SITE_MUTATIONS = 0
MAIN_BRANCH_MUTATIONS = 0

OPEN_CRITICAL_CORRECTION_DEFECTS = 0
```

All 21 adversarial scenarios close at specification level.

## 7. Supersession / current authority

R1 factual live baseline and source manifest remain valid historical evidence.

The following R1 policy conclusions are superseded:
- privacy/support/install all noindex;
- sitemap target count = 2;
- blanket structured-data NONE;
- zero script tags without distinguishing JSON-LD.

Current M13 authority is:

```text
M13 R1 factual source/live baseline
+
M13 R2 correction preparation + manifest
+
M13 R2 full matrices
+
this R2 acceptance
```

## 8. Quality score after external correction

1. goal/output completeness = 10/10
2. method/source support = 10/10
3. input evidence/provenance integrity = 10/10
4. coverage/completeness = 10/10
5. analytical correctness/claim boundaries = 9/10
6. adversarial QA quality = 10/10
7. persistence/readback/reproducibility = 10/10
8. owner/client usability/plain language = 9/10
9. information gain/cost/execution efficiency = 10/10
10. downstream readiness = 9/10

`QUALITY_TOTAL = 97/100`
`QUALITY_SCORE = 9.7/10`

Remaining deductions:
- privacy/support indexability is a deliberate project architecture judgment, not a search-engine mandate, and should be validated after launch with real branded/navigation query data;
- favicon still depends on an approved brand asset at M14;
- analytics real-product proof gate remains a downstream implementation dependency.

## 9. Final verdict

```text
M13_R2_CORRECTION_HARD_GATES = PASS
M13_CURRENT_QUALITY_SCORE = 9.7/10
M13_CURRENT_ACCEPTED = true
M14_PREPARATION_ALLOWED = true
M14_IMPLEMENTATION_ALLOWED_FROM_M13_ALONE = false
```

No production/site/nginx/CI/server/main mutation occurred in M13 R2.

## 10. Next physical action

M14 step preparation under live LEVEL 1 + M13-M18 LEVEL 2.

M14 must:
- re-fetch current main;
- reconcile parallel site/server/extension work;
- consume the R2 matrices above as current M13 authority;
- resolve favicon approved-asset availability;
- revalidate current privacy/product truth;
- close or explicitly gate analytics real-proof requirements;
- freeze exact implementation/test files;
- persist/readback M14 preparation;
- only then authorize bounded implementation.
