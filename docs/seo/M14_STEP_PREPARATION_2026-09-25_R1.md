# Octoport SEO — M14 bounded production implementation — STEP PREPARATION — 2026-09-25 R1

Status: **PREPARATION COMPLETE / SOURCE IMPLEMENTATION READY AFTER REMOTE READBACK / LIVE DEPLOYMENT FORBIDDEN**
WORK_ID: `OCTOPORT_SEO_M14_BOUNDED_SITE_IMPLEMENTATION_2026-09-25_R1`

Repository: `MaksimUnimax/runtime-fixtures`
SEO authority branch: `seo/wordstat-batch-01-2026-09-16`
Preparation SEO HEAD: `cfc5b718835f7c8cbec15370f3835e01e1fe6d48`
Frozen implementation base main HEAD: `891b89f198f89e52eef78d6da89a28641e7dcdce`

## 1. Cursor and purpose

```text
M0..M12 = ACCEPTED
M13 R2 = ACCEPTED / CURRENT
M14 = CURRENT PREPARATION
M15+ = BLOCKED
```

M14 purpose:
implement the accepted M11/M12/M13 R2 public-site contract in a bounded source branch without changing server/extension/application behavior or deploying production.

M14 is NOT:
- a new SEO architecture pass;
- a new page-owner decision;
- provider acquisition;
- production deployment;
- Yandex Webmaster/Search Console mutation;
- server/DB/API/extension implementation;
- permission to rewrite Product Truth.

## 2. Mandatory two-level authority read

