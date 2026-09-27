# Octoport SEO — M14 320px responsive rework — Main Chat acceptance — 2026-09-27 R2

WORK_ID: `OCTOPORT_SEO_M14_REWORK_320PX_2026-09-27_R2`
Status: **PASS / ACCEPTED / SUPERSEDES PRIOR M14 SOURCE CANDIDATE FOR CURRENT AUTHORITY**

Repository: `MaksimUnimax/runtime-fixtures`
Rework branch: `seo/m14-responsive-rework-2026-09-27-r1`
Fresh-main base lineage: `a7097321410921f2fffa54fc3ecf1bc17963c0c2`
Pre-rework M15 candidate: `50e344dcb9ddb93b177624168449e6642307ac3b`
Accepted rework candidate: `2ebab969f65c071b5c6aa7f2fd2679e1f3ca8e95`
Accepted tree: `565d8af1da92ec39f044717a04786c456fe0c1b2`

## 1. Trigger and preparation authority

M15 found two independent blocking 320px layout defects.

HOME privacy-panel defect:
- `docs/seo/M15_PREDEPLOY_DEFECT_320PX_2026-09-26_R1.md`
- blob `5b0d2e0caa89cb01ba630a7d320881c78b3153cf`.

seller-analytics H1 defect:
- `docs/seo/M15_PREDEPLOY_DEFECT_320PX_ANALYTICS_H1_2026-09-27_R1.md`.

R1 rework preparation:
- `docs/seo/M14_REWORK_320PX_STEP_PREPARATION_2026-09-27_R1.md`
- blob `53e9762bf0d53a286a7e4532ba223da2795f843c`.

R2 rework preparation:
- `docs/seo/M14_REWORK_320PX_STEP_PREPARATION_2026-09-27_R2.md`
- blob `f42ca71ea1fb0aa6e8efcb1e8d8edcd03039e44d`.

R2 input manifest:
- `docs/seo/M14_REWORK_320PX_INPUT_MANIFEST_2026-09-27_R2.json`.

## 2. Accepted source correction

Under the existing `@media (max-width: 680px)` only:

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

No overflow masking such as `overflow-x:hidden` was added.

The correction:
- preserves accepted page text;
- preserves mobile font sizes;
- does not change desktop/tablet layout;
- does not change SEO metadata/content/route authority.

## 3. Exact changed-path boundary

Compared with the failing fresh-main M15 candidate `50e344d...`:

```text
CHANGED_PATHS = 2
```

Only:
1. `.github/workflows/site-ci.yml`
2. `apps/site/public/styles.css`

Current blobs:
- `styles.css` = `67b997a061b78a25b05df02353a1aa116f63bde9`
- `site-ci.yml` = `c0b2ffb289b3b1e6c80fc470d470d2aa67d4619b`

Compared with current fresh main `a7097321...`, the complete M14 candidate changes exactly 14 expected site/guard paths: the accepted prior 13-path M14 implementation plus `styles.css`.

No server/API/portal/extension behavior was edited by this rework.

## 4. Exact-head GitHub CI

Final accepted candidate:
`2ebab969f65c071b5c6aa7f2fd2679e1f3ca8e95`.

- Site CI:
  - run `36290151869`
  - conclusion: **SUCCESS**
- Site Deploy CI:
  - run `36290151875`
  - conclusion: **SUCCESS**

A transient earlier workflow-syntax failure on `cf21e14...` is not acceptance evidence. It was caused by an invalid multiline string inside YAML and was corrected before the final candidate.

## 5. Final local/source QA

On exact candidate `2ebab969...`:

```text
git diff --check = PASS
changed rework paths = 2/2
Site CI inline validator = PASS
site regression tests = 13/13 PASS
deploy assert_source = PASS
M14_REWORK_R2_LOCAL_SOURCE_QA = PASS
```

Existing M14 metadata, sitemap, favicon, nginx, deployment and claim guards remained active.

## 6. Isolated nginx predeploy QA

Exact candidate source was mounted read-only only inside a private mount+network namespace.

Host production nginx/root/symlink/systemd/DNS were not changed.

Result:

