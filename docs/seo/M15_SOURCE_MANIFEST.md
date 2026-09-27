# Octoport SEO — M15 source manifest

Date: 2026-09-27
WORK_ID: `OCTOPORT_SEO_M15_SOURCE_PREDEPLOY_LIVE_QA_2026-09-26_R1`
Status: **EXECUTED SOURCE/PREDEPLOY EVIDENCE / LIVE CANDIDATE NOT DEPLOYED**

## Current authority

SEO branch:
`seo/wordstat-batch-01-2026-09-16`

M15 preparation:
- `docs/seo/M15_STEP_PREPARATION_2026-09-26_R1.md`
- blob `0072a3e71a1315555ca4207a9a93c3d94f5a74d0`

M15 input manifest:
- `docs/seo/M15_QA_INPUT_MANIFEST_2026-09-26_R1.json`
- blob `c4dc04aabe8d02867da08621a326486f2f7437f9`

M15 QA plan:
- `docs/seo/M15_QA_PLAN_2026-09-26_R1.tsv`
- blob `6f59850d4da6455463e2ff4266fee57152befdd1`

Current M14 authority:
- `docs/seo/M14_REWORK_320PX_ACCEPTANCE_2026-09-27_R2.md`
- blob `edf16bc2506c33aca863ac4d2664bad6aa684455`
- current accepted candidate `2ebab969f65c071b5c6aa7f2fd2679e1f3ca8e95`
- tree `565d8af1da92ec39f044717a04786c456fe0c1b2`

## Current-main integration candidate

Fresh current main used for final integration replay:
`7600f3ceb555c32ff798aac48f6c9613e8124ab2`

Final M15 integration branch:
`seo/m15-predeploy-integration-2026-09-27-r2`

Final integration candidate:
`6a0149c958423082a62d5cb84ac757eed2e785a2`

Tree:
`08bbfa4591afaaf04fa31c2938d7adf2d9634857`

Relative to current main:
- commits = 1;
- changed paths = 14;
- current M14 blob parity = 14/14;
- unauthorized path delta = 0.

## Exact-head GitHub Actions

On `6a0149c958423082a62d5cb84ac757eed2e785a2`:

- Site CI run `36294780674` = **SUCCESS**
- Site Deploy CI run `36294780702` = **SUCCESS**

Current M14 exact source candidate itself also passed:
- Site CI run `36290151869` = **SUCCESS**
- Site Deploy CI run `36290151875` = **SUCCESS**

## M14 rework history consumed by M15

M15 found and closed two real mobile blockers before current M14 acceptance:

1. HOME privacy-panel min-content overflow:
   - `M15_PREDEPLOY_DEFECT_320PX_2026-09-26_R1.md`
   - initial observed document overflow = 6 px.

2. seller-analytics H1 long-token overflow:
   - `M15_PREDEPLOY_DEFECT_320PX_ANALYTICS_H1_2026-09-27_R1.md`
   - initial observed document overflow = 19 px.

Current mobile source contract at <=680px:
- `.public-page h1 { overflow-wrap:anywhere; }`
- `.privacy-panel > * { min-width:0; }`
- `.privacy-panel h2 { overflow-wrap:anywhere; }`

No `overflow-x:hidden` masking was accepted.

## Isolated predeploy evidence

Execution environment:
- private mount namespace;
- private network namespace;
- exact candidate static source bind-mounted read-only only inside namespace;
- exact candidate nginx site config;
- namespace loopback only;
- candidate nginx bound 80/443 only inside namespace;
- host production nginx/root/symlink/systemd/DNS not mutated.

Evidence hashes:

- `predeploy-http.log`
  SHA-256 `9f1079fc2842ec111bcc9b77e5c5849613a7c9763327e03b6507065bee406e6d`

- `browser-probes.json`
  SHA-256 `30c67a4f8f7779c6bc578879de79566e5c66efe16457f032630357be15256001`

- `performance-source.log`
  SHA-256 `7116fb22d0e9b1806d1f2354f4a3529ad150e12fa77d82a99d4638555c7567c6`

- `final-source-sha256.txt`
  SHA-256 `11680cfb97f1fa15f04ec5fc72bd8919de660ba326d2603c89d5d9e4fb0787ce`

## Browser evidence

Final DOM/layout probes = 8:

- Chrome desktop HOME;
- Chrome desktop seller-analytics;
- Chrome requested 320px HOME;
- Chrome requested 320px seller-analytics;
- Opera desktop HOME;
- Opera desktop seller-analytics;
- Yandex desktop HOME;
- Yandex desktop seller-analytics.

All eight:
- expected Title/H1/canonical present;
- document `scrollWidth <= clientWidth`;
- no viewport-crossing offender;
- shared stylesheet loaded.

Critical mobile results:

```text
HOME requested 320:
clientWidth = 305
scrollWidth = 305
PASS

seller-analytics requested 320:
clientWidth = 305
scrollWidth = 305
PASS
```

Visual PNGs were captured and reviewed for Chrome; final Opera/Yandex screenshots were captured via Xvfb + CDP navigation.

## Performance evidence boundary

Candidate source:
- executable public JS = 0;
- third-party runtime = 0;
- static CSS = 12,185 bytes;
- favicon = 1,892 bytes;
- HOME HTML = 11,177 bytes;
- seller-analytics HTML = 7,234 bytes.

Browser navigation timings are retained only as predeploy lab diagnostics.

`FIELD_CWV = FIELD_DATA_NOT_AVAILABLE`.

No LCP/INP/CLS field value was fabricated.

## Existing-production baseline

Current production remains pre-M14 release:

`/var/www/octoport-site/releases/9e5f95b0db9ccbae4d2d0704f828748d21945acc`

Evidence:
- `existing-live-baseline.jsonl`
  SHA-256 `4523990958f63ccf40bb2fcef8c1aee3e58c97a64526a10747ddd246f2a895ac`
- `existing-live-release.txt`
  SHA-256 `af97ee7779fdbd0ccbbd31c2461cc21124cbcd262267616fa0c6b430cafd068d`

Fresh read-only recheck on 2026-09-27 still shows:
- HOME old Title/H1;
- `/seller-analytics` = 404;
- `/favicon.png` = 404;
- privacy/support/install = existing pre-M14 200 pages.

Therefore no hidden M14 production deployment occurred.

## External method sources

Fresh M15 method refresh used official Google, Yandex and web.dev sources frozen in M15 preparation. No method drift requiring a new M13 technical architecture was found.

## Claim boundary

This manifest proves current source, isolated predeploy and existing-production-baseline evidence.

It does **not** claim:
- M14 was merged to main;
- M14 was deployed to production;
- seller-analytics was live-tested after deployment;
- seller-analytics is indexed/ranking;
- analytics real sanitized proof is closed;
- field CWV exists.
