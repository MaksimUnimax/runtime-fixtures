# Octoport SEO — M15 integration reconciliation

Date: 2026-09-27
Status: **PASS / CURRENT-MAIN INTEGRATION RECONCILED / NO MAIN MERGE**

## 1. Initial M15 main

Initial M15 preparation observed:
`a7097321410921f2fffa54fc3ecf1bc17963c0c2`.

The first M15 integration candidate:
`50e344dcb9ddb93b177624168449e6642307ac3b`
replayed the then-current accepted M14 13-file candidate and exposed two mobile defects during browser QA.

Those defects caused bounded M14 R2 rework and supersession.

## 2. Current M14 authority after rework

Current accepted M14 source:
`2ebab969f65c071b5c6aa7f2fd2679e1f3ca8e95`.

Relative to initial fresh main `a7097321...`, current M14 changes exactly 14 expected source/guard paths:
the original 13 M14 paths plus responsive `apps/site/public/styles.css`.

No server/API/portal/extension behavior was changed by M14 responsive rework.

## 3. Concurrent main advance

During M15 execution main advanced from:
`a7097321410921f2fffa54fc3ecf1bc17963c0c2`

to:
`7600f3ceb555c32ff798aac48f6c9613e8124ab2`.

The single intervening main commit changed only WB token-policy/readiness documentation:
- C06 WB token-policy receipt;
- readiness MINIMUM_SPEC/GAPS/OWNER_SETUP/SOURCES.

It did not change any site/nginx/deploy/verifier/CI/site-regression path.

Product impact review:
- direct-local beta remains WB Personal-token-only;
- Service/Base/OAuth and relay policy remain separate;
- current M14 site copy does not claim those credential modes;
- no public site copy or SEO page ownership change is required.

Verdict:
`NON_OVERLAPPING_PRODUCT_DOC_DRIFT_RECONCILED`.

## 4. Final current-main integration replay

Final integration base:
`7600f3ceb555c32ff798aac48f6c9613e8124ab2`.

Branch:
`seo/m15-predeploy-integration-2026-09-27-r2`.

Candidate:
`6a0149c958423082a62d5cb84ac757eed2e785a2`.

Tree:
`08bbfa4591afaaf04fa31c2938d7adf2d9634857`.

The replay writes exactly the 14 current M14 source/guard blobs onto current main.

Result:

```text
COMMITS_FROM_CURRENT_MAIN = 1
CHANGED_PATHS = 14
EXPECTED_PATHS = 14
UNAUTHORIZED_PATHS = 0
CURRENT_M14_BLOB_PARITY = 14/14
```

## 5. Exact-head CI

On final current-main candidate `6a0149c9...`:

- Site CI run `36294780674` = SUCCESS
- Site Deploy CI run `36294780702` = SUCCESS

This proves the accepted current M14 bytes remain source/CI-compatible with the current main.

## 6. Browser/predeploy evidence portability

The isolated HTTP/browser evidence was captured on exact current M14 source `2ebab969...`.

Final current-main integration candidate `6a0149c9...` has exact M14 source blob parity 14/14.

The intervening current-main-only files do not affect the isolated public-site source/nginx runtime.

Therefore the isolated source/render/HTTP evidence is valid for the final integration candidate at the tested site boundary.

This does not convert it into production/live evidence.

## 7. Main merge governance

Current repo rules remain internally inconsistent for the site merge:
- AGENTS says only C integrates main;
- current C OWNERSHIP denies `apps/site/**`;
- coordination README says SEO/apps/site are outside A/B/C.

M15 therefore does not merge the candidate.

```text
MAIN_INTEGRATION_GOVERNANCE = HOLD_REQUIRES_EXPLICIT_RECONCILIATION
MAIN_MERGE_PERFORMED = false
```

This governance HOLD does not invalidate source/predeploy QA.

## 8. Production proof hold

M12 still requires a real sanitized/source-backed analytics example before production.

```text
REAL_SANITIZED_DEMO_GATE = OPEN
PRODUCTION_DEPLOYMENT = HOLD
CANDIDATE_LIVE_QA = HOLD
M16 = BLOCKED
```