```text
nginx syntax = PASS

canonical/public 200:
  /
  /seller-analytics
  /privacy
  /support
  /install
  /robots.txt
  /sitemap.xml
  /favicon.png
  /styles.css

HTTP apex normalization = PASS
HTTP www one-hop apex normalization = PASS
HTTPS www apex normalization = PASS

known alias redirects = 9/9 PASS
query preservation = PASS
unknown representative URL = real 404
content/indexability/Sitemap checks = PASS
PREDEPLOY_HTTP_MATRIX = PASS
```

Final HTTP evidence:
- `predeploy-http.log`
- SHA-256 `9f1079fc2842ec111bcc9b77e5c5849613a7c9763327e03b6507065bee406e6d`.

## 7. Browser reacceptance

Final CDP DOM/layout matrix:

```text
BROWSER_PROBE_COUNT = 8
MOBILE_OVERFLOW = 0
RENDER_RESOURCE_QA = PASS
BROWSER_RENDER_QA = PASS
```

Browsers/pages:
- Chrome desktop HOME;
- Chrome desktop seller-analytics;
- Chrome 320px HOME;
- Chrome 320px seller-analytics;
- Opera desktop HOME;
- Opera desktop seller-analytics;
- Yandex desktop HOME;
- Yandex desktop seller-analytics.

Critical 320px result:

```text
Chrome HOME:
requested width = 320
clientWidth = 305
document scrollWidth = 305
PASS

Chrome seller-analytics:
requested width = 320
clientWidth = 305
document scrollWidth = 305
PASS
```

Both previous layout blockers are closed.

Browser metrics evidence:
- `browser-probes.json`
- SHA-256 `30c67a4f8f7779c6bc578879de79566e5c66efe16457f032630357be15256001`.

## 8. Visual screenshot evidence

Chrome headless PNG:
- HOME desktop: SHA-256 `a1ea68db196fa4be04b73dd17b03804db9e40f804794a7516c3e7f11d511d692`
- analytics desktop: `c0082c745d20dfb7fe39f56f0fa0de3e8c9ee9eafa4b84423305cb9cb862cabf`
- HOME 320px: `a64af3ac945ac9585a3b0e46038717bb6787b754b901d9a84f94610d07363bf5`
- analytics 320px: `9b055a7fed35b0dd21afdafb91b27463f868c6ca224d7fdfc6cbbb664405da5d`

Opera Xvfb/CDP-navigation PNG:
- HOME: `095897cbe2992182fa2e892c645745da14c2b8d9046c6bb8c3120a90b614cc89`
- analytics: `d71a48de3ec9973d60345f78c31f07f867df4e5d2e036a708a99287f9e2e5c2e`

Yandex Xvfb/CDP-navigation PNG:
- HOME: `597e9eac79ed9a186796fbe53be2684e9fc60e928c5422f93df568c4c84218e7`
- analytics: `6ad2459f5c50d8817dca087840ab7348341548d6fa71b010702736b65322e586`

The final vendor screenshots were navigated through CDP to the exact requested URL before capture and visually reviewed.

## 9. Harness defects distinguished from product defects

During QA, several evidence-harness defects were corrected without product-source changes:

- readiness check initially observed the pre-navigation `about:blank`;
- CDP initially selected an Opera extension background page instead of an ordinary page tab;
- persistent browser profiles initially reused cached old CSS;
- CDP screenshot transport could hang;
- Opera command-line screenshot could hang or ignore app navigation;
- fixed-number Xvfb displays could encounter stale locks.

Final harness:
- selects a normal non-extension page target;
- waits for exact `location.href` + `readyState=complete`;
- disables cache and uses clean profiles;
- separates DOM/layout measurement from screenshot capture;
- uses auto-selected Xvfb display plus CDP navigation before vendor screenshot.

None of these harness repairs changed repository candidate bytes.

## 10. Rework acceptance

```text
M14_REWORK_HARD_GATES = PASS
M14_320PX_DEFECTS_OPEN = 0
M14_CURRENT_ACCEPTED_CANDIDATE =
2ebab969f65c071b5c6aa7f2fd2679e1f3ca8e95

M14_MERGED_TO_MAIN = false
M14_PRODUCTION_DEPLOYED = false
```

This candidate supersedes `020f351e...` for current M14 source authority.

Independent launch holds remain:
- real sanitized seller-analytics demo proof;
- current main-integration governance reconciliation.

M15 may continue source/predeploy QA against `2ebab969...`.
