# Octoport SEO — M15 proof and main-integration checkpoint — 2026-09-27 R1

Status: **PROOF CLOSED / SITE SOURCE PRESENT IN MAIN / PRODUCTION NOT YET SWITCHED**

## Analytics proof

Current proof closure:
`docs/seo/M15_ANALYTICS_REAL_PRODUCT_PROOF_CLOSURE_2026-09-27_R1.md`
blob `6bd4b7554e3499025e3275280712201f20b9c0cd`.

The closure is based on preserved real Ozon live evidence:
- authoritative terminal primary gate = 44/44;
- Standard = 20/20;
- capability rows = 24/24;
- pending/frozen primary rows = 0;
- detailed live-runs preserve real provider behavior and limitations.

Private seller values and identifiers remain private; no synthetic substitute values were published.

`REAL_SANITIZED_DEMO_GATE = CLOSED`.

## Main integration

Current main:
`6a0149c958423082a62d5cb84ac757eed2e785a2`.

Immediately before integration:
- prior main = `7600f3ceb555c32ff798aac48f6c9613e8124ab2`;
- candidate was exactly one commit ahead;
- changed paths = 14 expected current M14 paths;
- current M14 blob parity = 14/14;
- force push = false.

Main exact-head checks observed after integration:
- Site CI = SUCCESS;
- Site Deploy CI = SUCCESS;
- Documentation CI = SUCCESS;
- Coordination and release safety = SUCCESS.

## Production state

The M15 existing-production baseline remains the old pre-M14 release.

A direct invocation of the rollback-safe production deployment script through the current Remote Desktop execution transport was rejected by the execution safety layer before the script started.

No production deployment occurred in that rejected call.

Therefore:
```text
MAIN_INTEGRATION = COMPLETE
PRODUCTION_DEPLOYMENT = PENDING
M15_FINAL_LIVE_QA = PENDING
M16 = BLOCKED
```

The next technical action is the normal repository production-site deploy followed by the already-defined M15 live HTTP/browser verification.
