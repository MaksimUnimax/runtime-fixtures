# Octoport SEO — M15 source / predeploy / live QA — STEP PREPARATION — 2026-09-26 R1

Status: **PREPARED / PREDEPLOY EXECUTION READY AFTER REMOTE READBACK / PRODUCTION DEPLOYMENT HOLD**
WORK_ID: `OCTOPORT_SEO_M15_SOURCE_PREDEPLOY_LIVE_QA_2026-09-26_R1`

Repository: `MaksimUnimax/runtime-fixtures`
SEO authority branch: `seo/wordstat-batch-01-2026-09-16`
Preparation parent SEO HEAD: `2dab058c84d7c965660d4c12d863192f4c36cd52`
Fresh current main observed: `a7097321410921f2fffa54fc3ecf1bc17963c0c2`
Accepted M14 implementation branch: `seo/m14-site-implementation-2026-09-25-r1`
Accepted M14 candidate: `020f351e1ddd862db4ded85622e2eeca02ea2181`

## 1. Cursor and purpose

```text
M0..M12 = ACCEPTED
M13 R2 = ACCEPTED / CURRENT
M14 SOURCE IMPLEMENTATION = ACCEPTED
M15 = CURRENT PREPARATION
M16+ = BLOCKED
```

M15 purpose:
prove that the exact accepted M14 implementation survives current-main integration and matches accepted SEO authority at SOURCE and isolated PREDEPLOY evidence levels, then distinguish:
- candidate QA;
- existing-production live baseline;
- production deployment/live candidate QA.

M15 does not convert:
- artifact existence into QA;
- build/CI PASS into SEO PASS;
- deploy success into live QA PASS.

## 2. Mandatory two-level authority read

LEVEL 1 / project authority read:
- `docs/seo/LEVEL1/README.md`
- `docs/seo/EXECUTION_RULES.md`
- `docs/seo/QUALITY_FIRST_RESOURCE_RULE.md`
- `docs/seo/WORK_HANDOFF_RULE.md`
- `docs/seo/PRODUCT_TRUTH.md`
- `docs/seo/FAILURE_LEDGER.md`

LEVEL 2 read:
- `docs/seo/LEVEL2/README.md`
- `docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md`
- `docs/seo/LEVEL2/M13_M18_IMPLEMENTATION_LAUNCH_MEASUREMENT_RULES.md`
  current blob `fe11b327eefff20f6c807581ae947a78c6bcc6e8`.

Applicable M15 requirement:
source / predeploy / live QA must independently check:
- route/page existence;
- visible page/spec parity;
- Title/H1/meta;
- canonical;
- HTTP/redirect;
- robots/Sitemap;
- render/indexability;
- crawlable links/no orphan;
- structured data truth;
- mobile;
- performance material defects;
- thin/duplicate pages;
- unsupported/fake claims;
- broken links/assets;
- environment/live differences.

## 3. Current repository governance read

Current main `AGENTS.md` blob:
`c984291bba02e038de19e21f981dfbfb23cf85db`.

Also read:
- `docs/development/coordination/README.md`;
- `PROTOCOL.md`;
- `PLAN.md`;
- `OWNERSHIP.json`;
- `CONTINUOUS_ROADMAP_POLICY.md`.

Relevant current facts:
- SEO and `apps/site` are outside the A/B/C task allocation;
- current AGENTS says only C integrates main;
- current OWNERSHIP gives C broad access but explicitly denies `apps/site/**`;
- therefore final site-source main-integration ownership is internally inconsistent in current coordination authority.

Decision:
```text
MAIN_INTEGRATION_GOVERNANCE = HOLD_REQUIRES_EXPLICIT_RECONCILIATION
M15_PREDEPLOY_QA_BLOCKED_BY_THIS = false
MAIN_MERGE_ALLOWED_BY_M15_PREPARATION = false
```

M15 will not silently choose an integration owner.

## 4. Current-main drift reconciliation

M14 source was accepted from base:
`e7d66152bdb77918b65115486c9829ef7a634e69`.

Fresh main:
`a7097321410921f2fffa54fc3ecf1bc17963c0c2`.

Main advanced by 116 commits.

The drift includes API/server/ops/readiness/coordination changes, but fresh remote readback proves that all 16 M14 site/guard/favicon-source identities remain byte-identical to the frozen M14 preparation state:

```text
SITE_GUARD_BLOBS_UNCHANGED = 16/16
SITE_PATH_OVERLAP = 0
```

