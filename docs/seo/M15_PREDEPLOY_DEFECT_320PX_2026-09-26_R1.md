# Octoport SEO — M15 predeploy blocking defect — 320px privacy-panel overflow — 2026-09-26 R1

Status: **CONFIRMED / BLOCKING / RETURN_TO_M14_REWORK**
WORK_ID: `OCTOPORT_SEO_M15_SOURCE_PREDEPLOY_LIVE_QA_2026-09-26_R1`

M15 fresh-main integration candidate:
`50e344dcb9ddb93b177624168449e6642307ac3b`

Base:
`a7097321410921f2fffa54fc3ecf1bc17963c0c2`

## What passed before the defect

- exact fresh-main integration diff = 13 accepted M14 paths;
- accepted M14 blob parity = 13/13;
- GitHub Site CI = SUCCESS;
- GitHub Site Deploy CI = SUCCESS;
- independent M15 source QA = PASS;
- isolated exact-nginx predeploy syntax = PASS;
- isolated HTTP canonical 200 matrix = PASS;
- HTTP/HTTPS/www normalization = PASS;
- all nine known alias redirects with query preservation = PASS;
- representative unknown URL = real 404;
- security/cache/content-type headers = PASS;
- content/indexability/Sitemap HTTP checks = PASS.

## Blocking browser finding

Chrome predeploy at requested 320px viewport:

```text
URL = https://octoport.ru/
clientWidth = 305
scrollWidth = 311
horizontal overflow = 6 px
VERDICT = FAIL
```

Critical content loaded correctly:
- Title: `Подключите ваш ИИ к Ozon и Wildberries | Octoport`;
- H1: `Подключите ваш ИИ к Ozon и Wildberries`;
- self canonical present;
- CSS/favicon loaded.

The layout defect is therefore not an error page or resource-load failure.

## DOM localization

Overflowing elements are the children of the HOME privacy panel.

Representative bounds:

```text
privacy-panel child left = 52
privacy-panel child right = 310.921875
child width = 258.921875
viewport clientWidth = 305
```

Affected DOM includes:
- privacy heading container;
- eyebrow;
- H2 `Ключи маркетплейсов остаются в браузере.`;
- `.privacy-points` and its paragraphs.

## Source cause

Current shared CSS:

```css
.privacy-panel {
  padding: clamp(32px, 6vw, 72px);
  display: grid;
  grid-template-columns: 1fr 0.9fr;
  gap: clamp(42px, 8vw, 100px);
}

@media (max-width: 980px) {
  .privacy-panel {
    grid-template-columns: 1fr;
  }
}
```

At the narrow viewport, the grid item minimum-content size is driven by the large H2/long Russian word and expands beyond the available inner track.

## Authority consequence

M13 R2 hard requirement:
no horizontal overflow at 320px.

M14 preparation explicitly froze:
`apps/site/public/styles.css = VERIFY_ONLY / STOP IF CHANGE NEEDED`.

Therefore M15 must not patch CSS directly.

Required action:
bounded M14 rework that authorizes only the minimal responsive CSS fix, then re-run M14 exact-head gates and M15 fresh-main predeploy.

No production or main mutation occurred.
