# Octoport SEO — M14 bounded rework — 320px privacy-panel overflow — STEP PREPARATION — 2026-09-27 R1

Status: **PREPARED / SOURCE REWORK ALLOWED AFTER REMOTE READBACK / M15 REMAINS REWORK_REQUIRED**
WORK_ID: `OCTOPORT_SEO_M14_REWORK_320PX_2026-09-27_R1`

Repository: `MaksimUnimax/runtime-fixtures`
SEO authority branch: `seo/wordstat-batch-01-2026-09-16`
Fresh current main: `a7097321410921f2fffa54fc3ecf1bc17963c0c2`
Current fresh-main M15 integration candidate: `50e344dcb9ddb93b177624168449e6642307ac3b`

## 1. Trigger

M15 isolated predeploy browser QA confirmed a blocking 320px HOME overflow.

Durable defect authority:
- `docs/seo/M15_PREDEPLOY_DEFECT_320PX_2026-09-26_R1.md`
- blob `5b0d2e0caa89cb01ba630a7d320881c78b3153cf`.

Observed Chrome predeploy result:

```text
URL = https://octoport.ru/
viewport request = 320px
clientWidth = 305
scrollWidth = 311
horizontal overflow = 6px
VERDICT = FAIL
```

The failure is visual/layout only:
- correct HOME Title loaded;
- correct HOME H1 loaded;
- self-canonical loaded;
- CSS/favicon loaded;
- exact candidate nginx HTTP matrix had already passed.

## 2. Authority consequence

M13 R2 requires no horizontal overflow at 320px.

M14 preparation froze:
`apps/site/public/styles.css = VERIFY_ONLY / STOP IF CHANGE NEEDED`.

Therefore M15 is not permitted to patch CSS directly.

Required state:
```text
M15 = REWORK_REQUIRED
RETURN_TO_M14 = true
```

## 3. Root cause

Current relevant CSS:

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

At 320px:
- section/panel outer width is bounded correctly;
- grid has already collapsed to one column;
- child min-content width still exceeds the available inner track;
- the large Russian H2 contains a long unbreakable word;
- grid children expand/paint outside the intended track.

Representative observed child bounds:
```text
left = 52
right = 310.921875
width = 258.921875
clientWidth = 305
```

## 4. Minimal fix design

Authorize exactly this responsive behavior under `@media (max-width: 680px)`:

```css
.privacy-panel > * {
  min-width: 0;
}

.privacy-panel h2 {
  overflow-wrap: anywhere;
}
```

Rationale:
- `min-width: 0` allows the grid item to shrink below its automatic min-content width;
- `overflow-wrap: anywhere` prevents the large long-word H2 from painting beyond the shrunken track;
- scope is only the privacy panel at narrow mobile widths;
- no desktop/tablet typography/layout is changed;
- no global heading/wrapping rule is changed;
- no content/SEO semantics are changed.

## 5. Exact source rework scope

Base:
`50e344dcb9ddb93b177624168449e6642307ac3b`.

Planned branch:
`seo/m14-responsive-rework-2026-09-27-r1`.

Exactly two mutable paths:

1. `apps/site/public/styles.css`
   - add only the two narrow-screen declarations above.

2. `.github/workflows/site-ci.yml`
   - add a static regression assertion that the mobile privacy-panel shrink/wrap guard remains present;
   - do not weaken or remove any existing M14 QA.

Any third source path = STOP / preparation amendment.

## 6. Do-not-change

No changes to:
- HTML;
- favicon;
- Sitemap;
- robots;
- nginx;
- deploy/verifier scripts;
- site regression Python;
- app/API/server/extension;
- Product Truth;
- M11/M12/M13 content/technical authority.

## 7. Required source gates

Before publishing rework candidate:

- exact base = `50e344d...`;
- changed path set = exactly 2;
- `git diff --check`;
- Site CI inline validator still passes;
- Site CI deployment block still passes;
- site regression remains 13/13 PASS;
- protected M14 blobs outside the two-path delta remain identical;
- no content/metadata/nginx diff.

Exact-head GitHub:
- Site CI = PASS;
- Site Deploy CI = PASS.

## 8. Required browser reacceptance

Source/CI PASS alone does not close the defect.

M15 must rerun on the reworked exact candidate:
- isolated nginx predeploy;
- Chrome HOME at 320px;
- Chrome seller-analytics at 320px;
- desktop Chrome/Opera/Yandex HOME+analytics sanity;
- require `scrollWidth <= clientWidth`;
- preserve critical content/canonical/resources.

Only actual 320px browser PASS closes this defect.

If RDC/browser executor remains unavailable:
`BROWSER_REACCEPTANCE = HOLD`,
not PASS.

## 9. Production boundary

```text
MAIN_MERGE = false
PRODUCTION_DEPLOYMENT = false
M16 = blocked
```

Existing independent holds remain:
- real sanitized analytics demo gate;
- main-integration governance reconciliation.

## 10. Expected downstream

After exact-head source CI:
`M14_REWORK_SOURCE_READY`.

After actual isolated 320px browser reacceptance:
- supersede M14 accepted source candidate with the reworked candidate;
- rebuild fresh-main M15 integration evidence if needed;
- rerun remaining M15 browser/performance/adversarial/live-baseline QA;
- only then issue an M15 predeploy verdict.
