# Octoport SEO — M15 predeploy blocking defect — 320px seller-analytics H1 overflow — 2026-09-27 R1

Status: **CONFIRMED / BLOCKING / EXTEND M14 REWORK**
WORK_ID: `OCTOPORT_SEO_M15_SOURCE_PREDEPLOY_LIVE_QA_2026-09-26_R1`

Rework candidate under test:
`339d9c2d65038743cb610f114d0a8edd3fb80a34`

Base fresh-main integration candidate:
`50e344dcb9ddb93b177624168449e6642307ac3b`

## What passed

On the rework candidate:

- M14 responsive source diff remained limited to `styles.css` + `site-ci.yml`;
- exact-head GitHub Site CI = SUCCESS;
- exact-head GitHub Site Deploy CI = SUCCESS;
- local M14 rework source QA = PASS;
- isolated nginx config = PASS;
- full HTTP canonical/redirect/indexability/Sitemap matrix = PASS;
- original HOME privacy-panel defect was no longer the first 320px blocker.

## New blocking browser finding

Chrome isolated predeploy:

```text
URL = https://octoport.ru/seller-analytics
requested viewport width = 320
documentElement.clientWidth = 305
documentElement.scrollWidth = 324
horizontal overflow = 19 px
VERDICT = FAIL
```

Critical SEO content loaded correctly:

- Title = `ИИ для аналитики маркетплейсов — данные вашего магазина | Octoport`;
- H1 = `Анализируйте данные магазина на Ozon и Wildberries с вашим ИИ`;
- canonical = `https://octoport.ru/seller-analytics`;
- stylesheet loaded.

## DOM localization

Internal overflow evidence:

```text
MAIN.public-page.section-shell
clientWidth = 265
scrollWidth = 304

H1
clientWidth = 265
scrollWidth = 304
fontSize = 48px
overflowWrap = normal
whiteSpace = normal
```

No ordinary element bounding box crossed the viewport; overflow comes from unbreakable H1 text painting beyond its content box.

## Root cause

Current mobile rule keeps the public-page H1 minimum at 3rem / 48px:

```css
.public-page h1 {
  font-size: clamp(3rem, 7vw, 5.4rem);
}
```

At the narrow 265px content track, at least one long token in the accepted Russian H1 exceeds the available line width while `overflow-wrap` remains `normal`.

## Required bounded correction

Do not hide the defect with `overflow-x: hidden`.

Extend M14 mobile rework under `@media (max-width: 680px)`:

```css
.public-page h1 {
  overflow-wrap: anywhere;
}
```

This:
- affects only public-page H1 at narrow widths;
- preserves the accepted H1 text;
- preserves font size/layout intent;
- gives the browser a legal emergency line-break opportunity;
- does not change HOME H1 or desktop/tablet public-page typography.

## Acceptance requirement

M15 browser reacceptance must prove on the exact reworked candidate:

- HOME 320px: `scrollWidth <= clientWidth`;
- seller-analytics 320px: `scrollWidth <= clientWidth`;
- critical H1/canonical/resources still present;
- desktop Chrome/Opera/Yandex sanity unchanged.

No production/main mutation occurred.
