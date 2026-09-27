# Octoport SEO — M16 launch + indexing verification — STEP PREPARATION — 2026-09-27 R1

Status: **PREPARED / EXECUTION READY AFTER REMOTE READBACK**
WORK_ID: `OCTOPORT_SEO_M16_LAUNCH_INDEXING_VERIFICATION_2026-09-27_R1`

Repository: `MaksimUnimax/runtime-fixtures`
SEO authority branch: `seo/wordstat-batch-01-2026-09-16`
Preparation parent SEO HEAD: `1e6273e735954f5386a82f5796eb5d6803479f44`
Fresh main observed: `3805f8b23655668556e1f1ef43d4ab3cef837413`
Deployed site release: `6a0149c958423082a62d5cb84ac757eed2e785a2`

## 1. Cursor and purpose

```text
M0..M12 = ACCEPTED
M13 R2 = ACCEPTED
M14 = ACCEPTED
M15 = PASS_FINAL_LIVE
M16 = CURRENT PREPARATION
M17+ = BLOCKED
```

M16 purpose:
verify actual post-deployment discovery/indexability state without confusing:
- deployed with indexed;
- crawlable with indexed;
- indexed with ranking;
- delayed Webmaster/Search Console data with failure.

## 2. Mandatory two-level authority read

LEVEL 1:
- `docs/seo/LEVEL1/README.md`
- `docs/seo/EXECUTION_RULES.md`
- `docs/seo/WORK_HANDOFF_RULE.md`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md`
- current Product Truth and failure history.

LEVEL 2:
- `docs/seo/LEVEL2/M13_M18_IMPLEMENTATION_LAUNCH_MEASUREMENT_RULES.md`
- M16 section: launch + indexing verification.

Current upstream authority:
- `docs/seo/M15_FINAL_LIVE_ACCEPTANCE_2026-09-27_R1.md`
  blob `5af8b321656554694555aecbdbf9f4a5659c01fe`;
- `docs/seo/M15_PROGRESS.md`
  blob `f2e7f917d5764846cb93045bfa0ff0846a0f3f25`.

## 3. Fresh main drift reconciliation

M15 deployed source:
`6a0149c958423082a62d5cb84ac757eed2e785a2`.

Fresh main:
`3805f8b23655668556e1f1ef43d4ab3cef837413`.

Main advanced 14 commits after M15.

Changed paths are coordination/readiness and extension regression only.
Fresh remote blob readback:

```text
CURRENT_MAIN_SITE_GUARD_BLOBS_UNCHANGED = 14/14
SITE_PATH_OVERLAP = 0
```

Therefore:
`AUTHORITY_DRIFT_STATUS = NON_OVERLAPPING_MAIN_ADVANCE_RECONCILED`.

The deployed public-site release remains the accepted M15 release and is not reopened by this main drift.

## 4. Fresh external method research

Official Yandex Webmaster current guidance:
- Searchable pages:
  https://yandex.com/support/webmaster/en/service/searchable
- Reindex pages:
  https://yandex.com/support/webmaster/en/robot-workings/site-reindex
- Site indexing:
  https://yandex.com/support/webmaster/en/recommendations/indexing
- Sitemap files:
  https://yandex.com/support/webmaster/en/indexing-options/sitemap
- Sitemap:
  https://yandex.com/support/webmaster/en/controlling-robot/sitemap
- Canonical URLs:
  https://yandex.com/support/webmaster/en/robot-workings/canonical
- Search indexing model:
  https://yandex.com/support/webmaster/en/yandex-indexing/site-indexing
- Adding pages to search:
  https://yandex.com/support/webmaster/en/robot-workings/robot

Current method implications:
- Sitemap/links/robots inform discovery but do not guarantee inclusion in search;
- Searchable-pages status distinguishes SEARCHABLE, noindex, non-canonical, HTTP/robots and other states;
- reindex submission prioritizes recrawl but does not equal immediate indexing;
- Sitemap processing can take up to roughly two weeks after submission;
- canonical targets must themselves be accessible;
- new pages may remain delayed without this being a technical failure.

Official Google Search Console method:
- use property-level Search Console data and URL Inspection for URL-level indexing state;
- property/search data and URL Inspection are stronger evidence than public `site:` heuristics;
- Search Console read-only permission is sufficient for reads/inspection when a verified property is connected;
- public-search observations are secondary, not a replacement for URL Inspection.

## 5. Google Search Console connection state

GSC Wizard connection checked during M16 preparation.

Authenticated Google account:
`unymax2014@gmail.com`

OAuth scopes include:
`https://www.googleapis.com/auth/webmasters.readonly`

