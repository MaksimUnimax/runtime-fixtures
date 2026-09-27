# Octoport SEO — M15 progress

Date: 2026-09-27
Status: **PASS_FINAL_LIVE / M15 FINAL ACCEPTED / M16 PREPARATION RELEASED**
SEO branch: `seo/wordstat-batch-01-2026-09-16`

## Cursor

```text
M0..M12 = ACCEPTED
M13 R2 = ACCEPTED / CURRENT
M14 responsive rework R2 = ACCEPTED / CURRENT
M15 source/predeploy = ACCEPTED
M15 analytics proof = ACCEPTED
M15 main integration = COMPLETE
M15 production deployment = COMPLETE
M15 final live QA = ACCEPTED
M16 = PREPARATION ALLOWED
M17+ = BLOCKED
```

## Binding M15 final authority

Final live acceptance:
- `docs/seo/M15_FINAL_LIVE_ACCEPTANCE_2026-09-27_R1.md`

Analytics proof closure:
- `docs/seo/M15_ANALYTICS_REAL_PRODUCT_PROOF_CLOSURE_2026-09-27_R1.md`
- blob `6bd4b7554e3499025e3275280712201f20b9c0cd`

Current deployed main/release:
- `6a0149c958423082a62d5cb84ac757eed2e785a2`

## Final production state

```text
CURRENT_MAIN =
6a0149c958423082a62d5cb84ac757eed2e785a2

CURRENT_SITE_RELEASE =
/var/www/octoport-site/releases/6a0149c958423082a62d5cb84ac757eed2e785a2

APPLICATION_INGRESS_UNCHANGED = true
OPEN_CRITICAL_LIVE_DEFECTS = 0
```

## Final M15 results

```text
SOURCE_PREDEPLOY_QA = PASS
ANALYTICS_REAL_PRODUCT_PROOF = PASS
MAIN_INTEGRATION = PASS
PRODUCTION_DEPLOYMENT = PASS
REPOSITORY_VERIFIER = PASS

LIVE_HTTP_CASES = 27
LIVE_HTTP_FAILURES = 0

LIVE_BROWSER_CASES = 8
LIVE_BROWSER_FAILURES = 0

Chrome desktop HOME = PASS
Chrome desktop seller-analytics = PASS
Chrome 320 HOME = PASS
Chrome 320 seller-analytics = PASS
Opera desktop HOME = PASS
Opera desktop seller-analytics = PASS
Yandex desktop HOME = PASS
Yandex desktop seller-analytics = PASS

HOME_MOBILE_CLIENT_SCROLL = 305/305
ANALYTICS_MOBILE_CLIENT_SCROLL = 305/305

FIELD_CWV = FIELD_DATA_NOT_AVAILABLE
FIELD_CWV_FABRICATION = 0

M15_STATE = PASS_FINAL_LIVE
M15_FINAL_LIVE_ACCEPTED = true
```

## Analytics proof

The existing historical Ozon live gate requested by the owner was found and used.

Private historical authority includes:
- Standard = 20/20;
- capability = 24/24;
- terminal primary gate = 44/44;
- pending = 0;
- frozen = 0.

Public proof remains sanitized and does not reproduce private seller values, credentials, request IDs, campaign IDs, SKU/product IDs or buyer data.

```text
REAL_SANITIZED_DEMO_GATE = CLOSED
FAKE_ANALYTICS_PROOF = 0
```

## Production evidence

Local evidence directory:

`/root/octoport-control/logs/SEO/M15_CODEX_LIVE_20260927_R2/`

Key evidence:
- `deploy.log`
- `verifier.log`
- `http-live.tsv`
- `browser-live.json`
- `screenshots/`
- `final-receipt.md`

Evidence hashes are recorded in final acceptance.

## Next physical action

```text
M16 STEP PREPARATION
-> read live LEVEL 1 + M13-M18 LEVEL 2
-> fresh main/live state
-> indexing-launch contract
-> Yandex/Google discovery/indexability verification plan
-> post-launch robots/sitemap/canonical checks
-> measurement authority
-> durable GitHub preparation + remote readback
-> only then M16 execution
```

M16 is not auto-accepted merely because M15 passed.
