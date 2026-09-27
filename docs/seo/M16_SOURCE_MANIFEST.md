# Octoport SEO — M16 source manifest

Date: 2026-09-27
WORK_ID: `OCTOPORT_SEO_M16_LAUNCH_INDEXING_VERIFICATION_2026-09-27_R1`
Status: **EXECUTED READ PHASE / TECHNICAL LAUNCH EVIDENCE COMPLETE**

## Authority

Preparation:
- `docs/seo/M16_STEP_PREPARATION_2026-09-27_R1.md`
- blob `cd19198ebc6fdb30f0ad29c94315ed98bded762b`

Input manifest:
- `docs/seo/M16_INPUT_MANIFEST_2026-09-27_R1.json`
- blob `6221b4ed89ae7c71ecfe450e3e2475208dcd67ac`

M15 final live:
- `docs/seo/M15_FINAL_LIVE_ACCEPTANCE_2026-09-27_R1.md`
- blob `5af8b321656554694555aecbdbf9f4a5659c01fe`

Fresh main:
`3805f8b23655668556e1f1ef43d4ab3cef837413`

Deployed public-site release:
`6a0149c958423082a62d5cb84ac757eed2e785a2`

Fresh main drift is non-overlapping:
`14/14` current site/guard blobs unchanged.

## Official method

Yandex Webmaster current method:
- Searchable pages status distinguishes actual search inclusion from crawl/indexability errors;
- reindex submission prioritizes recrawl but is not immediate indexing;
- Sitemap/links/robots support discovery but do not guarantee inclusion;
- Sitemap processing can take up to roughly two weeks after submission;
- canonical targets must themselves be accessible.

Google Search Console method:
- URL Inspection/property data is the authoritative console evidence class for Google URL-level state;
- public search observations are secondary and can be incomplete;
- read-only Search Console access is sufficient for inspection once a verified property exists.

## Google account state

GSC Wizard:
- account connected: `unymax2014@gmail.com`;
- OAuth includes `webmasters.readonly`;
- initial connected-property count = 0.

Registration probes:
- `sc-domain:octoport.ru` -> Google/GSC Wizard reports property not found in account;
- `https://octoport.ru/` -> property not found in account.

Conclusion:
`GOOGLE_PROPERTY = NOT_CREATED_OR_NOT_PRESENT_IN_CONNECTED_ACCOUNT`.

This is not a Google indexing verdict.

Read-only OAuth is sufficient after the property is created and verified.
Creating/verifying the first Octoport Search Console property is a separate account/verification action.

## Yandex Webmaster state

No durable authenticated Webmaster authority was found in repository/runtime.

DNS evidence:
- root TXT: mail SPF only;
- no `_yandex-verification.octoport.ru` TXT.

This does not exclude HTML/file-based verification.

Conclusion:
`YANDEX_WEBMASTER_CONSOLE = AUTHORITY_UNAVAILABLE_TO_EXECUTOR`.

## Live technical state

Fresh live recheck confirms:

Indexable canonical:
- HOME = 200, self-canonical, no noindex;
- seller-analytics = 200, self-canonical, no noindex;
- privacy = 200, self-canonical, no noindex;
- support = 200, self-canonical, no noindex.

Intentional noindex:
- install = 200, self-canonical, `noindex, follow`.

robots.txt:
- 200;
- `Allow: /`;
- canonical Sitemap directive.

sitemap.xml:
- 200;
- exact canonical loc set = HOME + seller-analytics + privacy + support.

## Public search observations

Universal web search:
- `site:octoport.ru` -> no Octoport result observed;
- `octoport.ru` -> no Octoport result observed;
- exact HOME title phrase -> no Octoport result observed;
- exact analytics title phrase -> no Octoport result observed.

Boundary:
the site was deployed on the same date and public web-search absence is not proof of exclusion.

Direct Google public-search requests from the executor:
- response was a Google access/problem page;
- no normal result blocks were observable.

Direct Yandex public-search requests:
- provider returned CAPTCHA/robot check.

Therefore:
- Google direct SERP = `PROVIDER_RESPONSE_UNOBSERVABLE`;
- Yandex direct SERP = `PROVIDER_CAPTCHA_UNOBSERVABLE`.

Neither is classified as NOT_INDEXED.

## Evidence class result

```text
LIVE_TECHNICAL = PASS
PUBLIC_WEB_DISCOVERY = NO_RESULT_OBSERVED
GOOGLE_SEARCH_CONSOLE = HOLD_PROPERTY_NOT_PRESENT
GOOGLE_PUBLIC_SERP = UNOBSERVABLE_EXECUTOR_ACCESS_PAGE
YANDEX_WEBMASTER = HOLD_CONSOLE_AUTHORITY_UNAVAILABLE
YANDEX_PUBLIC_SERP = UNOBSERVABLE_CAPTCHA
TECHNICAL_DEFECT = NONE
INDEXING_STATE = UNKNOWN_DELAY
```
