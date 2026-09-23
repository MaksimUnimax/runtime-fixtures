# Octoport SEO — M1 live / measurement baseline pre-step gate R1

Date: 2026-09-23
Status: **PREPARED / READ-ONLY EXECUTION RELEASED / NO SITE MUTATION**

Repository: `MaksimUnimax/runtime-fixtures`
SEO branch: `seo/wordstat-batch-01-2026-09-16`
Preparation SEO HEAD: `0234e7cb2de4471c80787edee57ce39ce36b05ad`
Current source main HEAD: `5d160f8711c795f71fc4212782813a64bb439513`

Recovery authority:
`docs/seo/FAILURE_LEDGER.md#OSEO-F02`.

The public checks performed before this gate are not accepted M1 evidence and must be re-run after remote readback of this file.

## 1. Authorities read

```text
LEVEL1/README.md = READ
EXECUTION_RULES.md = READ
LEVEL2/README.md = READ
LEVEL2/OCTOPORT_STEP_RULES_INDEX.md = READ
STAGE_GATES_M0_M7.md = READ
SEO_MASTER_ROADMAP_2026-09-16.md = READ
PRODUCT_TRUTH.md = READ
technical/CURRENT_SITE_BASELINE_2026-09-16.md = READ
FAILURE_LEDGER.md = READ
```

Applicable M1 Level2 authority:
`LEVEL2/OCTOPORT_STEP_RULES_INDEX.md#M1`.

There is no separate dedicated M1 high-risk Level2 file in the current Level2 index.

## 2. Stage purpose

M1 answers:

```text
WHAT IS PHYSICALLY LIVE NOW?
IS IT CRAWLABLE / INDEXABLE IN PUBLIC TECHNICAL TERMS?
DOES LIVE MATCH CURRENT SOURCE?
WHAT MEASUREMENT / OWNERSHIP SURFACES ARE READY?
WHAT PRIVATE STATE STILL REQUIRES AUTHORIZED OWNER ACCESS?
```

M1 does not optimize copy, create pages, change robots, install analytics or mutate the site.

## 3. Current source inputs

Current `main` source files:
- `apps/site/public/index.html`
- `apps/site/public/robots.txt`
- `apps/site/public/sitemap.xml`

Current source main HEAD:
`5d160f8711c795f71fc4212782813a64bb439513`.

Historical source-only baseline:
`docs/seo/technical/CURRENT_SITE_BASELINE_2026-09-16.md`.

That historical file is explicitly `NOT PRODUCTION CRAWL` and is not sufficient for M1 closure.

## 4. Fresh external method research — 2026-09-23

Official Yandex authorities refreshed immediately before this gate:

- Yandex Webmaster availability/robot checks:
  https://www.yandex.com/support/webmaster/en/robot-workings/availability
- Yandex indexing lifecycle:
  https://www.yandex.com/support/webmaster/en/yandex-indexing/site-indexing
- Yandex adding site / tracking indexing in Webmaster:
  https://yandex.com/support/webmaster/en/robot-workings/robot
- Yandex Sitemap:
  https://yandex.com/support/webmaster/en/indexing-options/sitemap
- Yandex Webmaster tools:
  https://yandex.com/support/webmaster/en/indexing-options/tools
- Yandex Metrica tag creation/install:
  https://yandex.com/support/metrica/en/general/creating-counter
- Yandex Metrica tag check:
  https://yandex.com/support/metrica/en/general/check-counter

Method implications:
- public HTTP/robots/sitemap checks establish technical availability, not Webmaster ownership/indexed status;
- Webmaster private state is the proper evidence surface for owned indexing/diagnostics;
- a Sitemap helps discovery but does not itself prove indexing;
- Metrica readiness requires an actual configured/installed tag or a separately accepted alternative measurement method.

Official Google Search Console authorities refreshed:

- ownership verification:
  https://support.google.com/webmasters/answer/9008080
- URL Inspection:
  https://support.google.com/webmasters/answer/9012289
- inspect/troubleshoot page:
  https://support.google.com/webmasters/answer/12482179
- property settings / crawl state:
  https://support.google.com/webmasters/answer/7687465
- Sitemap:
  https://support.google.com/webmasters/answer/12817956

Method implications:
- Search Console ownership is private account state and cannot be inferred merely because a site is public;
- URL Inspection is a property-owner/full-user evidence surface for Google-known/live indexing state;
- a public sitemap does not prove Search Console submission or Google indexing.