Result:
```text
GSC_OAUTH_READONLY = CONNECTED
GSC_REGISTERED_PROPERTIES = 0
GSC_OCTOPORT_PROPERTY_AVAILABLE = false
```

This is not an indexing verdict.

Interpretation:
- read-only OAuth scope is sufficient for property reads/URL Inspection;
- no Search Console property is currently connected/visible to GSC Wizard;
- either Octoport is not yet present/verified in Search Console or it has not been connected to the app.

M16 must record:
`GOOGLE_CONSOLE_STATE = PROPERTY_NOT_CONNECTED`,
not `NOT_INDEXED`.

No wider Google OAuth permission is required for read-only M16 inspection.
If property creation/verification later becomes necessary, that is a separate owner/account action and must be explicitly identified.

## 6. Yandex Webmaster connection state

Repository search found no durable Yandex Webmaster property/verification authority.

DNS checks during preparation:
- root TXT contains mail SPF only;
- no `_yandex-verification.octoport.ru` TXT;
- no `google-site-verification.octoport.ru` TXT.

This does not prove there is no HTML/file-based verification, so M16 does not assert that ownership is absent solely from DNS.

Current:
`YANDEX_WEBMASTER_CONSOLE = AUTHORITY_NOT_AVAILABLE_TO_THIS_EXECUTOR`.

No console status will be fabricated.

## 7. M16 evidence classes

M16 ledger must keep these separate:

1. `LIVE_TECHNICAL`
   - status, canonical, robots, sitemap, headers, rendered HTML.

2. `PUBLIC_SEARCH_OBSERVATION`
   - public Google/Yandex search discovery observations;
   - useful but not definitive Search Console/Webmaster state.

3. `GOOGLE_SEARCH_CONSOLE`
   - property and URL Inspection when available.

4. `YANDEX_WEBMASTER`
   - Searchable Pages / URL status / Sitemap processing / crawl state when available.

5. `UNKNOWN_DELAY`
   - page live and indexable but console/index evidence not yet available.

6. `TECHNICAL_DEFECT`
   - actual robots/noindex/canonical/HTTP/Sitemap defect.

No evidence class may be silently converted into another.

## 8. URL universe

Commercial SEO owners:
- `https://octoport.ru/`
- `https://octoport.ru/seller-analytics`

Indexable utility URLs:
- `https://octoport.ru/privacy`
- `https://octoport.ru/support`

Intentional noindex:
- `https://octoport.ru/install`

Discovery assets:
- `https://octoport.ru/robots.txt`
- `https://octoport.ru/sitemap.xml`

## 9. M16 technical launch checks

For all four indexable canonical URLs:
- 200;
- exact self-canonical;
- no noindex;
- crawlable under robots;
- present in sitemap;
- initial HTML content present;
- at least one crawlable internal link from accepted site graph;
- no redirect;
- no X-Robots noindex.

Install:
- 200;
- self-canonical;
- `noindex, follow`;
- excluded from sitemap.

Sitemap:
- 200;
- exact four canonical target URLs.

robots:
- 200;
- allows public site;
- canonical Sitemap directive.

Known aliases:
- permanent redirect only;
- not separately expected to index.

## 10. Public-search observation contract

Run bounded fresh public discovery observations for:
- `site:octoport.ru`;
- exact domain/brand query;
- exact current HOME title/H1 phrase;
- exact analytics title/H1 phrase;
- exact canonical URL searches where practical.

Store:
- provider/search surface;
- query;
- observed URLs/snippets;
- timestamp;
- claim boundary.

Interpretation:
- result seen = public-search discovery observation;
- no result seen = not proof of exclusion/non-indexing;
- ranking position from one ad-hoc query is not an M16 PASS gate.

