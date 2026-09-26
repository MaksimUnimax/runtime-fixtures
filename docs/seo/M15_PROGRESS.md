# Octoport SEO — M15 progress

Date: 2026-09-26
Status: **PREPARED / SOURCE+ISOLATED PREDEPLOY EXECUTION READY / PRODUCTION DEPLOYMENT HOLD**
SEO branch: `seo/wordstat-batch-01-2026-09-16`

## Cursor

```text
M0..M12 = ACCEPTED
M13 R2 = ACCEPTED / CURRENT
M14 SOURCE IMPLEMENTATION = ACCEPTED
M15 = PREPARED / PREDEPLOY EXECUTION READY
M15 PRODUCTION DEPLOYMENT = HOLD
M16+ = BLOCKED
```

## Binding M15 preparation authority

Step preparation:
- `docs/seo/M15_STEP_PREPARATION_2026-09-26_R1.md`
- blob `0072a3e71a1315555ca4207a9a93c3d94f5a74d0`

Input manifest:
- `docs/seo/M15_QA_INPUT_MANIFEST_2026-09-26_R1.json`
- blob `c4dc04aabe8d02867da08621a326486f2f7437f9`

QA plan:
- `docs/seo/M15_QA_PLAN_2026-09-26_R1.tsv`
- blob `6f59850d4da6455463e2ff4266fee57152befdd1`
- rows = 35

## Preparation authority state

```text
M15_PREPARATION_PARENT_SEO_HEAD = 2dab058c84d7c965660d4c12d863192f4c36cd52
M15_PREPARATION_COMMIT = fb20049b7018c1df376111066215f447603ab552
M15_OBSERVED_MAIN_HEAD = a7097321410921f2fffa54fc3ecf1bc17963c0c2

M14_ACCEPTED_CANDIDATE = 020f351e1ddd862db4ded85622e2eeca02ea2181
M14_ACCEPTED_TREE = 68e8585aff942b46bf8bb38f68c577aa11390bc4

CURRENT_MAIN_SITE_GUARD_BLOBS_UNCHANGED = 16/16
CURRENT_MAIN_SITE_PATH_OVERLAP = 0
```

Current main advanced 116 commits since the M14 implementation base, but none of the frozen site/guard/favicon-source paths changed.

## Current Product/readiness reconciliation

Fresh main evidence still keeps these boundaries open:
- live Ozon/WB business values;
- full WB field/schema semantics;
- owner gold-set agreement;
- store/reviewer/deployment acceptance.

M14 public analytics copy remains compatible because it is generic, seller-owned and read-only and names no unsupported metric/category.

```text
M14_COPY_PRODUCT_DRIFT = NONE_MATERIAL
```

## Current M15 execution design

Planned predeploy integration branch:

`seo/m15-predeploy-integration-2026-09-26-r1`

Execution:
1. fresh main fetch;
2. fresh M14 candidate readback;
3. overlap classification;
4. create integration branch from then-current main;
5. replay exact accepted M14 13 remote blobs;
6. exact 13-path compare/blob parity;
7. exact-head Site CI + Site Deploy CI;
8. independent source QA;
9. isolated mount+network namespace nginx predeploy;
10. HTTP matrix;
11. Chrome/Opera/Yandex desktop render;
12. Chrome 320px mobile render;
13. performance/adversarial QA;
14. read-only current-production PRE-M14 baseline;
15. M15 QA.

## Isolated predeploy capability

Preparation environment check:

```text
unshare = AVAILABLE
nginx = AVAILABLE
google-chrome = AVAILABLE
opera = AVAILABLE
yandex_browser = AVAILABLE
mount+network namespace = PASS
Octoport certificate files = PRESENT
lighthouse = NOT INSTALLED / NOT REQUIRED
```

The predeploy harness must:
- run in private mount + network namespace;
- use exact candidate static bytes;
- include exact candidate `octoport-site.conf`;
- bind 80/443 only inside the private network namespace;
- never reload/signal production nginx;
- never change host current release, systemd, DNS or certificates.

## Required QA

```text
SOURCE_QA_PLAN_ROWS = 35
SOURCE_QA_REQUIRED = true
ISOLATED_PREDEPLOY_HTTP_REQUIRED = true
BROWSER_RENDER_QA_REQUIRED = true
MOBILE_320_QA_REQUIRED = true
PERFORMANCE_MATERIAL_DEFECT_QA_REQUIRED = true
ADVERSARIAL_CLAIM_QA_REQUIRED = true
EXISTING_LIVE_BASELINE_REQUIRED = true
```

Fresh official Google/Yandex/web.dev technical guidance was rechecked on 2026-09-26. No method drift invalidating M13 R2/M14 was found.

## Explicit launch holds

### Analytics production proof

M12 remains binding:

```text
REAL_SANITIZED_DEMO_GATE = OPEN
FAKE_ANALYTICS_PROOF = 0
```

Therefore:

```text
M15_SOURCE_QA_ALLOWED = true
M15_ISOLATED_PREDEPLOY_QA_ALLOWED = true
EXISTING_LIVE_READ_ONLY_BASELINE_ALLOWED = true

M15_PRODUCTION_DEPLOYMENT_ALLOWED = false
M15_CANDIDATE_LIVE_QA_ALLOWED = false
M16_ALLOWED = false
```

### Main-integration governance

Current repo authority is internally inconsistent for site integration:
- AGENTS says only C integrates main;
- C OWNERSHIP denies `apps/site/**`;
- coordination README says SEO/apps/site are outside A/B/C.

```text
MAIN_INTEGRATION_GOVERNANCE = HOLD_REQUIRES_EXPLICIT_RECONCILIATION
```

This does not block isolated predeploy QA.

## Allowed M15 predeploy result

If all independent QA rows except the explicit external holds pass:

```text
M15_STATE =
PASS_SOURCE_PREDEPLOY_WITH_EXPLICIT_LIVE_HOLD
```

This is NOT final M15 live acceptance.

Final M15 live PASS requires:
- proof gate closed;
- main integration authority resolved;
- fresh current-main revalidation;
- production deployment authorization/path;
- deployed candidate live HTTP + browser QA.

## Execution outputs required

1. `M15_SOURCE_MANIFEST.md`
2. `M15_INTEGRATION_RECONCILIATION.md`
3. `M15_SOURCE_QA.tsv`
4. `M15_PREDEPLOY_HTTP_QA.tsv`
5. `M15_RENDER_MOBILE_QA.tsv`
6. `M15_PERFORMANCE_QA.tsv`
7. `M15_ADVERSARIAL_QA.tsv`
8. `M15_EXISTING_LIVE_BASELINE.tsv`
9. `M15_QA.md`
10. `M15_PROGRESS.md` update

## Hard preparation result

```text
M14_CURRENT_ACCEPTED = PASS
MAIN_SITE_OVERLAP = 0
M15_PREDEPLOY_ENVIRONMENT = READY
OPEN_CRITICAL_PREPARATION_DEFECTS = 0

M15_PREDEPLOY_EXECUTION_READY = true
M15_PRODUCTION_DEPLOYMENT_ALLOWED = false
M16_ALLOWED = false
```

## Next physical action

```text
fresh main/candidate
-> create fresh-main M15 integration branch
-> replay exact 13 M14 blobs
-> exact-head CI
-> source QA
-> isolated namespace nginx predeploy
-> HTTP/render/mobile/performance/adversarial QA
-> read-only existing-live PRE-M14 baseline
-> M15 QA
-> explicit LIVE HOLD
```

No main merge and no production deployment occurred during M15 preparation.
