# Octoport SEO — M14 progress

Date: 2026-09-27
Status: **SOURCE IMPLEMENTATION ACCEPTED / CURRENT AUTHORITY = 320PX REWORK R2 / NOT MERGED / NOT DEPLOYED**
SEO branch: `seo/wordstat-batch-01-2026-09-16`

## Cursor

```text
M0..M12 = ACCEPTED
M13 R2 = ACCEPTED / CURRENT
M14 initial source implementation = ACCEPTED HISTORICAL
M14 320px responsive rework R2 = ACCEPTED / CURRENT
M15 = IN EXECUTION
M15 production deployment = HOLD
M16+ = BLOCKED
```

## Current M14 authority

Initial preparation remains binding except where the responsive rework explicitly supersedes it:
- `docs/seo/M14_STEP_PREPARATION_2026-09-25_R1.md`
- `docs/seo/M14_IMPLEMENTATION_INPUT_MANIFEST_2026-09-25_R1.json`
- `docs/seo/M14_IMPLEMENTATION_PLAN_2026-09-25_R1.tsv`

Initial source acceptance remains historical evidence:
- `docs/seo/M14_SOURCE_IMPLEMENTATION_ACCEPTANCE_2026-09-25_R1.md`
- initial accepted candidate `020f351e1ddd862db4ded85622e2eeca02ea2181`.

Current responsive rework authority:
- `docs/seo/M14_REWORK_320PX_STEP_PREPARATION_2026-09-27_R2.md`
- `docs/seo/M14_REWORK_320PX_INPUT_MANIFEST_2026-09-27_R2.json`
- `docs/seo/M14_REWORK_320PX_ACCEPTANCE_2026-09-27_R2.md`
- acceptance blob `edf16bc2506c33aca863ac4d2664bad6aa684455`.

## Current accepted source candidate

```text
FRESH_MAIN_BASE = a7097321410921f2fffa54fc3ecf1bc17963c0c2
CURRENT_M14_CANDIDATE = 2ebab969f65c071b5c6aa7f2fd2679e1f3ca8e95
CURRENT_M14_TREE = 565d8af1da92ec39f044717a04786c456fe0c1b2

CURRENT_MAIN_DELTA_PATHS = 14
UNAUTHORIZED_CHANGED_PATHS = 0
```

The 14-path delta is the accepted 13-path M14 implementation plus the now-authorized responsive `styles.css` change.

## Responsive defect closure

M15 found and durably recorded two blocking 320px defects:

1. HOME privacy-panel min-content overflow;
2. seller-analytics H1 long-token overflow.

Current mobile CSS contract under `@media (max-width: 680px)`:

```css
.public-page h1 {
  overflow-wrap: anywhere;
}

.privacy-panel > * {
  min-width: 0;
}

.privacy-panel h2 {
  overflow-wrap: anywhere;
}
```

No `overflow-x:hidden` masking was introduced.

Final browser evidence:

```text
Chrome HOME requested 320:
clientWidth = 305
scrollWidth = 305
PASS

Chrome seller-analytics requested 320:
clientWidth = 305
scrollWidth = 305
PASS

8/8 browser DOM/layout probes = PASS
MOBILE_OVERFLOW = 0
```

Desktop Chrome/Opera/Yandex HOME + analytics also passed render/content/canonical checks.

## Exact-head GitHub Actions

Final current candidate `2ebab969...`:

```text
Site CI
RUN_ID = 36290151869
RESULT = SUCCESS

Site Deploy CI
RUN_ID = 36290151875
RESULT = SUCCESS
```

## Current changed source boundary

Relative to fresh main `a7097321...` the current M14 candidate changes exactly:

1. `.github/workflows/site-ci.yml`
2. `apps/site/README.md`
3. `apps/site/public/favicon.png`
4. `apps/site/public/index.html`
5. `apps/site/public/install.html`
6. `apps/site/public/privacy.html`
7. `apps/site/public/seller-analytics.html`
8. `apps/site/public/sitemap.xml`
9. `apps/site/public/styles.css`
10. `apps/site/public/support.html`
11. `infra/production/nginx/octoport-site.conf`
12. `infra/production/scripts/deploy-octoport-site.sh`
13. `infra/production/scripts/verify-octoport-site.sh`
14. `tests/regression/site/test_site_deployment.py`

`infra/production/nginx/octoport-apps.conf` remains DO_NOT_CHANGE.

## Current source contract

Commercial SEO owners:
- `https://octoport.ru/`
- `https://octoport.ru/seller-analytics`

Indexable utilities:
- `https://octoport.ru/privacy`
- `https://octoport.ru/support`

Crawlable noindex:
- `https://octoport.ru/install`

Sitemap:
- HOME
- seller-analytics
- privacy
- support

HOME:
- M12 R2 Title/H1;
- brand subheadline retained;
- favicon link;
- static WebSite JSON-LD;
- analytics + utility HTML links;
- zero executable JS.

## Remaining downstream holds

```text
REAL_SANITIZED_DEMO_GATE = OPEN
MAIN_INTEGRATION_GOVERNANCE = HOLD_REQUIRES_EXPLICIT_RECONCILIATION

M14_MERGED_TO_MAIN = false
M14_PRODUCTION_DEPLOYED = false
M16_ALLOWED = false
```

M14 itself is accepted. M15 continues independent source/predeploy QA against `2ebab969...`.
