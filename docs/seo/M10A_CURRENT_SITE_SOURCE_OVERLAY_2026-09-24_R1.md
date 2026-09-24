# Octoport SEO — M10A current-site source overlay — 2026-09-24 R1

Status: **READ-ONLY CURRENT SOURCE SNAPSHOT / M10A INPUT**
Repository: `MaksimUnimax/runtime-fixtures`
Source branch: `main`
Current main HEAD: `f079c2e7199250397259ea9ede10a4f72694f5c1`

Purpose: refresh the current site source surface after the accepted M1 prelaunch baseline without mutating site code or claiming live deployment/indexing.

## Relation to accepted M1 baseline

Accepted M1 source main HEAD: `5d160f8711c795f71fc4212782813a64bb439513`.

Unchanged since M1:

```text
apps/site/public/index.html
blob = 3123a714e2092fb156eebe498ef97bb5969567f6

apps/site/public/robots.txt
blob = 446df898e31b99b230e8a49a7c94a45e4df96228

apps/site/public/sitemap.xml
blob = fdceb2ff477941104373850846c33bac2a5d3ced
```

New current source pages since M1:

```text
apps/site/public/install.html
blob = 99bc456742375219779ae9c611580e389b81c7a1
canonical = https://octoport.ru/install

apps/site/public/privacy.html
blob = bb975f29e3fbe8e1cfeb1fa19f397f9e5dc1f101
canonical = https://octoport.ru/privacy

apps/site/public/support.html
blob = 2ebb8fdab73c50d98a3af70198f98813cbab942b
canonical = https://octoport.ru/support
```

Current source surface:

| Source page | Current source role | M10A treatment |
|---|---|---|
| `/` | prelaunch product landing foundation | EXISTING_SURFACE / NO M9 CLUSTER OWNER IMPLIED |
| `/install` | installation/status/help surface | EXISTING_UTILITY_SURFACE / NO M9 CLUSTER OWNER IMPLIED |
| `/privacy` | privacy/data-handling surface | EXISTING_TRUST_SURFACE / NO M9 CLUSTER OWNER IMPLIED |
| `/support` | support/beta/help surface | EXISTING_SUPPORT_SURFACE / NO M9 CLUSTER OWNER IMPLIED |

`robots.txt` still allows `/` and points to `https://octoport.ru/sitemap.xml`.

`sitemap.xml` still lists only `https://octoport.ru/`.

## Search-owner boundary

Physical existence of a current source page does not authorize query ownership. M10A may map an M9 cluster to an existing page only if accepted Search-only authority supports that mapping. Existing Home/install/privacy/support pages must not absorb unresolved clusters merely to avoid HOLD.

The accepted M9 terminal reconciliation carries all 104 cluster rows to M10A as explicit Search-only HOLDs. Therefore this current-site overlay is descriptive context, not permission to resolve those HOLDs.

## Fresh method check

Official Yandex Webmaster guidance reviewed 2026-09-24:

- Site structure: https://www.yandex.com/support/webmaster/en/recommendations/site-structure
- Managing groups of search queries: https://www.yandex.com/support/webmaster/en/service/search-queries
- Search query monitoring: https://www.yandex.com/support/webmaster/en/service/popular-queries

Project application:
- use clear crawlable link structure only for authorized pages;
- preserve unique URLs for genuinely distinct documents rather than creating near-duplicate search surfaces;
- treat query-to-URL behavior as observable evidence, not as permission to invent page ownership;
- current physical pages remain separate from Search-owner decisions until evidence supports an assignment.

## Claim boundary

This file is a source snapshot only. It does not prove current live deployment of all four pages, indexing, traffic, query ownership, or final IA.