## 11. Console policy

### Google

If `sc-domain:octoport.ru` or an accepted Octoport URL-prefix property becomes available:
- call URL Inspection on the four indexable canonical URLs;
- capture verdict, coverageState, robotsTxtState, indexingState, lastCrawlTime, pageFetchState and crawledAs;
- list submitted sitemaps;
- preserve actual API result.

If property remains unavailable:
`GOOGLE_URL_INSPECTION = HOLD_PROPERTY_NOT_CONNECTED`.

### Yandex

If an authenticated Webmaster authority becomes available:
- capture Searchable Pages/URL state;
- check Sitemap processing;
- capture recrawl/reindex status if already submitted.

Without authenticated authority:
`YANDEX_CONSOLE_STATUS = HOLD_CONSOLE_AUTHORITY_UNAVAILABLE`.

Do not infer console status from public search alone.

## 12. Reindex/submission mutation policy

M16 first completes read-only state collection.

No write/reindex/submission action is required merely because a newly deployed page is not yet visible.

A reindex/submission action becomes justified only after:
- live indexability PASS;
- page absent/delayed in console or public evidence;
- current provider method supports the action;
- exact URL set is frozen;
- write authorization/tool capability is explicit.

Google read-only scope is sufficient for current read phase.

## 13. Outputs

M16 execution must create:

1. `M16_SOURCE_MANIFEST.md`
2. `M16_LAUNCH_URL_LEDGER.tsv`
3. `M16_PUBLIC_SEARCH_OBSERVATIONS.tsv`
4. `M16_GOOGLE_CONSOLE_EVIDENCE.tsv`
5. `M16_YANDEX_WEBMASTER_EVIDENCE.tsv`
6. `M16_INDEXING_BLOCKER_LEDGER.tsv`
7. `M16_QA.md`
8. `M16_PROGRESS.md`

## 14. Hard gates

```text
M15_FINAL_LIVE_ACCEPTED = true
LIVE_INDEXABLE_CANONICAL_URLS = 4
LIVE_INTENTIONAL_NOINDEX_URLS = 1

CRITICAL_LIVE_CRAWL_DEFECTS_ALLOWED = 0
CRITICAL_CANONICAL_DEFECTS_ALLOWED = 0
SITEMAP_TARGET_DRIFT_ALLOWED = 0

GOOGLE_PROPERTY_NOT_CONNECTED != GOOGLE_NOT_INDEXED
YANDEX_CONSOLE_UNAVAILABLE != YANDEX_NOT_INDEXED
PUBLIC_SEARCH_NO_RESULT != INDEXING_FAILURE

INDEXING_DELAY_WITH_CLEAN_TECHNICAL_STATE = ALLOWED_HOLD
TECHNICAL_INDEXABILITY_DEFECT = BLOCKING
```

## 15. PASS/HOLD semantics

Possible M16 result:

`PASS_LAUNCH_TECHNICAL_WITH_CONSOLE_HOLDS`

when:
- all four canonical targets are technically discoverable/indexable;
- intentional install noindex is correct;
- no critical crawl/canonical/Sitemap defect exists;
- public search evidence is durably recorded;
- unavailable provider-console state is explicitly held, not guessed.

Full M16 indexing PASS requires provider evidence sufficient to distinguish actual indexed/searchable state from mere technical eligibility.

A newly deployed page may remain `UNKNOWN_DELAY` without failing M16 technical launch.

## 16. Work trigger

`WORK_TRIGGER = false`.

The URL universe is bounded and fully reviewable in Main Chat.

## 17. Publication policy

M16 writes only `docs/seo/**`.

No site/server/extension mutation in M16 read phase.
No Webmaster/Search Console write mutation without a separately justified action.

## 18. Next physical action

After preparation + manifest remote readback:

```text
fresh live URL matrix
-> exact canonical/robots/sitemap/indexability ledger
-> public Google/Yandex search observations
-> Google property/URL Inspection if available
-> Yandex Webmaster evidence if authority available
-> blocker classification
-> M16 QA
-> PASS / HOLD / REWORK
-> only accepted M16 may open M17 measurement
```