LEVEL 1 read from live SEO branch:
- `docs/seo/LEVEL1/README.md` blob `4c3a30644ac736b926ec82bba6b1a6e33434ac06`
- `docs/seo/EXECUTION_RULES.md` blob `4e999af4826d6f72fd15f481a698f674c8ed2d5c`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md`
- `docs/seo/WORK_HANDOFF_RULE.md`
- `docs/seo/PRODUCT_TRUTH.md` blob `6a469d5743142d3e476afa5d2cda653fd411ecb8`
- failure history read.

LEVEL 2 read:
- `docs/seo/LEVEL2/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M13_M18_IMPLEMENTATION_LAUNCH_MEASUREMENT_RULES.md`
  blob `fe11b327eefff20f6c807581ae947a78c6bcc6e8`.

Current M13 authority read:
- `docs/seo/M13_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md`
  blob `9ef006e6d3e75fde496bffde439eb97ea10df936`
- all seven current R2 matrices;
- `docs/seo/M13_PROGRESS.md`
  blob `f3a5afa32ba9f71da4bb7a12403d536e2189c81a`.

M11/M12 current authority remains R2.

## 3. Fresh external implementation-method check

Official sources refreshed for M14:

Google Search Central:
- https://developers.google.com/search/docs/appearance/favicon-in-search
- https://developers.google.com/search/docs/appearance/site-names
- https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- https://developers.google.com/search/docs/appearance/structured-data/organization
- https://developers.google.com/search/docs/appearance/structured-data/software-app

Yandex Webmaster:
- https://yandex.com/support/webmaster/en/search-results/favicon
- https://yandex.com/support/webmaster/en/controlling-robot/metatags
- https://yandex.com/support/webmaster/en/robot-workings/canonical
- https://yandex.com/support/webmaster/en/controlling-robot/sitemap

Implementation consequences:
- HOME carries one `WebSite` JSON-LD node; Google says WebSite structured data is the most important explicit site-name preference signal.
- Static `application/ld+json` is non-executable data and must not be treated as application JavaScript.
- favicon must be a stable crawlable direct-200 square asset; one HOME favicon link is sufficient.
- `noindex` remains a deliberate page-level exclusion decision, not a substitute for page ownership.
- permanent known aliases converge to exact canonical URLs; unknown URLs remain real 404.
- sitemap lists intentionally indexable canonical pages.

## 4. Current main / parallel-work reconciliation

Frozen current main:
`891b89f198f89e52eef78d6da89a28641e7dcdce`.

Since the M13 R2 observed main `651e756f...`, current main advanced only in coordination documentation/tooling:
- `docs/development/coordination/receipts/C/C06_MERGE_AWARE_COORDINATION_GUARD_2026-09-25.md`
- `tooling/coordination/control.py`
- `tooling/coordination/test_control.py`.

No public-site, nginx, site CI, deploy/verifier or site-regression path changed in that delta.

Current public-site implementation blobs still match the frozen M13 source identities.

`PARALLEL_SITE_OVERLAP = NONE`.

## 5. Product/privacy revalidation against recent main

Recent Firefox privacy-neutral implementation allows optional technical/browser metadata to be withheld and keeps core operation available.

Current public privacy copy remains materially compatible:
- it says limited technical metadata **may** be processed for diagnostics/support;
- it does not claim technical metadata is always collected;
- it already avoids the false claim that Octoport stores no data.

Current support copy remains materially compatible:
- Firefox remains within the declared early browser set;
- availability is explicitly qualified;
- support asks a user to state browser/version manually, which does not contradict privacy-neutral automatic telemetry withholding.

Therefore:

```text
PRIVACY_SUBSTANTIVE_REWRITE_REQUIRED = false
SUPPORT_SUBSTANTIVE_REWRITE_REQUIRED = false
```

M14 changes privacy/support only for accepted search metadata/indexability requirements, not substantive policy meaning.

## 6. Favicon source authority resolved without inventing a logo

Current main already contains the Octoport extension product mark:

- `apps/extension/src/assets/octoport-128.png`
  Git blob `23e8e957dacb1d40aa795c9ca1c265b55268b435`
  PNG 128x128 RGBA
  SHA-256 `c82e9037dd1c596d5402f6dfb251660ef16655296f19bcd79c8f93a2daa1d5d5`
- `apps/extension/src/assets/octoport-icon.svg`
  blob `a0ba96d340e8ec7e661bffc1b2bed535f6d47e01`
  explicitly labeled `Octoport octopus`.

M14 may derive `apps/site/public/favicon.png` from the current 128px extension icon by deterministic resize to exactly 120x120 only.

Hard:
- no crop;
- no recolor;
- no redrawing;
- no new logo design;
- no claim that this fixes the final future visual identity.

`FAVICON_ASSET_REQUIRED = SATISFIED_BY_CURRENT_PRODUCT_MARK`.

## 7. Analytics proof gate

No durable current artifact was found that satisfies the M12 requirement for a real sanitized seller-analytics demo/result suitable for publication.

Therefore:

```text
ANALYTICS_SOURCE_IMPLEMENTATION_ALLOWED = true
ANALYTICS_SPECIFIC_UNPROVEN_METRICS_OR_SCREENSHOTS = 0
REAL_SANITIZED_DEMO_GATE = OPEN
M14_LIVE_DEPLOYMENT_ALLOWED = false
M16_LAUNCH_ALLOWED_WHILE_GATE_OPEN = false
```

M14 page source may use only:
- accepted connector mechanics;
- seller-owned data/report language already supported by Product Truth;
- generic bounded examples that do not name an unverified endpoint/data category;
- explicit boundaries against external competitor intelligence, statutory accounting and write-back.

No fake screenshot, customer case, ROI, ranking, savings or performance number.

## 8. Work trigger / executor

`WORK_TRIGGER = false`.

Reason:
bounded 13-path source implementation with deterministic tests; no large-data transformation.

Execution mode after preparation readback:

```text
EXECUTOR = MAIN_CHAT_REMOTE_DESKTOP
IMPLEMENTATION_BRANCH = seo/m14-site-implementation-2026-09-25-r1
BASE = current main after immediate pre-branch recheck
NO DIRECT MAIN EDIT
NO FORCE PUSH
NO PRODUCTION DEPLOY
```

If main advances before branch creation:
classify changed paths first.
Any overlap with M14 mutable paths = STOP / RECONCILE.

## 9. Exact planned mutation paths

Exactly 13 mutable paths:

1. `apps/site/public/index.html`
2. `apps/site/public/seller-analytics.html` — CREATE
3. `apps/site/public/privacy.html`
4. `apps/site/public/support.html`
5. `apps/site/public/install.html`
6. `apps/site/public/favicon.png` — CREATE from current product mark
7. `apps/site/public/sitemap.xml`
8. `apps/site/README.md`
9. `infra/production/nginx/octoport-site.conf`
10. `infra/production/scripts/deploy-octoport-site.sh`
11. `infra/production/scripts/verify-octoport-site.sh`
12. `.github/workflows/site-ci.yml`
13. `tests/regression/site/test_site_deployment.py`

Read/verify-only; mutation forbidden:

- `apps/site/public/robots.txt` — already satisfies R2 policy;
- `apps/site/public/styles.css` — existing public-page/page-section responsive system must be reused; no CSS change planned;
- `infra/production/nginx/octoport-apps.conf` — DO NOT CHANGE;
- `apps/extension/src/assets/octoport-128.png` — favicon source only;
- server/API/portal/extension code — DO NOT CHANGE.

If implementation cannot satisfy seller-analytics layout with current CSS, STOP and amend M14 preparation before touching `styles.css`.

## 10. Exact metadata/content implementation contract

HOME:
- Title: `Подключите ваш ИИ к Ozon и Wildberries | Octoport`
- H1: `Подключите ваш ИИ к Ozon и Wildberries`
- brand subheadline retained immediately after H1:
  `Ваш ИИ получает руки для работы с маркетплейсами.`
- description:
  `Octoport подключает выбранный вами ИИ к разрешённым данным Ozon и Wildberries через браузерное расширение. Read-only запуск; готовим закрытую бесплатную бету.`
- self canonical remains `https://octoport.ru/`;
- regular HTML link to `/seller-analytics`;
- footer/service links to `/privacy`, `/support`, `/install` so utility pages are not orphaned;
- favicon link;
- one exact WebSite JSON-LD node:
  - `name: Octoport`
  - `alternateName: ["Октопорт", "octoport.ru"]`
  - `url: https://octoport.ru/`.

