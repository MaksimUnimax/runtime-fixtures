# Octoport SEO — M16 progress

Date: 2026-09-27
Status: **PASS_LAUNCH_TECHNICAL_WITH_CONSOLE_HOLDS / FULL INDEXING STATE NOT YET CONFIRMED**
SEO branch: `seo/wordstat-batch-01-2026-09-16`

## Cursor

```text
M0..M12 = ACCEPTED
M13 R2 = ACCEPTED
M14 = ACCEPTED
M15 = PASS_FINAL_LIVE
M16 technical launch = ACCEPTED
M16 Google console = HOLD_PROPERTY_NOT_PRESENT
M16 Yandex console = HOLD_AUTHORITY_UNAVAILABLE
M16 full indexing = NOT YET ACCEPTED
M17 full measurement = BLOCKED
```

## Binding M16 authority

Preparation:
- `docs/seo/M16_STEP_PREPARATION_2026-09-27_R1.md`
- blob `cd19198ebc6fdb30f0ad29c94315ed98bded762b`

Input manifest:
- `docs/seo/M16_INPUT_MANIFEST_2026-09-27_R1.json`
- blob `6221b4ed89ae7c71ecfe450e3e2475208dcd67ac`

Execution:
- `docs/seo/M16_SOURCE_MANIFEST.md`
- `docs/seo/M16_LAUNCH_URL_LEDGER.tsv`
- `docs/seo/M16_PUBLIC_SEARCH_OBSERVATIONS.tsv`
- `docs/seo/M16_GOOGLE_CONSOLE_EVIDENCE.tsv`
- `docs/seo/M16_YANDEX_WEBMASTER_EVIDENCE.tsv`
- `docs/seo/M16_INDEXING_BLOCKER_LEDGER.tsv`

QA:
- `docs/seo/M16_QA.md`

## Current live technical state

```text
INDEXABLE_CANONICAL_URLS = 4/4 PASS

https://octoport.ru/ = PASS
https://octoport.ru/seller-analytics = PASS
https://octoport.ru/privacy = PASS
https://octoport.ru/support = PASS

INTENTIONAL_NOINDEX_URLS = 1/1 PASS
https://octoport.ru/install = PASS noindex,follow

robots.txt = PASS
sitemap.xml = PASS
CRITICAL_LIVE_CRAWL_DEFECTS = 0
CRITICAL_CANONICAL_DEFECTS = 0
SITEMAP_TARGET_DRIFT = 0
```

The site itself does not require rework based on M16.

## Public discovery observations

Launch-day observations:

```text
Universal web search:
site:octoport.ru -> no result observed
domain query -> no result observed
HOME exact-title -> no result observed
analytics exact-title -> no result observed

Google direct public SERP =
UNOBSERVABLE_EXECUTOR_ACCESS_PAGE

Yandex direct public SERP =
UNOBSERVABLE_CAPTCHA
```

These are not classified as indexing failure.

Official Yandex guidance explicitly allows crawl/indexing processing delay; public result absence immediately after deployment is not sufficient negative evidence.

## Google Search Console

Connected Google account:
`unymax2014@gmail.com`

OAuth:
`webmasters.readonly`

This read scope is sufficient for:
- listing readable properties;
- URL Inspection;
- sitemap reads;
- Search Analytics.

But the connected Search Console account currently contains no Octoport property usable by the connector.

Verified safe probes:

```text
sc-domain:octoport.ru
-> property not found in Google Search Console account

https://octoport.ru/
-> property not found in Google Search Console account
```

Therefore:

```text
GOOGLE_PROPERTY_PRESENT = false
GOOGLE_URL_INSPECTION = HOLD_PROPERTY_NOT_PRESENT
GOOGLE_INDEXING_STATE = UNKNOWN
```

Important:
**more read permission is not needed**.

What is needed:
create and verify the first Octoport Search Console property.

Preferred:
`sc-domain:octoport.ru`.

After verification, the current read-only connector is enough for M16 inspection.

The currently exposed GSC Wizard creation tool cannot bootstrap the first domain property because it requires an already-registered parent property.

## Yandex Webmaster

Current status:

```text
YANDEX_WEBMASTER_AUTHORITY = NOT_AVAILABLE_TO_EXECUTOR
YANDEX_SEARCHABLE_PAGES = UNKNOWN
YANDEX_SITEMAP_PROCESSING = UNKNOWN
```

No durable Webmaster connection was found.

GSC Wizard advertised Yandex Webmaster read tools, but the current runtime rejected the tool call because that tool is not exposed in the active connector version.

No separate Yandex Webmaster plugin is available.

To fully close Yandex-side M16:
- authenticated Yandex Webmaster access for octoport.ru must be connected through an available execution channel;
- site verification must exist/be completed;
- then read Searchable Pages, Sitemap processing and URL status.

## Blockers

```text
M16B001 Google Search Console property
STATE = EXTERNAL_SETUP_REQUIRED
SITE_DEFECT = false

M16B002 Yandex Webmaster authority
STATE = EXTERNAL_SETUP_REQUIRED
SITE_DEFECT = false

M16B003 public search launch-day absence
STATE = EXPECTED_DELAY
SITE_DEFECT = false
```

## Current verdict

```text
M16_TECHNICAL_LAUNCH_ACCEPTED = true
M16_FULL_INDEXING_ACCEPTED = false

M16_STATE =
PASS_LAUNCH_TECHNICAL_WITH_CONSOLE_HOLDS

QUALITY_SCORE = 9.3/10
```

## Reopen action

Google:
1. create/verify `sc-domain:octoport.ru` in Google Search Console;
2. reconnect/register it in GSC Wizard if needed;
3. URL Inspection four canonical URLs;
4. inspect submitted Sitemap;
5. classify INDEXED / DISCOVERED-CRAWLED / UNKNOWN_DELAY / actual blocker.

Yandex:
1. connect verified octoport.ru in Yandex Webmaster through an available authenticated execution channel;
2. read Searchable Pages;
3. read Sitemap processing;
4. classify each canonical URL and any exclusion/error.

No source/site change should be made merely to satisfy these account-setup holds.

## Next roadmap gate

M17 full measurement does not start until M16 provider-console state is sufficiently available to establish a durable indexing baseline.

No STOP was received; continue working on the M16 console prerequisites whenever authority becomes available.
