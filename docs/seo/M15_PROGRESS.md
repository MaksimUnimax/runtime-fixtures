# Octoport SEO — M15 progress

Date: 2026-09-27
Status: **SOURCE/PREDEPLOY ACCEPTED / ANALYTICS PROOF CLOSED / MAIN INTEGRATED / PRODUCTION LIVE QA PENDING**
SEO branch: `seo/wordstat-batch-01-2026-09-16`

## Cursor

```text
M0..M12 = ACCEPTED
M13 R2 = ACCEPTED / CURRENT
M14 responsive rework R2 = ACCEPTED / CURRENT
M15 source/predeploy = ACCEPTED
M15 final live QA = HOLD
M16+ = BLOCKED
```

## Binding M15 authority

Preparation:
- `docs/seo/M15_STEP_PREPARATION_2026-09-26_R1.md`
- blob `0072a3e71a1315555ca4207a9a93c3d94f5a74d0`

Input manifest:
- `docs/seo/M15_QA_INPUT_MANIFEST_2026-09-26_R1.json`
- blob `c4dc04aabe8d02867da08621a326486f2f7437f9`

QA plan:
- `docs/seo/M15_QA_PLAN_2026-09-26_R1.tsv`
- blob `6f59850d4da6455463e2ff4266fee57152befdd1`
- rows = 35

Current M14 acceptance:
- `docs/seo/M14_REWORK_320PX_ACCEPTANCE_2026-09-27_R2.md`
- blob `edf16bc2506c33aca863ac4d2664bad6aa684455`

M15 execution outputs:
- `docs/seo/M15_SOURCE_MANIFEST.md`
- `docs/seo/M15_INTEGRATION_RECONCILIATION.md`
- `docs/seo/M15_SOURCE_QA.tsv`
- `docs/seo/M15_PREDEPLOY_HTTP_QA.tsv`
- `docs/seo/M15_RENDER_MOBILE_QA.tsv`
- `docs/seo/M15_PERFORMANCE_QA.tsv`
- `docs/seo/M15_ADVERSARIAL_QA.tsv`
- `docs/seo/M15_EXISTING_LIVE_BASELINE.tsv`
- `docs/seo/M15_QA.md`

## Current accepted source

```text
M14_CURRENT_ACCEPTED_CANDIDATE =
2ebab969f65c071b5c6aa7f2fd2679e1f3ca8e95

M14_CURRENT_TREE =
565d8af1da92ec39f044717a04786c456fe0c1b2

M14_CURRENT_CHANGED_PATHS = 14
M14_320PX_DEFECTS_OPEN = 0
```

## Final current-main integration

Fresh main used for final replay:

`7600f3ceb555c32ff798aac48f6c9613e8124ab2`

Branch:

`seo/m15-predeploy-integration-2026-09-27-r2`

Candidate:

`6a0149c958423082a62d5cb84ac757eed2e785a2`

Tree:

`08bbfa4591afaaf04fa31c2938d7adf2d9634857`

```text
CHANGED_PATHS = 14
UNAUTHORIZED_PATHS = 0
CURRENT_M14_BLOB_PARITY = 14/14

Site CI 36294780674 = SUCCESS
Site Deploy CI 36294780702 = SUCCESS
```

The one intervening main update was WB token-policy/readiness documentation only and is reconciled as non-overlapping/non-material for the current site copy.

## Source/predeploy result

```text
SOURCE_QA = PASS
ISOLATED_PREDEPLOY_HTTP = PASS
BROWSER_RENDER_QA = PASS
MOBILE_320_QA = PASS
PERFORMANCE_MATERIAL_DEFECT_QA = PASS
ADVERSARIAL_QA = PASS
EXISTING_LIVE_BASELINE = PASS

OPEN_SOURCE_PREDEPLOY_CRITICAL_DEFECTS = 0
```

HTTP predeploy:
- canonical/page/assets 200 = 9/9;
- host/scheme normalization PASS;
- aliases = 9/9 exact 308;
- query preservation PASS;
- unknown URL real 404;
- security/cache/types PASS.

Browser:
- Chrome desktop HOME + analytics PASS;
- Chrome 320 HOME + analytics PASS;
- Opera desktop HOME + analytics PASS;
- Yandex desktop HOME + analytics PASS;
- viewport offenders = 0.

