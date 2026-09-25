# Octoport SEO — M13 progress

Date: 2026-09-25
Status: **ACCEPTED / CURRENT AUTHORITY = R2 EXTERNAL-METHOD CORRECTION / M14 PREPARATION RELEASED / M14 IMPLEMENTATION NOT YET AUTHORIZED**
Branch: `seo/wordstat-batch-01-2026-09-16`

## Cursor

```text
M0..M12 = ACCEPTED
M11/M12 CURRENT AUTHORITY = R2 CORRECTION
M13 R1 = ACCEPTED HISTORICAL
M13 R2 = ACCEPTED / CURRENT
M14 = PREPARATION ALLOWED / IMPLEMENTATION NOT YET STARTED
M15+ = BLOCKED
```

## Current M13 authority

Historical factual baseline retained:
- `docs/seo/M13_SOURCE_MANIFEST.md`
- original live HTTP observations from M13 R1.

Current correction preparation:
- `docs/seo/M13_CORRECTION_STEP_PREPARATION_2026-09-25_R2.md`
  blob `531e17b209fb5bb5a20b49113a1b020e4969ed1e`.

Current correction input manifest:
- `docs/seo/M13_CORRECTION_INPUT_MANIFEST_2026-09-25_R2.json`
  blob `4a805a8b984dcca523ad3e9e9e794f3549468fa6`.

Current R2 matrices:
1. `docs/seo/M13_TECHNICAL_REQUIREMENTS_2026-09-25_R2.tsv`
   blob `ce9debeb7a658d4baf192f6bef274ca2600ea575`
2. `docs/seo/M13_ROUTE_HTTP_CANONICAL_MATRIX_2026-09-25_R2.tsv`
   blob `2312fb97dd38093c85b9c9bb9577312dcf4146f1`
3. `docs/seo/M13_ROBOTS_SITEMAP_INDEXING_SPEC_2026-09-25_R2.tsv`
   blob `b25456f41b949ef17301ca2e4efb697738d588b0`
4. `docs/seo/M13_METADATA_STRUCTURED_DATA_SPEC_2026-09-25_R2.tsv`
   blob `d523708a1346f5c04c4ee4573f8995ec1b8bde06`
5. `docs/seo/M13_PERFORMANCE_MOBILE_SPEC_2026-09-25_R2.tsv`
   blob `924b61c84a381b95fe797bfe1cb522426497ec81`
6. `docs/seo/M13_IMPLEMENTATION_FILE_MAP_2026-09-25_R2.tsv`
   blob `c3e2b7f279ef2d7e5b122543ae2dc029c421a4a8`
7. `docs/seo/M13_ADVERSARIAL_DIAGNOSTIC_2026-09-25_R2.tsv`
   blob `cc5536019c0504385162124a2319e574528b7c79`

Current acceptance:
- `docs/seo/M13_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md`
  blob `9ef006e6d3e75fde496bffde439eb97ea10df936`.

Applicable LEVEL 2:
- `docs/seo/LEVEL2/M13_M18_IMPLEMENTATION_LAUNCH_MEASUREMENT_RULES.md`.

## R2 execution facts

```text
R2_PREPARATION_PARENT_SEO_HEAD = 85f8e20fb455748564dedc91ab2084466601d4a9
R2_OBSERVED_MAIN_HEAD = 651e756fb0038a2895bf870855de21e990ca2b46

WORK_TRIGGER = false
EXECUTOR = MAIN_CHAT
PROVIDER_CALLS = 0
SITE_MUTATIONS_IN_M13_R2 = 0
MAIN_MUTATIONS_IN_M13_R2 = 0

M13_REQUIREMENTS = 31
M13_ROUTE_CASES = 22
M13_INDEXING_SEARCH_APPEARANCE_SURFACES = 10
M13_METADATA_SURFACES = 5
M13_PERFORMANCE_CHECKS = 13
M13_IMPLEMENTATION_FILE_ROWS = 16
M13_ADVERSARIAL_TESTS = 21

OPEN_CRITICAL_CORRECTION_DEFECTS = 0
QUALITY_SCORE = 9.7/10
M13_CURRENT_ACCEPTED = true
```

## Current indexability model

Commercial SEO-owner pages:

- `https://octoport.ru/`
- `https://octoport.ru/seller-analytics`

Indexable public utility pages:

- `https://octoport.ru/privacy`
- `https://octoport.ru/support`

Crawlable noindex status page:

- `https://octoport.ru/install`

Install indexability reopens when an official installation/catalog destination is actually available.

## Current Sitemap contract

Exactly four canonical URLs:

- `https://octoport.ru/`
- `https://octoport.ru/seller-analytics`
- `https://octoport.ru/privacy`
- `https://octoport.ru/support`

No aliases, no HTTP/www variants, no install while noindex, no app/API URLs.

## Search appearance correction

Favicon:

```text
URL = https://octoport.ru/favicon.png
FORMAT = PNG
SIZE = 120x120
ASPECT = 1:1
HTTP = direct 200
REDIRECT = forbidden
ROBOTS = crawlable
HOME_LINK = <link rel="icon" href="/favicon.png" type="image/png">
ASSET = approved Octoport brand mark only
```

If no approved brand asset is available in M14:
`ASSET_REQUIRED / HOLD`.

Google site-name structured data on HOME:

```text
@type = WebSite
name = Octoport
alternateName = [Октопорт, octoport.ru]
url = https://octoport.ru/
```

Structured-data boundary:

```text
WebSite = REQUIRED_HOME
Organization = DEFERRED_NOT_REQUIRED_M14
SoftwareApplication = NONE_M14
FAQ = NONE_UNLESS_REOPENED
FAKE_REVIEW_RATING_PRICE = 0
```

Runtime boundary:

```text
EXECUTABLE_PUBLIC_JS = 0 by default
application/ld+json = allowed non-executable structured data
```

## R1 conclusions superseded by R2

Do not use these R1 conclusions as current:

- privacy/support/install all noindex;
- Sitemap target count = 2;
- blanket structured-data NONE;
- parser rule that counts every `<script>` tag as executable JavaScript.

R1 redirect/canonical/404/mobile/CWV/rendering/live-baseline evidence remains valid unless later source/live drift reopens it.

## M14 implementation boundary

M14 must consume R2 as current M13 authority.

M14 is not allowed to invent:
- favicon/logo art;
- organization legal facts;
- public pricing;
- reviews/ratings;
- SoftwareApplication eligibility;
- capabilities outside M11/M12/Product Truth.

`infra/production/nginx/octoport-apps.conf` remains DO_NOT_CHANGE.

## Next physical action

```text
M14 STEP PREPARATION
-> fresh current main
-> LEVEL 1 + M13-M18 LEVEL 2
-> parallel-work reconciliation
-> R2 current-authority read
-> approved favicon asset availability check
-> current Product Truth/privacy revalidation
-> analytics real-proof gate
-> exact implementation/test file contract
-> GitHub persist
-> remote readback
-> only then bounded M14 implementation
```
