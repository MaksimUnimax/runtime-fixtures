# Octoport SEO — M14 bounded rework — 320px responsive closure — STEP PREPARATION — 2026-09-27 R2

Status: **PREPARED / SUPERSEDES R1 MOBILE CSS CONTRACT / SOURCE REWORK ALLOWED AFTER REMOTE READBACK**
WORK_ID: `OCTOPORT_SEO_M14_REWORK_320PX_2026-09-27_R2`

Repository: `MaksimUnimax/runtime-fixtures`
SEO branch: `seo/wordstat-batch-01-2026-09-16`
Fresh current main: `a7097321410921f2fffa54fc3ecf1bc17963c0c2`
Current rework branch: `seo/m14-responsive-rework-2026-09-27-r1`
Current rework candidate before R2: `339d9c2d65038743cb610f114d0a8edd3fb80a34`

## 1. R2 trigger

R1 rework correctly addressed the HOME privacy-panel min-content defect, but M15 then exposed a second independent 320px blocker on the seller-analytics H1.

Defect authorities:

1. HOME privacy panel:
   - `docs/seo/M15_PREDEPLOY_DEFECT_320PX_2026-09-26_R1.md`
   - blob `5b0d2e0caa89cb01ba630a7d320881c78b3153cf`.

2. seller-analytics H1:
   - `docs/seo/M15_PREDEPLOY_DEFECT_320PX_ANALYTICS_H1_2026-09-27_R1.md`.

Observed analytics defect:

```text
URL = https://octoport.ru/seller-analytics
requested viewport = 320
clientWidth = 305
scrollWidth = 324
H1 clientWidth = 265
H1 scrollWidth = 304
H1 fontSize = 48px
H1 overflowWrap = normal
VERDICT = FAIL
```

## 2. Exact R2 mobile CSS contract

Within the existing `@media (max-width: 680px)` only:

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

The existing privacy-panel border-radius remains unchanged.

## 3. Why this is bounded

`.public-page h1 { overflow-wrap:anywhere; }`:

- preserves the accepted H1 text;
- preserves current mobile font size;
- affects only public utility/use-case pages at <=680px;
- does not affect HOME H1;
- does not change desktop/tablet typography;
- does not hide content;
- avoids `overflow-x:hidden` masking.

The privacy-panel rules remain the R1 fix:
- grid children may shrink below automatic min-content width;
- long HOME privacy H2 gets an emergency wrap opportunity.

## 4. Exact mutable paths

Unchanged from R1:

1. `apps/site/public/styles.css`
2. `.github/workflows/site-ci.yml`

No third source path is authorized.

## 5. Site CI regression contract

The existing static 320px guard must be extended to require all three declarations:

- mobile `.public-page h1 { overflow-wrap:anywhere; }`;
- mobile `.privacy-panel > * { min-width:0; }`;
- mobile `.privacy-panel h2 { overflow-wrap:anywhere; }`.

Do not weaken any existing M14 metadata, claim, sitemap, favicon, nginx, deployment or regression checks.

## 6. Required source gates

On the exact R2 candidate:

- diff from `50e344d...` contains only the two authorized paths;
- `git diff --check`;
- inline Site CI validator PASS;
- site regression 13/13 PASS;
- deploy `assert_source` PASS;
- exact-head GitHub Site CI PASS;
- exact-head GitHub Site Deploy CI PASS.

## 7. Required browser reacceptance

Source gates are insufficient.

Isolated candidate browser QA must show:

```text
Chrome HOME 320px:
scrollWidth <= clientWidth

Chrome seller-analytics 320px:
scrollWidth <= clientWidth
```

Also rerun:

- Chrome desktop HOME + analytics;
- Opera desktop HOME + analytics;
- Yandex desktop HOME + analytics.

All must preserve:
- expected Title/H1/canonical;
- stylesheet/resource loading;
- no horizontal overflow.

## 8. Harness evidence boundary

Two harness issues seen during M15 are not candidate defects:

1. CDP initially observed `about:blank` before target navigation began.
2. CDP initially selected a `chrome-extension://.../background.html` target.

Harness correction:
- choose a normal `type=page` non-extension target;
- wait until `location.href == requested URL` and `readyState == complete`;
- disable extensions for site-render QA.

These harness changes stay outside product source and must not be committed as site evidence.

## 9. Production boundary

No main merge or production deployment in this rework.

Existing independent holds remain:

- `REAL_SANITIZED_DEMO_GATE = OPEN`;
- `MAIN_INTEGRATION_GOVERNANCE = HOLD`;
- M16 blocked.

## 10. Supersession

This R2 preparation supersedes only the exact mobile CSS contract in:

`M14_REWORK_320PX_STEP_PREPARATION_2026-09-27_R1.md`.

All other M14/M15 authorities remain unchanged.
