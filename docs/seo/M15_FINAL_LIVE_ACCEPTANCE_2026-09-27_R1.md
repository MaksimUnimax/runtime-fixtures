# Octoport SEO — M15 final deployed-candidate live acceptance — 2026-09-27 R1

WORK_ID: OCTOPORT_SEO_M15_FINAL_LIVE_ACCEPTANCE_2026-09-27_R1
Status: **PASS_FINAL_LIVE / M15 FINAL ACCEPTED / M16 PREPARATION RELEASED**

## 1. Exact deployed source

Current main and deployed source:

`6a0149c958423082a62d5cb84ac757eed2e785a2`

Deployed release:

`/var/www/octoport-site/releases/6a0149c958423082a62d5cb84ac757eed2e785a2`

Previous production release before first switch:

`/var/www/octoport-site/releases/9e5f95b0db9ccbae4d2d0704f828748d21945acc`

Backup proving the old->new transition:

`/var/backups/octoport-site/20260927T052149Z`

## 2. Analytics production-proof gate

Current proof closure:

`docs/seo/M15_ANALYTICS_REAL_PRODUCT_PROOF_CLOSURE_2026-09-27_R1.md`

Blob:

`6bd4b7554e3499025e3275280712201f20b9c0cd`

The closure is based on preserved real Ozon live evidence, including the historical terminal primary gate:

```text
STD = 20/20
CAP = 24/24
TOTAL = 44/44
PENDING = 0
FROZEN = 0
```

Private seller values/identifiers remain private.

```text
REAL_SANITIZED_DEMO_GATE = CLOSED
FAKE_ANALYTICS_PROOF = 0
```

## 3. Main integration

The owner explicitly authorized the bounded SEO/site integration.

Current main:

`6a0149c958423082a62d5cb84ac757eed2e785a2`

The integration was non-force and current-main compatible.

Before integration:
- prior main = `7600f3ceb555c32ff798aac48f6c9613e8124ab2`;
- candidate was one commit ahead;
- current M14 blob parity = 14/14;
- unauthorized paths = 0.

Main exact-head site checks:
- Site CI = SUCCESS;
- Site Deploy CI = SUCCESS;
- Documentation CI = SUCCESS;
- Coordination and release safety = SUCCESS.

## 4. Production deployment

Deployment used the repository rollback-safe script:

`infra/production/scripts/deploy-octoport-site.sh`

Deployment result:

```text
DEPLOY = PASS
CURRENT_RELEASE = 6a0149c958423082a62d5cb84ac757eed2e785a2
```

The deploy log records:
- immutable release staging/byte-parity verification;
- current symlink switch;
- public-site nginx install;
- nginx syntax PASS;
- post-deploy repository verifier PASS;
- final deploy PASS.

Local evidence:
`/root/octoport-control/logs/SEO/M15_CODEX_LIVE_20260927_R2/deploy.log`

SHA-256:

`326e8f0182c5e42bff19f02c4305aad228bb105071d05a6df279d42a6bba189b`

## 5. Application ingress preservation

Before/after application ingress SHA-256:

`2675ab2704977645c03cfd758e92c97429ecfd112ef3af1bb2d89f40d4738bdc`

```text
APPLICATION_INGRESS_UNCHANGED = true
```

No app/API ingress mutation occurred.

## 6. Repository post-deploy verifier

Repository verifier:

`infra/production/scripts/verify-octoport-site.sh`

Result:

```text
VERIFIER = PASS
```

Confirmed:
- current release;
- live static site;
- inherited security headers;
- TLS;
- redirects;
- app/API routes;
- anonymous authentication guard;
- legacy docs service.

Evidence SHA-256:

`9b3399b47621a0c124666302255a5c058bb1377a030d405c7e00638b1c146df3`

## 7. Final live HTTP QA

Final live HTTP matrix:

```text
CASES = 27
FAILURES = 0
HTTP_LIVE_QA = PASS
```

Confirmed:
- 200 for HOME, seller-analytics, privacy, support, install, robots, sitemap, favicon and CSS;
- HTTP apex -> HTTPS apex;
- HTTP www -> HTTPS apex in one hop;
- HTTPS www -> HTTPS apex;
- all 9 known aliases -> exact 308 canonical target with query preservation;
- unknown URL -> real 404 with no Location;
- required security headers;
- favicon direct image/png, no redirect;
- privacy/support indexable;
- install noindex, follow;
- sitemap exact canonical set = HOME, seller-analytics, privacy, support;
- app root/login = 200 with X-Robots noindex,nofollow,noarchive;
- API live/ready = 200;
- anonymous app -> API accounts = 401.

Evidence:
`http-live.tsv`

SHA-256:

`316efcc2b63729afe1eae9ae57d2e9085147945eecef9fc61725a1269b0637f1`

## 8. Final live browser/mobile QA

Live browser matrix:

```text
CASES = 8
FAILURES = 0
BROWSER_LIVE_QA = PASS
```

PASS:
- Chrome desktop HOME;
- Chrome desktop seller-analytics;
- Chrome requested 320 HOME;
- Chrome requested 320 seller-analytics;
- Opera desktop HOME;
- Opera desktop seller-analytics;
- Yandex desktop HOME;
- Yandex desktop seller-analytics.

All cases:
- expected Title present;
- expected H1 present;
- canonical present;
- shared CSS loaded;
- document scrollWidth <= clientWidth;
- viewport-crossing offenders = 0.

Critical mobile:

```text
HOME:
clientWidth = 305
scrollWidth = 305

seller-analytics:
clientWidth = 305
scrollWidth = 305
```

Evidence:
`browser-live.json`

SHA-256:

`3ea94682084ffba5c6b77e1a9e076a46fe6c832b3f4089fc8c4f26ccad8cf274`

Visual live screenshots captured for Chrome desktop/mobile, Opera and Yandex.

## 9. Field CWV truth

```text
HOME_FIELD_CWV = FIELD_DATA_NOT_AVAILABLE
ANALYTICS_FIELD_CWV = FIELD_DATA_NOT_AVAILABLE
FIELD_CWV_FABRICATION = 0
```

No field LCP/INP/CLS values were invented from lab/browser timing.

## 10. Final M15 hard gates

```text
M15_SOURCE_PREDEPLOY = PASS
M15_ANALYTICS_PROOF = PASS
M15_MAIN_INTEGRATION = PASS
M15_PRODUCTION_DEPLOYMENT = PASS
M15_REPOSITORY_VERIFIER = PASS
M15_LIVE_HTTP = PASS
M15_LIVE_BROWSER = PASS
M15_MOBILE_320 = PASS

OPEN_CRITICAL_LIVE_DEFECTS = 0
M15_FINAL_LIVE_ACCEPTED = true
```

## 11. Final verdict

```text
M15_STATE = PASS_FINAL_LIVE
M16_PREPARATION_ALLOWED = true
```

M16 still requires its own two-level preparation and must not be inferred from this acceptance alone.
