# Octoport SEO — M15 source / predeploy / live QA — Main Chat QA

Date: 2026-09-27
WORK_ID: `OCTOPORT_SEO_M15_SOURCE_PREDEPLOY_LIVE_QA_2026-09-26_R1`
Status: **PASS_SOURCE_PREDEPLOY_WITH_EXPLICIT_LIVE_HOLD / NOT FINAL LIVE PASS**

## 1. Current authority

Current M14 source authority:
- accepted responsive rework R2;
- candidate `2ebab969f65c071b5c6aa7f2fd2679e1f3ca8e95`;
- tree `565d8af1da92ec39f044717a04786c456fe0c1b2`;
- exact-head Site CI `36290151869` = SUCCESS;
- exact-head Site Deploy CI `36290151875` = SUCCESS.

M15 preparation:
- `M15_STEP_PREPARATION_2026-09-26_R1.md`
- blob `0072a3e71a1315555ca4207a9a93c3d94f5a74d0`.

M15 input manifest:
- blob `c4dc04aabe8d02867da08621a326486f2f7437f9`.

M15 QA plan:
- 35 rows;
- blob `6f59850d4da6455463e2ff4266fee57152befdd1`.

## 2. Final current-main integration state

Fresh current main at final replay:
`7600f3ceb555c32ff798aac48f6c9613e8124ab2`.

Final M15 integration branch:
`seo/m15-predeploy-integration-2026-09-27-r2`.

Candidate:
`6a0149c958423082a62d5cb84ac757eed2e785a2`.

Tree:
`08bbfa4591afaaf04fa31c2938d7adf2d9634857`.

Result:

```text
COMMITS_FROM_CURRENT_MAIN = 1
CHANGED_PATHS = 14
EXPECTED_PATHS = 14
UNAUTHORIZED_PATHS = 0
CURRENT_M14_BLOB_PARITY = 14/14
```

Exact-head GitHub Actions:
- Site CI run `36294780674` = SUCCESS;
- Site Deploy CI run `36294780702` = SUCCESS.

The one main commit that arrived after the first M15 candidate changed WB token-policy/readiness documentation only.
No site/nginx/deploy/verifier/CI/site-regression file changed.
Current public copy remains compatible.

`AUTHORITY_DRIFT_STATUS = NON_OVERLAPPING_PRODUCT_DOC_DRIFT_RECONCILED`.

## 3. M14 defect loop completed inside M15

M15 did not accept the first green source candidate blindly.

It found two real browser blockers:

1. HOME privacy-panel at 320px:
   - initial clientWidth 305;
   - initial scrollWidth 311;
   - 6 px document overflow.

2. seller-analytics H1 at 320px:
   - initial clientWidth 305;
   - initial scrollWidth 324;
   - 19 px document overflow.

Both were returned to bounded M14 rework under durable preparation.

Accepted current mobile contract at <=680px:

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

No overflow masking was used.

Final result:

```text
M14_320PX_DEFECTS_OPEN = 0
```

## 4. Execution artifact readback

Remote artifacts:

- `M15_SOURCE_MANIFEST.md`
  blob `97f10ace874c89fe4415b334aa9cd68c3a8d7f4c`
- `M15_INTEGRATION_RECONCILIATION.md`
  blob `61457239d1bbb949800ca61236885cc0c9547705`
- `M15_SOURCE_QA.tsv`
  blob `b374262d83f6e7b98584e27a9c004066af6e4acb`
- `M15_PREDEPLOY_HTTP_QA.tsv`
  blob `bddb905059458b8e655e3d4b3b7ae34ee3063fc2`
- `M15_RENDER_MOBILE_QA.tsv`
  blob `702e647953dfb7496e1e477ecf32d4bc70d58006`
- `M15_PERFORMANCE_QA.tsv`
  blob `d89dc79d8a1b024ada3cad2fb12b490b6f1c7097`
- `M15_ADVERSARIAL_QA.tsv`
  blob `18b7bd3aa807991b55f63590518b307eb4eee1bc`
- `M15_EXISTING_LIVE_BASELINE.tsv`
  blob `2352cf26d566ff5eeda9fcbbdb74d112c1549c29`.

## 5. Independent source QA

Source QA:
- rows = 20;
- failures = 0.

Confirmed:
- HOME exact accepted Title/H1/description/self-canonical;
- accepted brand subheadline retained;
- seller-analytics exact Title/H1/description/self-canonical;
- privacy/support indexable utilities;
- install `noindex, follow`;
- exact four-URL sitemap;
- robots compatible;
- exact WebSite JSON-LD;
- executable public JS = 0;
- favicon 120x120 approved-product-mark lineage;
- crawlable HOME↔analytics links;
- known alias source contract;
- no fake/unsupported claims;
- current responsive guards present;
- exact-head current-main CI PASS.

