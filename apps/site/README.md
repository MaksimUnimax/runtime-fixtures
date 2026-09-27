# Octoport public site

Status: M14 bounded SEO source implementation candidate / NOT DEPLOYED / NOT INDEXING-ACCEPTED.

## Purpose

apps/site/public/ is the independent public marketing surface for https://octoport.ru/.
It remains separate from apps/portal, apps/admin, apps/api and apps/extension.

The public site remains dependency-free static HTML/CSS. M14 adds no client-side application runtime.

## Canonical and indexability contract

Canonical public origin: https://octoport.ru.

Commercial SEO-owner pages:
- / — connector/category HOME;
- /seller-analytics — bounded seller-owned analytics use case.

Indexable public utility pages:
- /privacy;
- /support.

Crawlable current-status page:
- /install — noindex, follow until an official installation/catalog destination is actually available.

Known .html and non-root trailing-slash aliases are redirect-only. Unknown public URLs remain real 404.

## Search appearance

- HOME carries one static WebSite JSON-LD node for the preferred site name.
- SoftwareApplication, review/rating and invented Organization facts are not published.
- /favicon.png is a 120×120 PNG derived only by deterministic resize from the current accepted Octoport extension mark.
- application/ld+json is non-executable structured data; executable public JavaScript remains zero in this M14 scope.

## Sitemap

public/sitemap.xml contains exactly:
1. https://octoport.ru/
2. https://octoport.ru/seller-analytics
3. https://octoport.ru/privacy
4. https://octoport.ru/support

/install, aliases, assets, portal and API routes are excluded.

## Truth boundary for public copy

Current public copy may state:
- one browser extension connects a user-selected supported AI to Ozon/Wildberries;
- launch scope is read-only data/report analysis and explanation;
- marketplace credentials remain local during ordinary work;
- server still handles account/device/auth and limited service metadata/synchronization;
- closed free beta is being prepared and public access is not yet open.

The site must not claim public paid pricing, automatic business-state mutation, universal browser/provider acceptance, a proprietary Octoport LLM, external market-intelligence coverage without source authority, or a server that stores no data at all.

## Files

- public/index.html — HOME source;
- public/seller-analytics.html — seller-owned analytics use-case source;
- public/privacy.html — indexable privacy utility;
- public/support.html — indexable support utility;
- public/install.html — crawlable noindex installation-status page;
- public/favicon.png — search/browser icon;
- public/styles.css — shared responsive styling;
- public/robots.txt — crawler policy;
- public/sitemap.xml — canonical indexable URL set.

There is no build step. Deployment copies public/ byte-for-byte into a versioned static release and changes only the separately owned public-site nginx config.

## Acceptance boundary

M14 source acceptance is not production deployment. Production deployment, live-route QA and indexing verification belong to later roadmap stages.

The analytics page must not be launched with fake proof. A real sanitized/source-backed product demonstration remains a downstream launch gate.
