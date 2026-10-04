# A04 CAP-18 advertising guidance/readiness — 2026-10-04

## Scope

This result closes only the Ozon CAP-18 guidance gap on the current advertising-statistics read surface. It does not promote CAP-18 to a clean PASS and does not add or execute provider requests.

The imported Ozon v0.1.22 tree remains immutable. Runtime changes are composed through apps/extension/application-patches.json.

## Current operation boundary

The historical CAP-18 coverage source names performance_daily plus performance_campaign_product. The current final registry intentionally removes those JSON aliases and exposes their current direct CSV successors:

- performance_daily_csv;
- performance_campaign_product_csv.

CAP-18 is explicitly composite. Guidance therefore records the accepted required dimensions campaign / product / day as a composite requirement. It labels one direct source as the day-grain role and the other as the campaign/product-grain role, and instructs consumers not to infer dimensions missing from either single source.

This is guidance metadata only; it does not claim a new provider response schema.

## Data readiness boundary

Current direct CSV statistics are labelled DIRECT_RESPONSE.

Current asynchronous Performance report-start cards are labelled ASYNC_REPORT_START and explicitly expose:

- completion is not immediate;
- automatic polling is false;
- the existing explicit status operation must be used.

The status card is an explicit REPORT_STATUS_CHECK that may remain pending. The download card requires a prepared report.

No number of seconds/minutes, retry interval, hidden polling or readiness SLA is invented.

## Preserved behavior

- no Ozon entitlement-rule change;
- no provider/preflight/transport change;
- no command-template change;
- no privacy change;
- no provider/network/auth/live/store request;
- removed historical JSON aliases stay removed in the final registry.

CAP-18 remains a QUALIFIED_PASS, now with explicit data-readiness guidance. CAP-16 and CAP-21 remain separate guidance-gap rows.