## 5. Exact evidence lanes

### Lane A — current source

Read current main source and freeze:
- HTML lang;
- Title;
- meta description;
- canonical;
- H1;
- visible claims;
- navigation/internal links;
- robots source;
- sitemap source;
- structured data;
- public verification/measurement snippets if present.

### Lane B — public live HTTP / source

Re-run after this gate:
- `http://octoport.ru/`;
- `https://octoport.ru/`;
- `https://www.octoport.ru/`;
- `https://octoport.ru/robots.txt`;
- `https://octoport.ru/sitemap.xml`.

Capture:
- final URL;
- HTTP status;
- redirect count/type;
- content type;
- materially relevant headers including `X-Robots-Tag`;
- response byte count/hash;
- live SEO markers;
- source-vs-live byte/hash identity;
- crawlable link inventory;
- public analytics/verification snippets.

### Lane C — public search visibility

Use legitimate current public search/web evidence only for a bounded branded/indexed baseline.

Do not equate a third-party search result with Yandex Webmaster or Google Search Console state.

### Lane D — private ownership / measurement

Required M1 state questions:
- Yandex Webmaster property ownership/readiness/current observable diagnostics/indexing;
- Google Search Console ownership/readiness/current URL Inspection state;
- Yandex Metrica or approved alternative conversion-measurement readiness.

If current authorized account evidence is unavailable:
`PRIVATE_STATE = HOLD_OWNER_AUTHORIZED_ACCESS_REQUIRED`.

Do not guess ownership from public HTML/DNS tokens alone.

## 6. Source-vs-live contract

Compare exact current main source bytes against live:
- homepage;
- robots.txt;
- sitemap.xml.

A source/live mismatch is recorded, not silently normalized.

If bytes differ:
- identify exact diff;
- classify whether intentional deployment transform or deployment drift;
- no M1 PASS until the difference is understood.

## 7. Indexability claim boundary

Public PASS may establish:
- reachable status;
- redirect canonicalization;
- no public robots block;
- no observed `noindex` / `X-Robots-Tag: noindex`;
- canonical consistency;
- sitemap availability.

It may **not** establish:
- indexed in Yandex;
- indexed in Google;
- Webmaster/Search Console ownership;
- absence of engine-specific indexing issues.

Those require their own evidence lanes.

## 8. Output

Primary result:
`docs/seo/technical/M1_LIVE_MEASUREMENT_BASELINE_2026-09-23_R1.md`.

Supporting evidence may be added under:
`docs/seo/technical/m1_evidence/2026-09-23/`.

## 9. Hard gates

```text
CURRENT_MAIN_SOURCE_VERIFIED = required
LIVE_HOME_HTTP_STATE = required
REDIRECT_CANONICALIZATION = required
LIVE_ROBOTS = required
LIVE_SITEMAP = required
SOURCE_LIVE_DIVERGENCE = explicit
INDEXABILITY_PUBLIC_BLOCKERS = explicit
LIVE_MAIN_CONTENT = explicit
CRAWLABLE_LINKS = explicit
PUBLIC_MEASUREMENT_TAGS = explicit
YANDEX_WEBMASTER_STATE = explicit PASS or HOLD
GOOGLE_SEARCH_CONSOLE_STATE = explicit PASS or HOLD
MEASUREMENT_READINESS = explicit PASS or HOLD
INDEXED_BRANDED_BASELINE = explicit observation or explicit limitation
OPEN_BLOCKERS = explicit
```

M1 PASS requires all blocking unknowns for current pre-M7 use to be resolved and quality >= 9.0/10.
Otherwise M1 remains an explicit blocking HOLD and M7 remains blocked.

## 10. Work / provider decision

```text
WORK_TRIGGER = NOT_MET
```

Reason:
current site is a one-page public surface plus robots/sitemap; full-volume Work would add no quality.

```text
SEARCH_WORDSTAT_PROVIDER_CALLS = 0
SITE_MUTATION = 0
```

Private owned-data tools may be used only after their exact current authorization/capability is verified and a separate bounded evidence action is durably released.

## 11. Stop / hold rules

- no source/site changes in M1;
- no invented verification tokens;
- no provider demand queries;
- no claim of indexing from sitemap/public reachability;
- no claim of ownership without authorized private evidence;
- if private readiness is unavailable, report the exact owner intervention needed rather than weakening the gate.

## 12. Released actions after remote readback

Only read-only evidence collection described above is released.

No M7 action is released.