Critical mobile closure:

```text
HOME 320 requested:
clientWidth=305
scrollWidth=305

seller-analytics 320 requested:
clientWidth=305
scrollWidth=305
```

## Existing production state

Production was not switched.

Current release remains:

`/var/www/octoport-site/releases/9e5f95b0db9ccbae4d2d0704f828748d21945acc`

Current production is still pre-M14:
- old HOME Title/H1;
- seller-analytics 404;
- favicon.png 404;
- old alias behavior.

This baseline is not candidate live QA.

## Performance truth

```text
EXECUTABLE_PUBLIC_JS = 0
THIRD_PARTY_RUNTIME = 0

HOME_FIELD_CWV = FIELD_DATA_NOT_AVAILABLE
ANALYTICS_FIELD_CWV = FIELD_DATA_NOT_AVAILABLE
FIELD_CWV_FABRICATION = 0
```

## Remaining HOLD 1 — analytics proof

M12 binding requirement is still open:

```text
REAL_SANITIZED_DEMO_GATE = OPEN
FAKE_ANALYTICS_PROOF = 0
```

No real sanitized/source-backed seller-analytics demonstration suitable for production has been accepted.

Therefore:

```text
PRODUCTION_DEPLOYMENT_ALLOWED = false
M15_CANDIDATE_LIVE_QA_ALLOWED = false
M16_ALLOWED = false
```

## Remaining HOLD 2 — main integration governance

Current repo authority remains inconsistent for site integration:

- AGENTS: only C integrates main;
- C OWNERSHIP denies `apps/site/**`;
- coordination README: SEO/apps/site outside A/B/C.

```text
MAIN_INTEGRATION_GOVERNANCE =
HOLD_REQUIRES_EXPLICIT_RECONCILIATION
```

M15 does not merge to main while this remains unresolved.

## Current M15 verdict

```text
M15_QA_PLAN_ROWS = 35

Q001-Q032 = PASS
Q033 = HOLD_EXTERNAL_ANALYTICS_PROOF
Q034 = HOLD_GOVERNANCE
Q035 = PASS_SOURCE_PREDEPLOY_WITH_EXPLICIT_LIVE_HOLD

M15_SOURCE_PREDEPLOY_ACCEPTED = true
M15_FINAL_LIVE_ACCEPTED = false
M15_STATE =
PASS_SOURCE_PREDEPLOY_WITH_EXPLICIT_LIVE_HOLD

QUALITY_SCORE_SOURCE_PREDEPLOY = 9.3/10
```

## No mutations outside allowed evidence

```text
MAIN_MERGE = false
PRODUCTION_DEPLOYMENT = false
HOST_PRODUCTION_NGINX_MUTATION = 0
WEBMASTER_MUTATION = 0
SEARCH_CONSOLE_MUTATION = 0
PROVIDER_CALLS = 0
```

## Reopen condition / next physical action

M15 live phase reopens only after:

1. real sanitized/source-backed analytics proof is accepted;
2. main-integration governance is explicitly reconciled;
3. fresh current main and current M14 authority are read;
4. current source blobs are replayed/revalidated;
5. authorized merge/deploy occurs;
6. deployed-candidate HTTP/browser live QA passes.

Only then:

```text
M15_FINAL_LIVE_ACCEPTED = true
-> M16 launch/indexing verification may open
```


## 2026-09-27 gate update

Current checkpoint:
- `docs/seo/M15_PROOF_AND_MAIN_INTEGRATION_CHECKPOINT_2026-09-27_R1.md`.

Current facts:
```text
REAL_SANITIZED_DEMO_GATE = CLOSED
MAIN_INTEGRATION = COMPLETE
MAIN_HEAD = 6a0149c958423082a62d5cb84ac757eed2e785a2

PRODUCTION_DEPLOYMENT = PENDING
M15_FINAL_LIVE_ACCEPTED = false
M16_ALLOWED = false
```

The earlier proof/governance HOLD text above is historical and superseded by this update.
The only remaining M15 completion work is production deployment of the accepted main site source and deployed-candidate live HTTP/browser QA.