seller-analytics:
- Title:
  `ИИ для аналитики маркетплейсов — данные вашего магазина | Octoport`
- H1:
  `Анализируйте данные магазина на Ozon и Wildberries с вашим ИИ`
- description:
  `Octoport помогает выбранному вами ИИ разбирать разрешённые данные вашего магазина на Ozon и Wildberries — без внешней конкурентной аналитики и автоматических изменений.`
- self canonical;
- indexable;
- HOME backlink;
- M12 block order preserved;
- examples remain generic and seller-owned only;
- no structured data rich-result markup;
- no fake proof.

privacy:
- remain indexable;
- no robots noindex;
- unique description:
  `Как Octoport обрабатывает данные: локальные реквизиты маркетплейсов, технический буфер результатов и ограниченная роль сервера.`
- substantive body unchanged.

support:
- remain indexable;
- no robots noindex;
- unique description:
  `Поддержка Octoport: границы ранней беты, безопасное обращение в поддержку и актуальные ограничения браузеров, установки и read-only режима.`
- substantive body unchanged.

install:
- preserve current body/title/canonical;
- add `<meta name="robots" content="noindex, follow">`;
- absent from sitemap.

## 11. Favicon exact implementation contract

Create:
`apps/site/public/favicon.png`

Source:
`apps/extension/src/assets/octoport-128.png@23e8e957...`

Transformation:
deterministic resize 128x128 -> 120x120, preserving full canvas and colors.

Acceptance:
- PNG signature;
- IHDR width=120;
- IHDR height=120;
- 1:1;
- HOME exactly one `rel=icon` pointing to `/favicon.png`;
- nginx direct 200, no redirect;
- Content-Type image/png;
- robots does not block;
- deploy/source validation requires it.

## 12. Nginx implementation contract

Preserve exactly three site-owned server blocks.

HTTP server:
- ACME `^~ /.well-known/acme-challenge/` remains untouched;
- inside ordinary `location /`, `www.octoport.ru` redirects directly to `https://octoport.ru$request_uri`;
- other current HTTP hosts continue to redirect to their own HTTPS host;
- no application proxy is introduced.

HTTPS www:
- keep direct `308 https://octoport.ru$request_uri`.

HTTPS apex:
- canonical 200 routes: `/`, `/seller-analytics`, `/privacy`, `/support`, `/install`;
- exact `.html` aliases -> 308 canonical extensionless URL;
- exact known trailing-slash aliases -> 308 canonical no-slash URL;
- query string preserved on aliases;
- `/index.html` -> 308 HOME;
- `/favicon.png` direct static 200;
- unknown public route remains 404;
- security headers/cache inheritance preserved.

No catch-all redirect-to-HOME.

## 13. Sitemap / robots contract

robots.txt:
no source mutation planned.
Must remain:
- crawl allowed;
- canonical Sitemap line;
- no favicon/service/CSS/YandexAdditional block.

sitemap.xml:
exactly four `<loc>` values:
1. `https://octoport.ru/`
2. `https://octoport.ru/seller-analytics`
3. `https://octoport.ru/privacy`
4. `https://octoport.ru/support`

