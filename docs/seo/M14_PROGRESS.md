# Octoport SEO — M14 progress

Date: 2026-09-25
Status: **PREPARED / SOURCE IMPLEMENTATION READY / LIVE DEPLOYMENT FORBIDDEN**
Branch: `seo/wordstat-batch-01-2026-09-16`

## Cursor

```text
M0..M12 = ACCEPTED
M13 R2 = ACCEPTED / CURRENT
M14 = PREPARED / SOURCE IMPLEMENTATION READY
M14 PRODUCTION DEPLOYMENT = FORBIDDEN
M15+ = BLOCKED
```

## Binding M14 preparation authority

Step preparation:
- `docs/seo/M14_STEP_PREPARATION_2026-09-25_R1.md`
- blob `7f57f615063a95c56d7fc6e8afb4db2b5903b7ca`

Input manifest:
- `docs/seo/M14_IMPLEMENTATION_INPUT_MANIFEST_2026-09-25_R1.json`
- blob `c1904ed87726890c15850a5ea5342e42a9fbf228`

Implementation plan:
- `docs/seo/M14_IMPLEMENTATION_PLAN_2026-09-25_R1.tsv`
- blob `695393c77228dfaf72e504642b02d2f06c2e8f5a`
- exact mutable rows = 13

Pre-implementation main-drift reconciliation:
- `docs/seo/M14_PRE_IMPLEMENTATION_DRIFT_RECONCILIATION_2026-09-25_R1.md`
- blob `8de51bdb243dd2f60abe9b6bdc8e7eb8b764259e`

Current M13 authority:
- `docs/seo/M13_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md`
- blob `9ef006e6d3e75fde496bffde439eb97ea10df936`

## Preparation heads

```text
M14_PREPARATION_PARENT_SEO_HEAD = cfc5b718835f7c8cbec15370f3835e01e1fe6d48
M14_INITIAL_FROZEN_MAIN_HEAD = 891b89f198f89e52eef78d6da89a28641e7dcdce
M14_RECONCILED_IMPLEMENTATION_BASE = e7d66152bdb77918b65115486c9829ef7a634e69
AUTHORITY_DRIFT_STATUS = NON_OVERLAPPING_MAIN_ADVANCE_RECONCILED
```

Before implementation branch creation, live main must be fetched once more. Any overlap with an M14 mutable/guard path reopens preparation.

## Execution mode

```text
WORK_TRIGGER = false
EXECUTOR = MAIN_CHAT_REMOTE_DESKTOP
IMPLEMENTATION_BRANCH = seo/m14-site-implementation-2026-09-25-r1

DIRECT_MAIN_EDIT = false
FORCE_PUSH = false
PRODUCTION_DEPLOYMENT = false
WEBMASTER_MUTATION = false
SEARCH_CONSOLE_MUTATION = false
PROVIDER_CALLS = 0
```

## Exact mutable path allowlist

1. `apps/site/public/index.html`
2. `apps/site/public/seller-analytics.html` — CREATE
3. `apps/site/public/privacy.html`
4. `apps/site/public/support.html`
5. `apps/site/public/install.html`
6. `apps/site/public/favicon.png` — CREATE
7. `apps/site/public/sitemap.xml`
8. `apps/site/README.md`
9. `infra/production/nginx/octoport-site.conf`
10. `infra/production/scripts/deploy-octoport-site.sh`
11. `infra/production/scripts/verify-octoport-site.sh`
12. `.github/workflows/site-ci.yml`
13. `tests/regression/site/test_site_deployment.py`

Any additional required source path = STOP / preparation amendment.

## Explicit read-only / do-not-change boundaries

```text
apps/site/public/robots.txt = VERIFY_ONLY
apps/site/public/styles.css = VERIFY_ONLY / STOP IF CHANGE NEEDED
infra/production/nginx/octoport-apps.conf = DO_NOT_CHANGE
apps/extension/src/assets/octoport-128.png = READ_ONLY FAVICON SOURCE

SERVER / API / PORTAL / EXTENSION SOURCE = DO_NOT_CHANGE
DB / MIGRATIONS = DO_NOT_CHANGE
```

## Product/privacy reconciliation

```text
PRIVACY_SUBSTANTIVE_REWRITE_REQUIRED = false
SUPPORT_SUBSTANTIVE_REWRITE_REQUIRED = false
```

Recent Firefox privacy-neutral changes do not widen the current public-site claims:
- automatic technical metadata can be withheld;
- current privacy wording already says limited technical metadata may be processed rather than always collected;
- current support wording uses qualified browser availability and manual support information.

## Favicon authority

Current product mark:

`apps/extension/src/assets/octoport-128.png`
- blob `23e8e957dacb1d40aa795c9ca1c265b55268b435`
- SHA-256 `c82e9037dd1c596d5402f6dfb251660ef16655296f19bcd79c8f93a2daa1d5d5`
- PNG 128x128 RGBA.

M14 target:
`apps/site/public/favicon.png`
- deterministic resize to 120x120 only;
- no crop;
- no recolor;
- no redraw;
- no new logo design.

`FAVICON_SOURCE_AUTHORITY = PASS`.

## Current source target

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
- WebSite JSON-LD;
- analytics + utility HTML links;
- executable JS = 0.

## Analytics proof boundary

```text
REAL_SANITIZED_DEMO_GATE = OPEN
SOURCE_IMPLEMENTATION_ALLOWED = true
FAKE_ANALYTICS_PROOF = 0
M14_LIVE_DEPLOYMENT_ALLOWED = false
M16_LAUNCH_ALLOWED_WHILE_GATE_OPEN = false
```

No durable accepted real sanitized seller-analytics demo suitable for public production was found during preparation.

The M14 source page is therefore limited to verified mechanics, seller-owned permitted data/report language and generic bounded examples. No customer case, screenshot, ROI, ranking/savings metric or unverified endpoint/data category may be published.

## Required source acceptance gates

Before M14 may be accepted:

1. `git diff --check`
2. deploy script syntax PASS
3. verifier script syntax PASS
4. Site CI validation logic PASS locally
5. `python3 -m unittest tests/regression/site/test_site_deployment.py` PASS
6. exact changed-file allowlist = 13/13 maximum, unauthorized paths = 0
7. `octoport-apps.conf` unchanged
8. server/API/portal/extension source delta = 0
9. favicon deterministic source lineage PASS
10. M13 R2 parity PASS
11. candidate branch remote readback PASS
12. GitHub Site CI on exact candidate HEAD PASS

## Hard preparation result

```text
M13_R2_CURRENT = PASS
PARALLEL_SITE_OVERLAP = 0
M14_MUTABLE_PATHS = 13
FAVICON_SOURCE_AUTHORITY = PASS
PRODUCT_TRUTH_REVALIDATED = PASS
PRIVACY_REVALIDATED = PASS
SUPPORT_REVALIDATED = PASS
ANALYTICS_FAKE_PROOF_ALLOWED = 0
PRODUCTION_DEPLOYMENT_ALLOWED = false
OPEN_CRITICAL_PREPARATION_DEFECTS = 0

M14_SOURCE_IMPLEMENTATION_READY = true
```

## Next physical action

```text
FRESH MAIN FETCH
-> verify no overlapping drift
-> create seo/m14-site-implementation-2026-09-25-r1 from current main
-> implement exactly the 13-path plan
-> local deterministic tests
-> changed-path / do-not-change QA
-> remote candidate publication
-> exact-head Site CI
-> Main Chat source acceptance
-> only then M15 preparation
```

Production deployment is not part of M14.