## 6. Isolated HTTP predeploy QA

Candidate nginx was run inside a private mount+network namespace.

Host production nginx/root/current symlink/systemd/DNS were not mutated.

HTTP QA:
- rows = 28;
- failures = 0.

Results:

```text
canonical/page/assets 200 = 9/9 PASS
HTTP apex normalization = PASS
HTTP www one-hop normalization = PASS
HTTPS www normalization = PASS
known alias redirects = 9/9 PASS
query preservation = PASS
unknown URL = real 404 / no Location
security headers = PASS
cache/content types = PASS
privacy/support indexability = PASS
install noindex = PASS
sitemap exact set = PASS
namespace isolation = PASS
```

Evidence:
`predeploy-http.log`
SHA-256 `9f1079fc2842ec111bcc9b77e5c5849613a7c9763327e03b6507065bee406e6d`.

## 7. Render/mobile QA

Render/mobile QA:
- rows = 12;
- failures = 0.

Final DOM/layout probes = 8.

```text
Chrome desktop HOME = PASS
Chrome desktop analytics = PASS
Chrome 320 HOME = PASS
Chrome 320 analytics = PASS
Opera desktop HOME = PASS
Opera desktop analytics = PASS
Yandex desktop HOME = PASS
Yandex desktop analytics = PASS
```

Critical mobile closure:

```text
HOME:
requested width = 320
clientWidth = 305
scrollWidth = 305
viewport offenders = 0

seller-analytics:
requested width = 320
clientWidth = 305
scrollWidth = 305
viewport offenders = 0
```

Evidence:
`browser-probes.json`
SHA-256 `30c67a4f8f7779c6bc578879de79566e5c66efe16457f032630357be15256001`.

Visual screenshots:
- Chrome desktop/mobile;
- Opera Xvfb HOME/analytics;
- Yandex Xvfb HOME/analytics;
were captured and reviewed.

## 8. Performance QA

Performance QA:
- rows = 18;
- failures = 0.

Candidate source:

```text
HOME HTML = 11177 bytes
analytics HTML = 7234 bytes
privacy HTML = 6850 bytes
support HTML = 4805 bytes
install HTML = 2808 bytes
styles.css = 12185 bytes
favicon.png = 1892 bytes

EXECUTABLE_PUBLIC_JS = 0
THIRD_PARTY_RUNTIME = 0
```

Browser navigation numbers are lab/predeploy diagnostics only.

```text
HOME_FIELD_CWV = FIELD_DATA_NOT_AVAILABLE
ANALYTICS_FIELD_CWV = FIELD_DATA_NOT_AVAILABLE
FIELD_CWV_FABRICATION = 0
```

Evidence:
`performance-source.log`
SHA-256 `7116fb22d0e9b1806d1f2354f4a3529ad150e12fa77d82a99d4638555c7567c6`.

## 9. Adversarial QA

Adversarial QA:
- scenarios = 20;
- source/predeploy failures = 0.

Explicitly checked:
- unknown soft redirect;
- duplicate alias 200 behavior;
- two-hop www;
- accidental privacy/support noindex;
- accidental install indexability;
- JSON-LD/executable-JS confusion;
- fake SoftwareApplication/review/rating/pricing;
- fake analytics screenshot/case/ROI;
- unsupported external intelligence/accounting/write-back;
- overflow masking;
- both 320px defects;
- favicon failure;
- orphan analytics;
- stale-current-main integration;
- hidden production deploy;
- fake field CWV;
- unauthorized main merge;
- silent proof-gate waiver;
- WB token-policy drift.

## 10. Existing-production baseline

Current production is still intentionally the old pre-M14 release:

`/var/www/octoport-site/releases/9e5f95b0db9ccbae4d2d0704f828748d21945acc`.

Read-only baseline confirms:
- old HOME Title/H1;
- `/seller-analytics` = 404;
- `/favicon.png` = 404;
- existing privacy/support/install = 200;
- old .html duplicate behavior remains;
- unknown URL = real 404;
- portal routes remain 200 with X-Robots noindex;
- API health live/ready = 200;
- anonymous portal→API account route remains 401.

This is correctly labeled:
`EXISTING_LIVE_BASELINE / PRE-M14 DEPLOYMENT`.

It is **not** candidate live QA.

Evidence:
`existing-live-baseline.jsonl`
SHA-256 `4523990958f63ccf40bb2fcef8c1aee3e58c97a64526a10747ddd246f2a895ac`.

## 11. M15 QA-plan accounting

