# A04 — WB operational orders/sales field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / FINAL REVENUE SEMANTIC OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent candidate before this slice: `10ada8554f2238da0317eff2f4567baa647d58d1`.
Observed `origin/main`: `7600f3ceb555c32ff798aac48f6c9613e8124ab2`.

## Scope

The accepted 45/45 operation mapping is unchanged.
This slice adds field/grain/unit and completeness boundaries for:
- `STD-01` — yesterday orders/sales totals;
- `STD-02` — daily trend and best/worst days;
- `STD-04` — yesterday versus day before yesterday.

No live WB request, marketplace credential, owner session, AI request, deployment, shared readiness TSV mutation, or financial claim was performed.
## Current official WB source boundaries

Checked on 2026-09-27:
- https://dev.wildberries.ru/en/openapi/reports
- https://dev.wildberries.ru/en/openapi/analytics
- https://dev.wildberries.ru/en/openapi/financial-reports-and-accounting
- https://dev.wildberries.ru/en/release-notes

`GET /api/v1/supplier/orders` is operational order data:
- updated every 30 minutes;
- one row is one order/item;
- `srid` is the order identifier;
- storage is guaranteed for no more than 90 days;
- the report is preliminary and intended for operational monitoring;
- `flag=0` can require continuation from the exact final `lastChangeDate`;
- `flag=1` returns rows whose order date equals `dateFrom`.

The current registry already pins this route as `statistics_orders`.
`GET /api/v1/supplier/sales` is likewise preliminary operational sale/return data:
- updated every 30 minutes;
- one row is one sale/return item;
- `saleID` identifies the sale/return and `srid` links to the order;
- `priceWithDisc` and `forPay` use simplified logic;
- `finishedPrice`, `priceWithDisc`, and `forPay` can temporarily be zero and are filled asynchronously within 24 hours;
- WB directs accurate financial calculations, reconciliation, and reporting to realization-report details.

Therefore no `/sales` price field is promoted here to authoritative revenue.

Current finance reference:
`finance_sales_detail_period -> POST /api/finance/v1/sales-reports/detailed`.
The April 2026 WB change introduced this current finance route and scheduled the prior GET v5 realization-detail route for shutdown on 2026-07-15.
This finance route is a correctness boundary only; it is not silently added to the already accepted scenario operation mapping.
`POST /api/analytics/v3/sales-funnel/products/history` is useful for explicit daily operational metrics:
- update cadence: once per hour;
- fields include daily order count/value and buyout count/value plus response currency;
- purchases, cancellations, and returns are attributed to the original order day;
- the method exposes at most the last week;
- WB again points final sales results to realization-report details.

Consequently it cannot by itself prove a 14-day `STD-02` history.
The existing mapping already includes `statistics_orders` alongside it; this slice preserves that mapping rather than pretending the one-week funnel is sufficient.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-operational-sales-field-schema-slice-v1.json`
SHA-256:
`9908db91b229b33a8a2f431aa328a12293462598256cfb2f6c0ebf09ea2aa4a4`.

Validator:
`tests/regression/extension-core/wb-operational-sales-field-schema-slice.mjs`
SHA-256:
`812c20827c8562d36edbc241dd19fa85229d27699e98f500914e589d9746afd7`.
Existing coverage validator imports the new slice:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256 after import:
`bbe172643560b95f1be0b628ba7beaece28945ad20407dd5bf81a34469c22728`.

The accepted `business-scenario-coverage-v1.json` operation mapping remains byte-unchanged.

## Enforced semantics

- order unit = unique operational order row by `srid`, with cancellation reported separately;
- duplicate `srid` fails closed instead of inflating units;
- order, sale/return, buyout and payout remain distinct concepts;
- no operational price field is labeled final revenue;
- zero or unknown comparison base produces null percent change, never invented infinity/percentage;
- missing data remains missing, not zero;
- relative business periods require an explicit timezone policy;
- one-week Sales Funnel history is not relabeled as complete 14-day history.
## Verification

Final exact test bytes:
- `wb-operational-sales-field-schema-slice.mjs`: PASS;
- `business-scenario-coverage.mjs`: PASS, 45/45 scenarios, 101 Ozon operation refs, 137 WB operation refs, 25 deterministic numeric cases;
- `core-contracts.mjs` against previously built exact source runtime: 9/9 PASS;
- `core-contracts.mjs` against previously built exact extracted runtime: 9/9 PASS;
- focused supervisor job exit 0, cleanup verified.

Product/runtime bytes were not changed by this slice, so repeating real browser matrices has no information value.

## Remaining gates

Still open and not relabeled:
- owner/business definition of “выручка”: order value, sale value, buyout value or seller payout;
- live WB values and owner gold-set agreement;
- authoritative realization-report field mapping for the chosen finance meaning;
- explicit business timezone when it differs from the provider/report period;
- a complete 14-day money series without conflating preliminary price fields with final revenue.

Shared readiness TSV ownership remains with C. This receipt is SOURCE evidence only.