No current-main change touches:
- `apps/site/**`;
- `infra/production/nginx/octoport-site.conf`;
- `infra/production/nginx/octoport-apps.conf`;
- site deploy/verifier;
- `.github/workflows/site-ci.yml`;
- site regression;
- accepted Octoport icon source.

Therefore:
`M14_DIFF_REPLAY_ON_FRESH_MAIN = CLEAN_IN_PRINCIPLE`,
but execution must re-fetch main immediately before creating a predeploy integration branch.

## 5. Product/readiness drift reconciliation

Fresh main readiness evidence read:
- `A04_BUSINESS_COVERAGE_RECONCILIATION_2026-09-25.md`;
- `C06_READINESS_RECONCILIATION_2026-09-25.md`;
- `C06_RESIDUAL_GAPS_RECONCILIATION_2026-09-25.md`;
- current `docs/product/readiness/GAPS_AND_HANDOFF.md`.

Current evidence strengthens deterministic operation-level coverage but still explicitly does not prove:
- all live provider field semantics;
- live Ozon/WB owner business values;
- owner gold-set agreement;
- store/reviewer/deployment acceptance.

M14 analytics copy remains compatible because it:
- names no unverified endpoint/data category;
- uses seller-owned permitted data/report language;
- is read-only;
- avoids external market-intelligence/accounting/write-back promises;
- publishes no fabricated performance claim.

`M14_COPY_PRODUCT_DRIFT = NONE_MATERIAL`.

## 6. M12 proof gate remains binding

Current M12 proof authority:

`ANALYTICS_PROOF_DEMO = PROOF_REQUIRED_BEFORE_PRODUCTION`.

Requirement:
at least one real sanitized demonstration or source-backed product example must prove the central seller-owned analytics value before production.

Current status:

```text
REAL_SANITIZED_DEMO_GATE = OPEN
FAKE_ANALYTICS_PROOF = 0
M15_SOURCE_QA_ALLOWED = true
M15_ISOLATED_PREDEPLOY_QA_ALLOWED = true
EXISTING_LIVE_READ_ONLY_BASELINE_ALLOWED = true

M15_PRODUCTION_DEPLOYMENT_ALLOWED = false
M15_CANDIDATE_LIVE_QA_ALLOWED = false
M16_LAUNCH_ALLOWED = false
```

This is an explicit launch HOLD, not a reason to skip all independent M15 work.

## 7. Fresh official method refresh — 2026-09-26

Official Google Search Central refreshed:
- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- https://developers.google.com/search/docs/appearance/site-names
- https://developers.google.com/search/docs/appearance/favicon-in-search
- https://developers.google.com/search/docs/appearance/page-experience
- https://developers.google.com/search/docs/appearance/core-web-vitals
- https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing

Official Yandex Webmaster refreshed:
- https://yandex.com/support/webmaster/en/robot-workings/canonical
- https://yandex.com/support/webmaster/en/robot-workings/double
- https://yandex.com/support/webmaster/en/controlling-robot/robots-txt
- https://yandex.com/support/webmaster/en/controlling-robot/sitemap
- https://yandex.com/support/webmaster/en/robot-workings/vision
- https://yandex.com/support/webmaster/en/recommendations/mobile-site
- https://yandex.com/support/webmaster/en/search-results/favicon

web.dev:
- https://web.dev/articles/vitals

No method drift invalidating M13 R2 / M14 contract was found.

Important QA consequences:
- permanent redirects remain a strong duplicate/canonical signal;
- canonical pages must be accessible and self-canonical;
- noindex must be observable by a crawler;
- sitemap is checked as a discoverability/canonical hint, not indexing proof;
- critical content/canonical must be present in initial HTML;
- responsive same-URL content must remain usable at 320px without horizontal overflow;
- favicon must be crawlable/stable/direct and is not guaranteed to display;
- field CWV must not be fabricated; LCP/INP/CLS target remains 2.5s/200ms/0.1 at p75 when real field data exists.

## 8. Work trigger / executor

`WORK_TRIGGER = false`.

M15 is a bounded finite QA matrix.

Executor:
`MAIN_CHAT_REMOTE_DESKTOP`.

No provider search/Wordstat/GenSearch is required.

## 9. Exact M15 execution branch design

After preparation + manifest + plan remote readback:

1. fetch current `main` and M14 implementation branch;
2. classify drift since `a7097321...`;
3. if no M15 site/guard overlap, create:
   `seo/m15-predeploy-integration-2026-09-26-r1`
   from the then-current main;
4. replay the exact accepted M14 13-file content onto that fresh main;
5. remote compare must show exactly 13 changed paths;
6. every one of the 13 resulting blobs must equal the accepted M14 remote blob;
7. all non-site fresh-main changes remain inherited untouched.