Original plan rows = 35.

Current outcomes:

```text
Q001-Q032 = PASS
Q033 analytics production proof = HOLD_EXTERNAL
Q034 main-integration governance = HOLD_GOVERNANCE
Q035 final predeploy verdict = PASS_SOURCE_PREDEPLOY_WITH_EXPLICIT_LIVE_HOLD
```

The original M15 plan named the pre-rework 13-path M14 candidate.
That authority was legitimately superseded during M15 by accepted M14 responsive R2.

Current final integration is therefore:
- current M14 = 14 paths;
- current-main replay = 14/14 blob parity;
- this is not an unauthorized scope expansion.

## 12. Remaining holds

### HOLD 1 — real analytics proof

M12 remains binding:

`ANALYTICS_PROOF_DEMO = PROOF_REQUIRED_BEFORE_PRODUCTION`.

Current:

```text
REAL_SANITIZED_DEMO_GATE = OPEN
FAKE_ANALYTICS_PROOF = 0
```

No real sanitized/source-backed seller-analytics demonstration suitable for production launch has been accepted.

Therefore:

```text
PRODUCTION_DEPLOYMENT_ALLOWED = false
CANDIDATE_LIVE_QA_ALLOWED = false
M16_ALLOWED = false
```

### HOLD 2 — main integration governance

Current repo authority remains internally inconsistent:
- AGENTS: only C integrates main;
- C OWNERSHIP denies `apps/site/**`;
- coordination README: SEO/apps/site outside A/B/C.

M15 does not guess or override this.

```text
MAIN_INTEGRATION_GOVERNANCE =
HOLD_REQUIRES_EXPLICIT_RECONCILIATION
```

## 13. Hard-gate result

```text
CURRENT_M14_SOURCE = PASS
CURRENT_MAIN_INTEGRATION = PASS
CURRENT_M14_BLOB_PARITY = 14/14

SOURCE_QA = PASS
EXACT_HEAD_SITE_CI = PASS
EXACT_HEAD_SITE_DEPLOY_CI = PASS
ISOLATED_PREDEPLOY_HTTP = PASS
BROWSER_RENDER_QA = PASS
MOBILE_320_QA = PASS
PERFORMANCE_MATERIAL_DEFECT_QA = PASS
ADVERSARIAL_QA = PASS
EXISTING_LIVE_BASELINE = PASS

OPEN_SOURCE_PREDEPLOY_CRITICAL_DEFECTS = 0
M14_320PX_DEFECTS_OPEN = 0

REAL_SANITIZED_DEMO_GATE = OPEN
MAIN_INTEGRATION_GOVERNANCE = HOLD

M15_PREDEPLOY_STATE =
PASS_SOURCE_PREDEPLOY_WITH_EXPLICIT_LIVE_HOLD

M15_FINAL_LIVE_ACCEPTED = false
M16_ALLOWED = false
```

## 14. Quality score

For the completed source/predeploy portion:

1. authority/current-main integrity = 10/10
2. source/spec parity = 10/10
3. HTTP/canonical/indexability QA = 10/10
4. browser/render/mobile QA = 10/10
5. performance truthfulness = 10/10
6. adversarial/fake-claim QA = 10/10
7. defect discovery/rework loop = 10/10
8. persistence/reproducibility = 10/10
9. production/live completeness = 6/10
10. downstream readiness = 7/10

`QUALITY_TOTAL = 93/100`
`QUALITY_SCORE = 9.3/10`

The deduction is not for a known source/predeploy defect. It reflects that M15's full purpose includes deployed-candidate live QA, which is intentionally blocked and therefore not yet complete.

## 15. Final verdict

```text
M15_SOURCE_PREDEPLOY_ACCEPTED = true
M15_FINAL_LIVE_ACCEPTED = false
M15_STATE = PASS_SOURCE_PREDEPLOY_WITH_EXPLICIT_LIVE_HOLD

MAIN_MERGE_PERFORMED = false
PRODUCTION_DEPLOYMENT_PERFORMED = false
WEBMASTER_MUTATION = 0
SEARCH_CONSOLE_MUTATION = 0
PROVIDER_CALLS = 0

M16 = BLOCKED
```

## 16. Reopen condition

M15 live phase may reopen only when:
1. real sanitized/source-backed analytics proof is accepted;
2. main-integration governance is explicitly reconciled;
3. fresh main is re-read;
4. current M14 blobs are replayed/revalidated against that main;
5. predeploy source/browser gates are rechecked if source/environment changed;
6. exact candidate is merged/deployed through the authorized path;
7. deployed-candidate HTTP + browser live QA passes.

Only then may M15 become final live PASS and release M16.
