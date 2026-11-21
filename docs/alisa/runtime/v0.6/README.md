# Alice Marketplace Runtime v0.6 — read-only live canary

Status: deployed as private lab canary, **not production verified**. The existing OAuth lab serves the Yandex Dialogs skill. The marketplace runtime uses a separate non-root systemd service with Unix-socket authentication, durable SQLite queue, a single semantic plan, exact-only full-result cache, bounded HTTP 429 retries, strict Ozon/WB decoders, and one restricted DeepSeek JSON classification step for non-template Russian queries. Ozon and WB credentials and DeepSeek key are delivered by systemd LoadCredential, never placed in public source.

Live read-only server checks on 2026-11-03: Ozon orders/month READY; WB sales-funnel/month READY; a combined two-platform job READY with exactly two provider calls; DeepSeek Flash classified a non-template two-platform request in ~1.07 s, and the resolved canonical plan joined the identical completed report without provider recomputation. Actual dollar/revenue values are not included in this public package. HTTP 429 was encountered once and observed; the bounded-retry queue behavior is tested locally, not independently proven for a subsequent live 429. Credentials are not included.

Public HTTPS /healthz reports `alice-lab-20261103-market-live-r3`, mode `read-only-marketplace-canary-queue`. Anonymous account linking and wrong skill ID checks passed. **A genuine user readback through the Yandex Dialogs developer console on this new build remains a separate acceptance gate**. A programmatic public HTTPS test using an injected ephemeral access token was blocked before execution and not retried through other tooling. OAuth configuration was left intact.

Supported first scope: `ordered_units` and `ordered_revenue` for one or both platforms, full periods, marketplace-separated results and matching-currency totals, while respecting pagination. Unsupported (explicit rejection): ad spend, DRR, buyouts, returns, profit, inventory, SKU/brand/warehouse filters, currency conversion, account modifications. Ozon monetary currency remains unconfirmed; the voice response deliberately labels it as cabinet currency rather than RUB. WB returned RUB. Figures have not been reconciled to seller consoles.

Operator acceptance: open the existing private Yandex Dialogs skill `Октопорт маркет` → `Тестирование`, send `диагностика аналитики`, then `сводка заказов за октябрь 2026 на озоне и вайлдберриз`, then `результат` in the same or a new session. Do not paste raw `Request.session.user.access_token` or bearer token; share only visible `Response` if troubleshooting. Check exact cache with identical phrase, and verify unsupported filters are rejected.

Reproducible offline checks:

```
PYTHONDONTWRITEBYTECODE=1 python -W error::ResourceWarning run_checks.py
```

267 tests in this version, including 150 distinct Russian phrases. Zero real provider calls in the offline tests. These are not accuracy statistics for DeepSeek.

This package is runtime modules + tests, not the complete OAuth lab, the private systemd configuration, secrets, or user financial responses. Exact-only cache applies: full READY authorized nonexpired identical canonical plan only, no overlap/period stitching or combining old cached reports. UNKNOWN must never be retried automatically.