No merge to main occurs in M15 predeploy phase.

## 10. Source QA contract

Source QA must independently prove:
- exact M11/M12/M13 parity;
- 4 canonical indexable URLs and one install noindex status page;
- HOME exact Title/H1/description/brand subheadline;
- seller-analytics exact Title/H1/description/canonical and bounded content;
- privacy/support body truth preserved and indexable;
- install noindex;
- exact four-URL Sitemap;
- robots allows required pages/assets;
- WebSite JSON-LD exact and truthful;
- executable JS = 0;
- favicon exact lineage and 120x120 PNG;
- regular crawlable HOME↔analytics link and utility links;
- all known aliases encoded in nginx;
- unknown route 404;
- no stale/historical pricing;
- no proprietary-LLM claim;
- no external market intelligence/accounting/write-back claim;
- no fake screenshot/case/ROI/ranking/savings;
- no broken local assets or links.

## 11. Isolated predeploy environment

M15 predeploy must not alter host production nginx/root/symlink.

Environment capability was checked during preparation:

```text
unshare = available
nginx = available
google-chrome = available
opera = available
Yandex Browser = available
mount+network namespace creation = PASS
Octoport certificate files = present
```

Preferred predeploy harness:

- start a private mount + network namespace with `unshare --mount --net --pid --fork`;
- first make mount propagation private;
- bind the exact integration candidate `apps/site/public` over the expected site root only inside that mount namespace;
- use a temporary top-level nginx wrapper that includes the **exact candidate** `infra/production/nginx/octoport-site.conf`;
- use an isolated nginx pid/log path;
- bring up only the namespace loopback;
- bind ports 80/443 inside that private network namespace;
- never reload or signal host nginx;
- never alter host `/var/www/octoport-site/current`, certs, systemd or DNS.

If mount/net namespace isolation cannot be established at execution time:
`PREDEPLOY_ENVIRONMENT = HOLD`.
Do not substitute host production mutation.

## 12. Predeploy HTTP matrix

Inside the isolated namespace verify at minimum:

Canonical 200:
- `/`
- `/seller-analytics`
- `/privacy`
- `/support`
- `/install`
- `/robots.txt`
- `/sitemap.xml`
- `/favicon.png`
- `/styles.css`

Host/scheme redirects:
- HTTP apex -> HTTPS apex same path/query;
- HTTP www -> HTTPS apex same path/query in one hop;
- HTTPS www -> HTTPS apex same path/query.

Known alias 308 exact targets with query preservation:
- `/index.html` -> `/`;
- `/seller-analytics.html`, `/seller-analytics/`;
- `/privacy.html`, `/privacy/`;
- `/support.html`, `/support/`;
- `/install.html`, `/install/`.

Unknown representative URL:
- real 404;
- no Location.

Headers:
- inherited CSP/X-Frame-Options/nosniff remain;
- HTML no-cache behavior remains;
- CSS/favicon cache/content types remain correct;
- favicon has no redirect.

## 13. Browser/render/mobile QA

Run browsers against the isolated candidate, not public production.

Required:
- Chrome desktop HOME + analytics;
- Opera desktop HOME + analytics;
- Yandex desktop HOME + analytics;
- Chrome 320px viewport HOME + analytics.

Evidence:
- screenshot;
- dumped DOM/source parity;
- no browser console/network load error for first-party HTML/CSS/favicon;
- H1/main content/links visible;
- no content clipped horizontally at 320px;
- no mobile content loss;
- navigation/utility links usable;
- favicon loads.

Browser QA is visual/render evidence, not field-CWV evidence.

## 14. Performance QA boundary

M15 must not invent field metrics.

Predeploy:
- record HTML/CSS/favicon byte sizes;
- confirm zero executable JS;
- confirm no blocking third-party runtime;
- record browser navigation diagnostics only as lab/predeploy diagnostics;
- compare HOME static dependency count/weight with current foundation and flag only material regressions.

Field:
`FIELD_DATA_NOT_AVAILABLE` for the not-yet-deployed analytics URL unless a real field source exists.

No arbitrary Lighthouse-score hard gate is introduced.
Lighthouse is not currently installed in the execution environment and M15 does not install new tooling merely to manufacture a score.

## 15. Existing-production live baseline

After durable M15 preparation, M15 execution may take a fresh **read-only current-production baseline**.

It must be labeled:
`EXISTING_LIVE_BASELINE / PRE-M14 DEPLOYMENT`.