No install while noindex.
No aliases.
No `lastmod`, `priority`, or `changefreq` needed.

## 14. CI / deploy / verifier contract

Site CI must:
- include seller-analytics and favicon in required files;
- include `tests/regression/site/test_site_deployment.py` in workflow path triggers;
- execute the site regression test module;
- parse page Title/H1/description/canonical/robots;
- distinguish executable JS from `application/ld+json`;
- parse exact WebSite JSON-LD;
- verify HOME<->analytics links and HOME utility footer links;
- verify exact 4-URL sitemap;
- verify privacy/support indexable; install noindex;
- verify favicon PNG 120x120 from PNG header and HOME link;
- verify nginx alias/host redirect contract;
- preserve existing product-truth/privacy/no-price/beta guards.

Deploy script must:
- require seller-analytics.html and favicon.png;
- validate exact canonical/metadata/site-name/favicon source invariants before install;
- preserve clean-checkout, application-ingress identity, TLS/DNS/server checks, immutable release and rollback.

Live verifier must:
- check all canonical pages;
- check alias redirects and direct HTTP-www normalization;
- check privacy/support indexability and install noindex;
- check sitemap exact set;
- check favicon direct 200/no Location/image/png;
- check HOME/analytics Title/H1/canonical/content boundary;
- preserve portal/API/auth/TLS/old-docs checks.

Regression tests must preserve application config and rollback while covering new deployment/source guards.

## 15. Tests before M14 acceptance

Required local/source gates:
1. `git diff --check`
2. syntax check deploy script
3. syntax check verifier script
4. Site CI static validation logic executed locally
5. `python3 -m unittest tests/regression/site/test_site_deployment.py`
6. exact changed-file allowlist = 13/13 only
7. `octoport-apps.conf` blob unchanged
8. server/extension/API/portal source delta = 0
9. favicon deterministic identity recorded
10. M13 R2 parity check.

Required remote gate:
- publish candidate branch;
- remote readback;
- GitHub Site CI on exact candidate HEAD = PASS.

No production deploy in M14.

## 16. Hard gates

```text
M13_R2_CURRENT = PASS
CURRENT_MAIN_FROZEN = true
PARALLEL_SITE_OVERLAP = 0

PRODUCT_TRUTH_REVALIDATED = PASS
PRIVACY_REVALIDATED = PASS
SUPPORT_REVALIDATED = PASS

MUTABLE_PATHS = 13
UNAUTHORIZED_CHANGED_PATHS_ALLOWED = 0

COMMERCIAL_OWNER_URLS = 2
INDEXABLE_CANONICAL_URLS = 4
INSTALL_NOINDEX = true
SITEMAP_URLS = 4

FAVICON_SOURCE_AUTHORITY = PASS
FAVICON_REDRAW_ALLOWED = false
WEBSITE_JSON_LD = REQUIRED
EXECUTABLE_PUBLIC_JS = 0

OCTOPORT_APPS_CONF_MUTATION = 0
SERVER_EXTENSION_PORTAL_API_MUTATION = 0
PRODUCTION_DEPLOYMENT = 0

ANALYTICS_FAKE_PROOF = 0
ANALYTICS_REAL_SANITIZED_DEMO_GATE = OPEN_FOR_LAUNCH

OPEN_CRITICAL_PREPARATION_DEFECTS = 0
```

## 17. Stop / HOLD rules

STOP before implementation if:
- main changes on any mutable/read-only guard path;
- SEO M13 R2 authority changes;
- Product Truth changes;
- favicon source asset changes;
- current application ingress changes;
- exact implementation requires a file outside the 13-path allowlist.

HOLD / amend preparation if:
- existing CSS cannot satisfy analytics layout;
- a specific analytics claim needs an unproven endpoint/data category;
- real analytics proof is proposed without sanitized durable evidence;
- favicon transformation would require redesign rather than resize.

## 18. Publication / branch policy

M14 preparation writes only `docs/seo/**`.

After preparation + manifest + plan remote-readback:
- re-fetch main;
- if clean/non-overlapping, create dedicated implementation branch from current main;
- implement only allowlisted source changes;
- no direct main mutation;
- no force push;
- no deployment;
- M14 acceptance occurs only after source/CI/readback QA.

## 19. Downstream

M15 remains blocked until M14 source implementation is accepted.

M16 launch remains blocked while the real sanitized analytics proof gate is open.
