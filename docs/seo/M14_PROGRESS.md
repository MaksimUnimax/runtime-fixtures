# Octoport SEO — M14 progress

Date: 2026-09-25
Status: **SOURCE IMPLEMENTATION ACCEPTED / NOT MERGED TO MAIN / NOT DEPLOYED / M15 PREPARATION RELEASED**
SEO branch: `seo/wordstat-batch-01-2026-09-16`
Implementation branch: `seo/m14-site-implementation-2026-09-25-r1`

## Cursor

```text
M0..M12 = ACCEPTED
M13 R2 = ACCEPTED / CURRENT
M14 = SOURCE IMPLEMENTATION ACCEPTED
M14 MERGE TO MAIN = NOT PERFORMED
M14 PRODUCTION DEPLOYMENT = NOT PERFORMED
M15 = PREPARATION ALLOWED / NOT YET STARTED
M16+ = BLOCKED
```

## Binding M14 authority

Preparation:
- `docs/seo/M14_STEP_PREPARATION_2026-09-25_R1.md`
- blob `7f57f615063a95c56d7fc6e8afb4db2b5903b7ca`

Input manifest:
- `docs/seo/M14_IMPLEMENTATION_INPUT_MANIFEST_2026-09-25_R1.json`
- blob `c1904ed87726890c15850a5ea5342e42a9fbf228`

Implementation plan:
- `docs/seo/M14_IMPLEMENTATION_PLAN_2026-09-25_R1.tsv`
- blob `695393c77228dfaf72e504642b02d2f06c2e8f5a`

Drift reconciliation:
- `docs/seo/M14_PRE_IMPLEMENTATION_DRIFT_RECONCILIATION_2026-09-25_R1.md`
- blob `8de51bdb243dd2f60abe9b6bdc8e7eb8b764259e`

Source implementation acceptance:
- `docs/seo/M14_SOURCE_IMPLEMENTATION_ACCEPTANCE_2026-09-25_R1.md`
- blob `95984222a59a19bf6a97271e8496fc136bab9a09`

## Accepted source candidate

```text
IMPLEMENTATION_BASE_MAIN = e7d66152bdb77918b65115486c9829ef7a634e69
ACCEPTED_REMOTE_CANDIDATE = 020f351e1ddd862db4ded85622e2eeca02ea2181
ACCEPTED_TREE = 68e8585aff942b46bf8bb38f68c577aa11390bc4
CHANGED_PATHS = 13
UNAUTHORIZED_CHANGED_PATHS = 0
REMOTE_BLOB_MATCH = 13/13
```

## Exact-head GitHub Actions

```text
Site CI
RUN_ID = 36113860331
JOB_ID = 108003228386
RESULT = SUCCESS

Site Deploy CI
RUN_ID = 36113860315
JOB_ID = 108003228510
RESULT = SUCCESS
```

Both runs executed on:
`020f351e1ddd862db4ded85622e2eeca02ea2181`.

## Final source QA

```text
git diff --check = PASS
deploy bash syntax = PASS
verifier bash syntax = PASS
Site CI inline validation = PASS
Site deployment source validation = PASS
deploy assert_source = PASS
site regression tests = 13/13 PASS
favicon decode = PASS
M13 R2 parity = PASS
changed allowlist = 13/13 PASS
protected blobs = 4/4 PASS
OPEN_CRITICAL_SOURCE_DEFECTS = 0
QUALITY_SCORE = 9.8/10
```

Protected unchanged:
- `apps/site/public/robots.txt`
- `apps/site/public/styles.css`
- `infra/production/nginx/octoport-apps.conf`
- `apps/extension/src/assets/octoport-128.png`

Server/API/portal/extension implementation delta from M14 = 0.

## Current implemented source contract

Commercial SEO-owner pages:
- `https://octoport.ru/`
- `https://octoport.ru/seller-analytics`

Indexable utilities:
- `https://octoport.ru/privacy`
- `https://octoport.ru/support`

Crawlable noindex:
- `https://octoport.ru/install`

Sitemap target:
- HOME
- seller-analytics
- privacy
- support

HOME source includes:
- accepted M12 R2 Title/H1;
- retained brand subheadline;
- favicon link;
- static WebSite JSON-LD;
- analytics and utility crawlable HTML links;
- zero executable public JS.

Known aliases have explicit 308 canonical redirect source rules.
Unknown route remains 404 by source contract.

## Favicon lineage

```text
SOURCE = apps/extension/src/assets/octoport-128.png
SOURCE_GIT_BLOB = 23e8e957dacb1d40aa795c9ca1c265b55268b435
SOURCE_SHA256 = c82e9037dd1c596d5402f6dfb251660ef16655296f19bcd79c8f93a2daa1d5d5

TARGET = apps/site/public/favicon.png
TARGET_GIT_BLOB = 86cc59fca80371fc663f423845c834908951ecd9
TARGET_SHA256 = e37c55c2f344d2f5eb08b8090939e1979f3e9e875b5d50bd5cee5e3289af5647
TARGET_SIZE = 120x120 PNG
```

No crop/recolor/redraw/new logo design occurred.

## Analytics proof / launch gate

```text
REAL_SANITIZED_DEMO_GATE = OPEN
FAKE_ANALYTICS_PROOF = 0
M14_SOURCE_IMPLEMENTATION_ACCEPTED = true
PRODUCTION_DEPLOYMENT_ALLOWED_FROM_M14 = false
M16_LAUNCH_ALLOWED_WHILE_PROOF_GATE_OPEN = false
```

This does not invalidate M14 source acceptance. It remains a downstream launch gate.

## Next physical action

```text
M15 STEP PREPARATION
-> fresh main + SEO authority
-> exact accepted M14 candidate readback
-> applicable LEVEL 1 + M13-M18 LEVEL 2
-> predeploy/live QA contract
-> merge/deploy sequencing decision
-> analytics proof gate treatment
-> GitHub persist + remote readback
-> only then M15 execution
```

M14 itself did not merge to main and did not deploy production.