It may verify current:
- status/redirects;
- TLS/headers;
- current public HTML;
- current app/API safety routes required by verifier;
- current robots/sitemap/favicon state.

It must NOT be reported as M14 candidate live QA.

## 16. Candidate live QA / deployment policy

Because `REAL_SANITIZED_DEMO_GATE = OPEN`:

```text
PRODUCTION_DEPLOYMENT = HOLD
M14_CANDIDATE_LIVE_QA = HOLD
M16 = BLOCKED
```

When the proof gate later closes:
- reopen M15;
- fetch fresh main and current M14/M15 authority;
- resolve main-integration governance;
- rebuild/revalidate an exact current-main integration candidate;
- only after source/predeploy recheck may any merge/deploy occur;
- run candidate live HTTP + browser QA after deployment;
- only accepted M15 live QA may release M16.

## 17. Main integration governance HOLD

Current repo authority contains a conflict:
- AGENTS: only C integrates main;
- OWNERSHIP: C denies `apps/site/**`;
- coordination README: SEO and apps/site are outside A/B/C allocation.

M15 does not guess the resolution.

Before any main merge one of these must become explicit:
- current coordination authority assigns the exact site integration to C; or
- owner/controller records a bounded site/SEO integration exception/owner.

This HOLD does not block source/predeploy QA.

## 18. Exact M15 outputs

Execution must produce:

1. `M15_SOURCE_MANIFEST.md`
2. `M15_INTEGRATION_RECONCILIATION.md`
3. `M15_SOURCE_QA.tsv`
4. `M15_PREDEPLOY_HTTP_QA.tsv`
5. `M15_RENDER_MOBILE_QA.tsv`
6. `M15_PERFORMANCE_QA.tsv`
7. `M15_ADVERSARIAL_QA.tsv`
8. `M15_EXISTING_LIVE_BASELINE.tsv`
9. `M15_QA.md`
10. `M15_PROGRESS.md`

No live-candidate result may be fabricated while deployment is held.

## 19. Hard gates

```text
M14_ACCEPTED_CANDIDATE = 020f351e1ddd862db4ded85622e2eeca02ea2181
M14_REMOTE_BLOB_PARITY = 13/13

CURRENT_MAIN_SITE_GUARDS_UNCHANGED = 16/16
CURRENT_MAIN_SITE_OVERLAP = 0

SOURCE_QA_REQUIRED = true
ISOLATED_PREDEPLOY_HTTP_REQUIRED = true
BROWSER_RENDER_QA_REQUIRED = true
MOBILE_320_QA_REQUIRED = true
ADVERSARIAL_CLAIM_QA_REQUIRED = true
EXISTING_LIVE_BASELINE_REQUIRED = true

UNAUTHORIZED_CHANGED_PATHS_ALLOWED = 0
HOST_PRODUCTION_MUTATION_DURING_PREDEPLOY = 0

FIELD_CWV_FABRICATION = 0
FAKE_ANALYTICS_PROOF = 0

REAL_SANITIZED_DEMO_GATE = OPEN
MAIN_INTEGRATION_GOVERNANCE = HOLD

PRODUCTION_DEPLOYMENT_ALLOWED = false
M16_ALLOWED = false
```

## 20. PASS / HOLD semantics

Possible M15 predeploy result:

`PASS_SOURCE_PREDEPLOY_WITH_EXPLICIT_LIVE_HOLD`

only if:
- source QA PASS;
- exact current-main integration candidate PASS;
- isolated HTTP QA PASS;
- render/mobile QA PASS;
- performance material-defect QA PASS;
- adversarial QA PASS;
- existing-live baseline captured honestly;
- open production blockers are exactly enumerated.

This is not final M15 live acceptance.

Final M15 live PASS requires later deployed-candidate live QA.

## 21. Publication path

Preparation writes only:
`docs/seo/**`.

No main merge, site production deploy, nginx reload, Webmaster/Search Console mutation, provider call, server/API/extension mutation occurs during preparation.

## 22. Next physical action

After preparation + input manifest + QA plan remote readback:

```text
fresh main
-> fresh M14 candidate
-> no-overlap check
-> create isolated M15 integration branch from fresh main
-> replay exact 13 accepted M14 blobs
-> exact-head GitHub Site CI + Site Deploy CI
-> source QA
-> mount/net namespace predeploy nginx
-> HTTP matrix
-> Chrome/Opera/Yandex + 320px render/mobile QA
-> performance/adversarial QA
-> read-only existing-live baseline
-> M15 QA
-> explicit LIVE/DEPLOY HOLD while proof + integration-governance gates remain open
```
